import { test, describe } from "node:test";
import * as assert from "node:assert";
import { ConstraintEngine, TimeUtils, RouteCandidate } from "../../src/domain/constraints.js";

describe("ConstraintEngine", () => {
  const engine = new ConstraintEngine();

  const createMockCandidate = (overrides: Partial<RouteCandidate>): RouteCandidate => ({
    candidateId: "test",
    costingProfile: "default",
    distanceKm: 10,
    durationMinutes: 20,
    hasToll: false,
    hasHighway: false,
    geometry: { type: "LineString", coordinates: [] },
    legs: [],
    maneuvers: [],
    ...overrides
  });

  test("should handle valid route with no hard constraints violated", () => {
    const candidate = createMockCandidate({});
    const evaluation = engine.evaluate(candidate, [{ type: "avoid_tolls", severity: "hard" }]);
    
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.violatedConstraints.length, 0);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "avoid_tolls");
  });

  test("should invalidate route violating hard toll constraint", () => {
    const candidate = createMockCandidate({ hasToll: true });
    const evaluation = engine.evaluate(candidate, [{ type: "avoid_tolls", severity: "hard" }]);
    
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.violatedConstraints[0], "avoid_tolls");
  });

  test("should apply penalty for violating soft toll constraint but remain valid", () => {
    const candidate = createMockCandidate({ hasToll: true });
    const evaluation = engine.evaluate(candidate, [{ type: "avoid_tolls", severity: "soft" }]);
    
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.violatedConstraints[0], "avoid_tolls");
    assert.ok(evaluation.score >= 50); // Soft violation penalty applied
  });

  test("should handle missing walking metadata gracefully", () => {
    const candidate = createMockCandidate({}); // No walkingDistanceMeters
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "hard", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.violatedConstraints.length, 0);
    assert.strictEqual(evaluation.satisfiedConstraints.length, 0); // Not evaluated
  });

  test("should invalidate route violating max walking distance", () => {
    const candidate = createMockCandidate({ walkingDistanceMeters: 600 });
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "hard", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, false);
  });

  test("rank should rank valid routes by score", () => {
    const eval1 = engine.evaluate(createMockCandidate({ durationMinutes: 30, distanceKm: 15, candidateId: "slow" }), []);
    const eval2 = engine.evaluate(createMockCandidate({ durationMinutes: 20, distanceKm: 10, candidateId: "fast" }), []);
    
    const ranking = engine.rank([eval1, eval2]);
    assert.strictEqual(ranking.feasible, true);
    assert.strictEqual(ranking.recommended?.route.candidateId, "fast");
    assert.strictEqual(ranking.alternatives.length, 1);
    assert.strictEqual(ranking.alternatives[0].route.candidateId, "slow");
  });

  test("rank should fall back to best invalid route if no valid routes", () => {
    const eval1 = engine.evaluate(createMockCandidate({ durationMinutes: 30, distanceKm: 15, hasToll: true, candidateId: "slow" }), [{ type: "avoid_tolls", severity: "hard" }]);
    const eval2 = engine.evaluate(createMockCandidate({ durationMinutes: 20, distanceKm: 10, hasToll: true, candidateId: "fast" }), [{ type: "avoid_tolls", severity: "hard" }]);
    
    const ranking = engine.rank([eval1, eval2]);
    assert.strictEqual(ranking.feasible, false);
    assert.strictEqual(ranking.recommended?.route.candidateId, "fast"); // Best of the worst
  });
});

describe("TimeUtils", () => {
  test("calculateLatestDeparture", () => {
    const deadline = "2026-10-07T09:00:00Z";
    const duration = 60; // 1 hour
    const buffer = 15; // 15 mins
    const latest = TimeUtils.calculateLatestDeparture(deadline, duration, buffer);
    assert.strictEqual(latest, "2026-10-07T07:45:00.000Z");
  });

  test("calculateArrivalTime", () => {
    const dep = "2026-10-07T08:00:00Z";
    const duration = 45;
    const arrival = TimeUtils.calculateArrivalTime(dep, duration);
    assert.strictEqual(arrival, "2026-10-07T08:45:00.000Z");
  });

  test("calculateBuffer", () => {
    const arr = "2026-10-07T08:45:00Z";
    const deadline = "2026-10-07T09:00:00Z";
    const buffer = TimeUtils.calculateBuffer(arr, deadline);
    assert.strictEqual(buffer, 15);
  });
});
