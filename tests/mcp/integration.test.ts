import { test, describe, before, after, mock, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import { createServer as createHttpServer } from "node:http";
import { Readable } from "node:stream";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createServer } from "../../src/mcp/server.js";

describe("MCP Server Integration", () => {
  let server: any;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const PORT = 3001;

  before(async () => {
    // 1. Setup local server
    const mcpServer = createServer();
    const mcpHandler = createMcpHandler(() => mcpServer);

    const requestHandler = async (req: any, res: any) => {
      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const init: RequestInit = {
          method: req.method,
          headers: req.headers as Record<string, string>,
        };
        if (req.method !== "GET" && req.method !== "HEAD") {
          init.body = Readable.toWeb(req) as any;
          (init as any).duplex = "half";
        }
        const webReq = new Request(url, init);
        const webRes = await mcpHandler.fetch(webReq);

        res.writeHead(webRes.status, webRes.statusText, Object.fromEntries(webRes.headers.entries()));
        if (webRes.body) {
          Readable.fromWeb(webRes.body as any).pipe(res);
        } else {
          res.end();
        }
      } catch (e) {
        res.writeHead(500);
        res.end();
      }
    };

    server = createHttpServer(requestHandler);
    await new Promise<void>((resolve) => server.listen(PORT, resolve));

    // 2. Setup Client
    transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`));
    client = new Client(
      { name: "RoutePilotTestClient", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
  });

  after(async () => {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("should discover all 5 tools (health_check, geocode, calculate_route, compare_routes, find_places_along_route)", async () => {
    const tools = await client.listTools();
    const healthTool = tools.tools.find((t) => t.name === "health_check");
    const geocodeTool = tools.tools.find((t) => t.name === "geocode");
    const calculateRouteTool = tools.tools.find((t) => t.name === "calculate_route");
    const compareRoutesTool = tools.tools.find((t) => t.name === "compare_routes");
    const findPlacesTool = tools.tools.find((t) => t.name === "find_places_along_route");
    
    assert.ok(healthTool, "health_check tool should be present");
    assert.ok(geocodeTool, "geocode tool should be present");
    assert.ok(calculateRouteTool, "calculate_route tool should be present");
    assert.ok(compareRoutesTool, "compare_routes tool should be present");
    assert.ok(findPlacesTool, "find_places_along_route tool should be present");
  });

  test("should call find_places_along_route tool over Streamable HTTP with mock data", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("valhalla") || urlString.includes("8002")) {
        return new Response(
          JSON.stringify({
            trip: {
              summary: { length: 25.5, time: 2400 },
              legs: [
                {
                  shape: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                  summary: { length: 25.5, time: 2400 },
                  maneuvers: []
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (urlString.includes("overpass") || urlString.includes("interpreter")) {
        return new Response(
          JSON.stringify({
            elements: [
              { type: "node", id: 101, lat: 3.8501, lon: -12.0201, tags: { name: "Route Café" } }
            ]
          }),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "find_places_along_route",
      arguments: {
        locations: [{ lat: 3.85, lon: -12.02 }, { lat: 4.3252, lon: -12.6453 }],
        mode: "auto",
        category: "cafe",
        radiusMeters: 2000,
        limit: 5
      }
    });

    assert.ok(result.content.length > 0);
    const content = result.content[0] as any;
    assert.strictEqual(content.type, "text");
    const data = JSON.parse(content.text);
    assert.ok(data.places);
    assert.strictEqual(data.places.length, 1);
    assert.strictEqual(data.places[0].name, "Route Café");
  });

  test("should call health_check tool", async () => {
    const result = await client.callTool({
      name: "health_check",
      arguments: {}
    });

    assert.ok(result.content.length > 0);
    const content = result.content[0];
    assert.strictEqual(content.type, "text");

    const data = JSON.parse(content.text);
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.service, "RoutePilot MCP");
    assert.strictEqual(data.version, "0.1.0");
    assert.ok(data.timestamp);
  });

  test("should call geocode tool with mock data", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("nominatim")) {
        return new Response(
          JSON.stringify([
            {
              lat: "18.5793",
              lon: "73.9089",
              display_name: "Pune Airport",
            },
          ]),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "geocode",
      arguments: { query: "Pune Airport" }
    });

    assert.ok(result.content.length > 0);
    const content = result.content[0];
    assert.strictEqual(content.type, "text");

    const data = JSON.parse(content.text);
    assert.ok(data.results);
    assert.strictEqual(data.results.length, 1);
    assert.strictEqual(data.results[0].lat, 18.5793);
    assert.strictEqual(data.results[0].lon, 73.9089);
    assert.strictEqual(data.results[0].name, "Pune Airport");
  });

  test("should call calculate_route tool with mock data", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("route")) {
        return new Response(
          JSON.stringify({
            trip: {
              summary: { length: 25.5, time: 2400 },
              legs: [
                {
                  shape: "_p~iF~ps|U",
                  summary: { length: 25.5, time: 2400 },
                  maneuvers: []
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "calculate_route",
      arguments: { 
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto",
        avoid_tolls: true,
        avoid_highways: false
      }
    });

    assert.ok(result.content.length > 0);
    const content = result.content[0];
    assert.strictEqual(content.type, "text");

    const data = JSON.parse(content.text);
    assert.strictEqual(data.distanceKm, 25.5);
    assert.strictEqual(data.durationMinutes, 40); // 2400 / 60
    assert.strictEqual(data.geometry.type, "LineString");
  });

  test("should call compare_routes tool with mock data", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("route")) {
        const body = JSON.parse((init?.body as string) || "{}");
        const isTollAverse = body.costing_options?.auto?.use_tolls === 0;
        const isHighwayAverse = body.costing_options?.auto?.use_highways === 0;
        
        return new Response(
          JSON.stringify({
            trip: {
              summary: { 
                length: isTollAverse ? 30.5 : (isHighwayAverse ? 35 : 25.5), 
                time: isTollAverse ? 3000 : (isHighwayAverse ? 3600 : 2400),
                has_toll: !isTollAverse,
                has_highway: !isHighwayAverse
              },
              legs: [
                {
                  shape: "_p~iF~ps|U",
                  summary: { 
                    length: isTollAverse ? 30.5 : (isHighwayAverse ? 35 : 25.5), 
                    time: isTollAverse ? 3000 : (isHighwayAverse ? 3600 : 2400) 
                  },
                  maneuvers: []
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "compare_routes",
      arguments: { 
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto",
        constraints: [
          { type: "avoid_tolls", severity: "hard" }
        ]
      }
    });

    assert.ok(result.content.length > 0);
    const content = result.content[0];
    assert.strictEqual(content.type, "text");

    const data = JSON.parse(content.text);
    
    assert.strictEqual(data.feasible, true);
    assert.strictEqual(data.recommended.route.candidateId, "no-tolls");
    assert.strictEqual(data.recommended.valid, true);
    
    const invalidAlt = data.alternatives.find((a: any) => a.route.candidateId === "fastest");
    assert.ok(invalidAlt, "fastest route should be in alternatives");
    assert.strictEqual(invalidAlt.valid, false);
    assert.ok(invalidAlt.violatedConstraints.includes("avoid_tolls"));
  });

  test("should generate combined candidate when both avoid_tolls and avoid_highways are required", async () => {
    let requestsCount = 0;
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("route")) {
        requestsCount++;
        const body = JSON.parse((init?.body as string) || "{}");
        const isTollAverse = body.costing_options?.auto?.use_tolls === 0;
        const isHighwayAverse = body.costing_options?.auto?.use_highways === 0;
        
        let length = 25;
        let time = 2400;
        
        if (isTollAverse && isHighwayAverse) {
           length = 50; time = 5000;
        } else if (isTollAverse) {
           length = 30; time = 3000;
        } else if (isHighwayAverse) {
           length = 40; time = 4000;
        }

        return new Response(
          JSON.stringify({
            trip: {
              summary: { 
                length, 
                time,
                has_toll: !isTollAverse,
                has_highway: !isHighwayAverse
              },
              legs: [
                {
                  shape: "_p~iF~ps|U",
                  summary: { length, time },
                  maneuvers: []
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "compare_routes",
      arguments: { 
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto",
        constraints: [
          { type: "avoid_tolls", severity: "hard" },
          { type: "avoid_highways", severity: "hard" }
        ]
      }
    });

    assert.strictEqual(requestsCount, 4); // default, toll, highway, combined

    const data = JSON.parse((result.content[0] as any).text);
    assert.strictEqual(data.feasible, true);
    assert.strictEqual(data.recommended.route.candidateId, "no-tolls-no-highways");
    assert.strictEqual(data.recommended.valid, true);
    
    // Alternatives should include the ones that failed
    const failedToll = data.alternatives.find((a: any) => a.route.candidateId === "fastest");
    assert.ok(failedToll);
    assert.strictEqual(failedToll.valid, false);
  });

  test("should reject malformed constraints due to strict typing", async () => {
    const result = await client.callTool({
      name: "compare_routes",
      arguments: { 
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto",
        constraints: [
          { type: "max_walking_distance", severity: "hard", value: "five hundred" } // Should be number
        ]
      }
    });

    assert.strictEqual(result.isError, true);
    const content = result.content[0] as any;
    assert.ok(content.text.includes("Invalid input") || content.text.toLowerCase().includes("invalid") || content.text.includes("five hundred") || content.text.includes("Expected"));
  });

  test("should reject missing required value for arrival_deadline", async () => {
    const result = await client.callTool({
      name: "compare_routes",
      arguments: { 
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto",
        constraints: [
          { type: "arrival_deadline", severity: "hard" } // Missing value
        ]
      }
    });

    assert.strictEqual(result.isError, true);
  });

  test("should evaluate deadline-first compare_routes over Streamable HTTP without departure_time and return feasible recommendation", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlString = input.toString();
      if (urlString.includes("valhalla") || urlString.includes("8002")) {
        return new Response(
          JSON.stringify({
            trip: {
              summary: { length: 21.4, time: 3120, has_toll: false, has_highway: false },
              legs: [
                {
                  shape: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                  summary: { length: 21.4, time: 3120 },
                  maneuvers: []
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return originalFetch(input, init);
    });

    const result = await client.callTool({
      name: "compare_routes",
      arguments: {
        locations: [{ lat: 18.528, lon: 73.874 }, { lat: 18.579, lon: 73.908 }],
        mode: "auto",
        constraints: [
          { type: "avoid_tolls", severity: "hard" },
          { type: "arrival_deadline", severity: "hard", value: "2026-10-12T07:00:00.000Z" }
        ]
      }
    });

    assert.ok(!result.isError);
    const content = result.content[0] as any;
    assert.strictEqual(content.type, "text");
    const data = JSON.parse(content.text);
    assert.strictEqual(data.feasible, true);
    assert.ok(data.recommended);
    assert.strictEqual(data.recommended.valid, true);
    assert.ok(data.recommended.route.geometry);
    assert.strictEqual(data.recommended.route.geometry.type, "LineString");
    assert.ok(data.recommended.route.geometry.coordinates.length >= 2);
  });

});

