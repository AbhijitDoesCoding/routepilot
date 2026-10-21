import { test, describe, mock, afterEach } from "node:test";
import * as assert from "node:assert";
import { OverpassProvider } from "../../../src/providers/places/overpass.js";

describe("OverpassProvider", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  const mockRouteGeometry = {
    type: "LineString",
    coordinates: [[73.8567, 18.5204], [73.9089, 18.5793]]
  };

  test("should normalize a successful response and filter by distance", async () => {
    mock.method(global, "fetch", async () => ({
      ok: true,
      json: async () => ({
        elements: [
          { type: "node", id: 1, lat: 18.5205, lon: 73.8568, tags: { name: "Close Cafe" } }, // very close to start
          { type: "node", id: 2, lat: 18.9, lon: 73.9, tags: { name: "Far Cafe" } }, // far
          { type: "node", id: 3, lat: 18.55, lon: 73.88, tags: { name: "Mid Cafe" } } // near middle
        ]
      })
    }));

    const provider = new OverpassProvider();
    const places = await provider.findPlacesAlongRoute({
      routeGeometry: mockRouteGeometry,
      category: "cafe",
      radiusMeters: 5000,
      limit: 2
    });

    assert.strictEqual(places.length, 2);
    assert.strictEqual(places[0].name, "Close Cafe");
    assert.strictEqual(places[1].name, "Mid Cafe");
    assert.ok(places[0].distanceToRouteMeters! < 100);
  });

  test("should handle empty elements", async () => {
    mock.method(global, "fetch", async () => ({
      ok: true,
      json: async () => ({ elements: [] })
    }));

    const provider = new OverpassProvider();
    const places = await provider.findPlacesAlongRoute({
      routeGeometry: mockRouteGeometry,
      category: "cafe",
      radiusMeters: 1000
    });

    assert.strictEqual(places.length, 0);
  });

  test("should throw on HTTP error", async () => {
    mock.method(global, "fetch", async () => ({
      ok: false,
      status: 500
    }));

    const provider = new OverpassProvider();
    await assert.rejects(
      provider.findPlacesAlongRoute({
        routeGeometry: mockRouteGeometry,
        category: "cafe",
        radiusMeters: 1000
      }),
      /Overpass API error/
    );
  });

  test("one transient Overpass failure followed by success recovers correctly", async () => {
    let callCount = 0;
    mock.method(global, "fetch", async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        json: async () => ({
          elements: [
            { type: "node", id: 10, lat: 18.5205, lon: 73.8568, tags: { name: "Recovered Cafe" } }
          ]
        })
      };
    });

    const provider = new OverpassProvider();
    const places = await provider.findPlacesAlongRoute({
      routeGeometry: mockRouteGeometry,
      category: "cafe",
      radiusMeters: 5000,
      limit: 2
    });

    assert.strictEqual(callCount, 2);
    assert.strictEqual(places.length, 1);
    assert.strictEqual(places[0].name, "Recovered Cafe");
  });

  test("two failed bounded attempts produce OverpassError with attempts=2", async () => {
    let overpassCalls = 0;
    let fallbackCalls = 0;
    mock.method(global, "fetch", async (_input: any, init: any) => {
      if (init?.method === "POST") {
        overpassCalls++;
      } else {
        fallbackCalls++;
      }
      return { ok: false, status: 429 };
    });

    const provider = new OverpassProvider();
    await assert.rejects(
      provider.findPlacesAlongRoute({
        routeGeometry: mockRouteGeometry,
        category: "cafe",
        radiusMeters: 1000
      }),
      (err: any) => {
        assert.strictEqual(err.attempts, 2);
        assert.strictEqual(err.status, 429);
        assert.strictEqual(err.category, "rate_limited");
        return true;
      }
    );
    assert.strictEqual(overpassCalls, 2);
    assert.strictEqual(fallbackCalls, 1);
  });

  test("should throw on malformed response", async () => {
    mock.method(global, "fetch", async () => ({
      ok: true,
      json: async () => ({})
    }));

    const provider = new OverpassProvider();
    await assert.rejects(
      provider.findPlacesAlongRoute({
        routeGeometry: mockRouteGeometry,
        category: "cafe",
        radiusMeters: 1000
      }),
      /Malformed Overpass response/
    );
  });
});
