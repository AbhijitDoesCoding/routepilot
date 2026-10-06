import { test, describe, beforeEach, afterEach, mock } from "node:test";
import * as assert from "node:assert";
import { ValhallaProvider } from "../../src/providers/routing/valhalla.js";

describe("ValhallaProvider", () => {
  let provider: ValhallaProvider;

  beforeEach(() => {
    provider = new ValhallaProvider();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("should successfully normalize an auto route", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify({
          trip: {
            summary: { length: 15.5, time: 1800 },
            legs: [
              {
                shape: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", // Known valid polyline 5 (will decode as valid length 6 garbage, but non-empty)
                summary: { length: 15.5, time: 1800 },
                maneuvers: [{ instruction: "Turn right" }]
              }
            ]
          }
        }),
        { status: 200 }
      );
    });

    const result = await provider.calculateRoute({
      locations: [
        { lat: 10, lon: 10, name: "A" },
        { lat: 20, lon: 20, name: "B" }
      ],
      mode: "auto"
    });

    assert.strictEqual(result.distanceKm, 15.5);
    assert.strictEqual(result.durationMinutes, 30);
    assert.strictEqual(result.geometry.type, "LineString");
    assert.strictEqual(result.maneuvers.length, 1);
  });

  test("should map constraints correctly for avoidTolls and avoidHighways", async () => {
    let requestedBody: any;
    mock.method(globalThis, "fetch", async (input: any, init: any) => {
      requestedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          trip: {
            summary: { length: 5, time: 600 },
            legs: [{ shape: "_p~iF~ps|U", summary: { length: 5, time: 600 } }]
          }
        }),
        { status: 200 }
      );
    });

    await provider.calculateRoute({
      locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
      mode: "auto",
      avoidTolls: true,
      avoidHighways: true
    });

    assert.strictEqual(requestedBody.costing, "auto");
    assert.strictEqual(requestedBody.costing_options.auto.use_tolls, 0);
    assert.strictEqual(requestedBody.costing_options.auto.use_highways, 0);
  });

  test("should throw on less than 2 locations", async () => {
    await assert.rejects(
      async () => await provider.calculateRoute({
        locations: [{ lat: 10, lon: 10 }],
        mode: "auto"
      }),
      /At least 2 locations are required/
    );
  });

  test("should throw on invalid coordinates", async () => {
    await assert.rejects(
      async () => await provider.calculateRoute({
        // @ts-ignore
        locations: [{ lat: "invalid", lon: 10 }, { lat: 20, lon: 20 }],
        mode: "auto"
      }),
      /coordinates must be valid numbers/
    );
  });

  test("should throw on HTTP error", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    });

    await assert.rejects(
      async () => await provider.calculateRoute({
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "pedestrian"
      }),
      /Valhalla API HTTP error: 404/
    );
  });

  test("should throw on missing trip data", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await assert.rejects(
      async () => await provider.calculateRoute({
        locations: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }],
        mode: "bicycle"
      }),
      /Malformed response from Valhalla API: Missing trip details./
    );
  });
});
