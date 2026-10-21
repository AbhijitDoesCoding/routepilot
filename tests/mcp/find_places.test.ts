import { test, describe, mock, afterEach } from "node:test";
import * as assert from "node:assert";
import { findPlacesAlongRouteHandler } from "../../src/mcp/tools/find_places_along_route.js";

describe("find_places_along_route MCP tool", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const mockLocations = [
    { lat: 18.5204, lon: 73.8567 },
    { lat: 18.5793, lon: 73.9089 }
  ];

  test("should return structured places when found", async () => {
    // Mock the routing provider
    mock.method(global, "fetch", async (url: string) => {
      if (url.includes("valhalla") || url.includes("8002")) {
        return {
          ok: true,
          json: async () => ({
            trip: {
              summary: { length: 12.5, time: 1800 },
              legs: [{ 
                shape: "...encoded...",
                summary: { length: 12.5, time: 1800, has_toll: false, has_highway: false },
                maneuvers: []
              }],
              status: 0,
              status_message: "Found route"
            }
          })
        };
      }
      // Overpass
      return {
        ok: true,
        json: async () => ({
          elements: [
            { type: "node", id: 1, lat: 18.535, lon: 73.875, tags: { name: "Café Corner" } }
          ]
        })
      };
    });

    const result = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      mode: "auto",
      category: "cafe",
      radiusMeters: 5000,
      limit: 5
    });

    assert.ok(!result.isError);
  });

  test("propagates avoid_tolls and avoid_highways into the POI corridor route", async () => {
    let valhallaBody: any = null;
    mock.method(global, "fetch", async (url: string, init: any) => {
      if (String(url).includes("8002") || String(url).includes("valhalla")) {
        valhallaBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            trip: {
              summary: { length: 10, time: 600 },
              legs: [{ shape: "...", summary: { length: 10, time: 600 }, maneuvers: [] }],
              status: 0
            }
          })
        };
      }
      return { ok: true, json: async () => ({ elements: [] }) };
    });

    const result = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      mode: "auto",
      category: "cafe",
      radiusMeters: 500,
      avoid_tolls: true,
      avoid_highways: true
    });

    assert.strictEqual(!!result.isError, false);
    assert.ok(valhallaBody, "Valhalla route request must be made");
    assert.strictEqual(valhallaBody.costing_options.auto.use_tolls, 0);
    assert.strictEqual(valhallaBody.costing_options.auto.use_highways, 0);
  });

  test("should return isError on routing failure", async () => {
    mock.method(global, "fetch", async () => {
      throw new Error("Network failure");
    });

    const result = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      mode: "auto",
      category: "cafe",
      radiusMeters: 1000
    });

    assert.strictEqual(result.isError, true);
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.error);
  });

  test("should return empty places when none found along route", async () => {
    mock.method(global, "fetch", async (url: string) => {
      if (url.includes("8002") || url.includes("valhalla")) {
        return {
          ok: true,
          json: async () => ({
            trip: {
              summary: { length: 12.5, time: 1800 },
              legs: [{ 
                shape: "...encoded...",
                summary: { length: 12.5, time: 1800, has_toll: false, has_highway: false },
                maneuvers: []
              }],
              status: 0,
              status_message: "Found route"
            }
          })
        };
      }
      // Overpass: empty
      return {
        ok: true,
        json: async () => ({ elements: [] })
      };
    });

    const result = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      mode: "auto",
      category: "cafe",
      radiusMeters: 100 // very tight radius - nothing should match
    });

    assert.strictEqual(!!result.isError, false);
    const data = JSON.parse(result.content[0].text);
    assert.deepStrictEqual(data.places, []);
    assert.ok(data.message.includes("No places found"));
  });

  test("successful empty POI results remain different from provider errors", async () => {
    // 1. Successful query with no places
    mock.method(global, "fetch", async (url: string) => {
      if (url.includes("8002") || url.includes("valhalla")) {
        return {
          ok: true,
          json: async () => ({
            trip: {
              summary: { length: 10, time: 600 },
              legs: [{ shape: "...", summary: { length: 10, time: 600 }, maneuvers: [] }],
              status: 0
            }
          })
        };
      }
      return { ok: true, json: async () => ({ elements: [] }) };
    });

    const emptyResult = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      category: "cafe",
      radiusMeters: 500
    });
    assert.strictEqual(!!emptyResult.isError, false);
    const emptyData = JSON.parse(emptyResult.content[0].text);
    assert.strictEqual(Array.isArray(emptyData.places), true);
    assert.strictEqual(emptyData.places.length, 0);

    // 2. Provider failure
    mock.method(global, "fetch", async (url: string) => {
      if (url.includes("8002") || url.includes("valhalla")) {
        return {
          ok: true,
          json: async () => ({
            trip: {
              summary: { length: 10, time: 600 },
              legs: [{ shape: "...", summary: { length: 10, time: 600 }, maneuvers: [] }],
              status: 0
            }
          })
        };
      }
      return { ok: false, status: 503 };
    });

    const errorResult = await findPlacesAlongRouteHandler({
      locations: mockLocations,
      category: "cafe",
      radiusMeters: 500
    });
    assert.strictEqual(errorResult.isError, true);
    const errorData = JSON.parse(errorResult.content[0].text);
    assert.strictEqual(errorData.places, undefined); // Does NOT convert error to empty places!
    assert.strictEqual(errorData.isError, true);
    assert.strictEqual(errorData.retryable, false);
    assert.ok(errorData.message.includes("temporarily unavailable"));
  });
});
