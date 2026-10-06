import { test, describe, beforeEach, afterEach, mock } from "node:test";
import * as assert from "node:assert";
import { NominatimProvider } from "../../src/providers/geocoding/nominatim.js";

describe("NominatimProvider", () => {
  let provider: NominatimProvider;

  beforeEach(() => {
    provider = new NominatimProvider();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("should normalize a successful response", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify([
          {
            lat: "18.5793",
            lon: "73.9089",
            display_name: "Pune Airport, Lohegaon, Pune",
          },
        ]),
        { status: 200 }
      );
    });

    const results = await provider.search("Pune Airport");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].lat, 18.5793);
    assert.strictEqual(results[0].lon, 73.9089);
    assert.strictEqual(results[0].name, "Pune Airport, Lohegaon, Pune");
  });

  test("should handle zero results", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const results = await provider.search("Nowhere XYZ");
    assert.strictEqual(results.length, 0);
  });

  test("should throw on empty query", async () => {
    await assert.rejects(
      async () => await provider.search("   "),
      /Query must be a non-empty string/
    );
  });

  test("should throw on HTTP error", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    });

    await assert.rejects(
      async () => await provider.search("test"),
      /Nominatim API HTTP error: 404/
    );
  });

  test("should throw on malformed array response", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ error: "bad" }), { status: 200 });
    });

    await assert.rejects(
      async () => await provider.search("test"),
      /Malformed response from Nominatim API/
    );
  });

  test("should throw on malformed coordinates", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify([
          {
            lat: "invalid",
            lon: "73.9089",
            display_name: "Pune",
          },
        ]),
        { status: 200 }
      );
    });

    await assert.rejects(
      async () => await provider.search("test"),
      /Malformed coordinate data in Nominatim response/
    );
  });
});
