import { test, describe } from "node:test";
import * as assert from "node:assert";
import { decodePolyline } from "../../src/providers/routing/polyline.js";

describe("decodePolyline", () => {
  test("should decode precision 5 polyline correctly", () => {
    // Known polyline 5 for:
    // (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
    // GeoJSON is [lon, lat]
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const decoded = decodePolyline(encoded, 5);
    
    assert.strictEqual(decoded.length, 3);
    
    // Check first coordinate
    assert.ok(Math.abs(decoded[0][0] - (-120.2)) < 0.0001);
    assert.ok(Math.abs(decoded[0][1] - (38.5)) < 0.0001);
    
    // Check second coordinate
    assert.ok(Math.abs(decoded[1][0] - (-120.95)) < 0.0001);
    assert.ok(Math.abs(decoded[1][1] - (40.7)) < 0.0001);
    
    // Check third coordinate
    assert.ok(Math.abs(decoded[2][0] - (-126.453)) < 0.0001);
    assert.ok(Math.abs(decoded[2][1] - (43.252)) < 0.0001);
  });

  test("should handle empty string", () => {
    const decoded = decodePolyline("");
    assert.strictEqual(decoded.length, 0);
  });
});
