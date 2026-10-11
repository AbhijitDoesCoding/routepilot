import { test, describe } from "node:test";
import * as assert from "node:assert";

// Function under test (same logic as used in frontend RouteMap.tsx)
const isValidLineString = (geom: any): boolean => {
  if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
    return false;
  }
  if (geom.coordinates.length < 2) {
    return false;
  }
  return geom.coordinates.every((coord: any) =>
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1]) &&
    coord[0] >= -180 &&
    coord[0] <= 180 &&
    coord[1] >= -90 &&
    coord[1] <= 90
  );
};

describe("Route Geometry LineString Validation", () => {
  test("accepts valid GeoJSON LineString with finite coordinates in geographic range", () => {
    const geom = {
      type: "LineString",
      coordinates: [
        [73.8567, 18.5204],
        [73.874, 18.528],
        [73.908, 18.579]
      ]
    };
    assert.strictEqual(isValidLineString(geom), true);
  });

  test("rejects LineString with less than 2 coordinates", () => {
    const singlePoint = {
      type: "LineString",
      coordinates: [[73.8567, 18.5204]]
    };
    assert.strictEqual(isValidLineString(singlePoint), false);

    const emptyPoints = {
      type: "LineString",
      coordinates: []
    };
    assert.strictEqual(isValidLineString(emptyPoints), false);
  });

  test("rejects invalid GeoJSON types", () => {
    assert.strictEqual(isValidLineString(null), false);
    assert.strictEqual(isValidLineString(undefined), false);
    assert.strictEqual(isValidLineString({ type: "Point", coordinates: [73.8, 18.5] }), false);
  });

  test("rejects out-of-range latitude or longitude", () => {
    const outOfRangeLon = {
      type: "LineString",
      coordinates: [[195.0, 18.5], [73.8, 18.5]]
    };
    assert.strictEqual(isValidLineString(outOfRangeLon), false);

    const outOfRangeLat = {
      type: "LineString",
      coordinates: [[73.8, -95.0], [73.8, 18.5]]
    };
    assert.strictEqual(isValidLineString(outOfRangeLat), false);
  });

  test("rejects NaN or non-finite coordinates", () => {
    const nanCoord = {
      type: "LineString",
      coordinates: [[NaN, 18.5], [73.8, 18.5]]
    };
    assert.strictEqual(isValidLineString(nanCoord), false);

    const infCoord = {
      type: "LineString",
      coordinates: [[Infinity, 18.5], [73.8, 18.5]]
    };
    assert.strictEqual(isValidLineString(infCoord), false);
  });
});
