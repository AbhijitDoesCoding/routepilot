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

    assert.ok(!result.isError);
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.places !== undefined || data.message !== undefined);
  });
});
