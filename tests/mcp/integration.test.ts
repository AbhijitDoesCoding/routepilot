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

  test("should discover health_check and geocode tools", async () => {
    const tools = await client.listTools();
    const healthTool = tools.tools.find((t) => t.name === "health_check");
    const geocodeTool = tools.tools.find((t) => t.name === "geocode");
    
    assert.ok(healthTool, "health_check tool should be present");
    assert.ok(geocodeTool, "geocode tool should be present");
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
});
