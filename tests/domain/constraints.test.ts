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

  test("should invalidate route if hard constraint is NOT_EVALUABLE", () => {
    const candidate = createMockCandidate({}); // No walkingDistanceMeters
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "hard", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, false); // Must be proven satisfied for hard constraints
    assert.strictEqual(evaluation.notEvaluableConstraints[0], "max_walking_distance");
  });

  test("should apply penalty if soft constraint is NOT_EVALUABLE but remain valid", () => {
    const candidate = createMockCandidate({});
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "soft", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.notEvaluableConstraints[0], "max_walking_distance");
    assert.ok(evaluation.score > 15); // NOT_EVALUABLE_SOFT_PENALTY applied
  });

  test("should validate exactly threshold walking distance", () => {
    const candidate = createMockCandidate({ walkingDistanceMeters: 500 });
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "hard", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "max_walking_distance");
  });

  test("should invalidate route violating max walking distance", () => {
    const candidate = createMockCandidate({ walkingDistanceMeters: 501 });
    const evaluation = engine.evaluate(candidate, [{ type: "max_walking_distance", severity: "hard", value: 500 }]);
    
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.violatedConstraints[0], "max_walking_distance");
  });

  test("should validate arrival_deadline before deadline", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const departure = "2026-10-07T08:00:00Z";
    const deadline = "2026-10-07T10:00:00Z";
    
    const evaluation = engine.evaluate(candidate, [{ type: "arrival_deadline", severity: "hard", value: deadline }], departure);
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "arrival_deadline");
  });

  test("should validate arrival_deadline exactly at deadline", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const departure = "2026-10-07T08:00:00Z";
    const deadline = "2026-10-07T09:00:00Z";
    
    const evaluation = engine.evaluate(candidate, [{ type: "arrival_deadline", severity: "hard", value: deadline }], departure);
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "arrival_deadline");
  });

  test("should invalidate arrival_deadline after deadline", () => {
    const candidate = createMockCandidate({ durationMinutes: 61 });
    const departure = "2026-10-07T08:00:00Z";
    const deadline = "2026-10-07T09:00:00Z";
    
    const evaluation = engine.evaluate(candidate, [{ type: "arrival_deadline", severity: "hard", value: deadline }], departure);
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.violatedConstraints[0], "arrival_deadline");
  });

  test("hard arrival deadline with no departure_time: deadline-first route remains evaluable and can be feasible", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const deadline = "2026-10-07T10:00:00Z";
    
    const evaluation = engine.evaluate(candidate, [{ type: "arrival_deadline", severity: "hard", value: deadline }]);
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "arrival_deadline");
    assert.strictEqual(evaluation.notEvaluableConstraints.length, 0);
  });

  test("deadline-first evaluation is violated when latest departure is in the past relative to current time", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const deadline = "2026-10-07T10:00:00Z"; // departure would be 09:00:00Z
    const currentTime = "2026-10-07T09:30:00Z"; // 30 min after required departure
    
    const evaluation = engine.evaluate(
      candidate,
      [{ type: "arrival_deadline", severity: "hard", value: deadline }],
      undefined,
      currentTime
    );
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.violatedConstraints[0], "arrival_deadline");
    assert.ok(evaluation.constraintEvaluations[0].reason?.includes("in the past"));
  });

  test("deadline-first evaluation is satisfied when latest departure is after current time", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const deadline = "2026-10-07T10:00:00Z"; // departure at 09:00:00Z
    const currentTime = "2026-10-07T08:00:00Z"; // 1 hour before required departure
    
    const evaluation = engine.evaluate(
      candidate,
      [{ type: "arrival_deadline", severity: "hard", value: deadline }],
      undefined,
      currentTime
    );
    assert.strictEqual(evaluation.valid, true);
    assert.strictEqual(evaluation.satisfiedConstraints[0], "arrival_deadline");
  });

  test("arrival_deadline with invalid date format is not evaluable", () => {
    const candidate = createMockCandidate({ durationMinutes: 60 });
    const evaluation = engine.evaluate(candidate, [{ type: "arrival_deadline", severity: "hard", value: "not-a-date" }]);
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.notEvaluableConstraints[0], "arrival_deadline");
  });

  test("ranking is marked infeasible when hard arrival_deadline required departure has already passed", () => {
    const candidate = createMockCandidate({ durationMinutes: 60, candidateId: "c1" });
    const deadline = "2026-10-07T10:00:00Z";
    const currentTime = "2026-10-07T09:30:00Z"; // required departure 09:00:00Z is 30 min in the past

    const evaluation = engine.evaluate(
      candidate,
      [{ type: "arrival_deadline", severity: "hard", value: deadline }],
      undefined,
      currentTime
    );
    const ranking = engine.rank([evaluation]);

    assert.strictEqual(ranking.feasible, false);
    assert.strictEqual(ranking.recommended?.valid, false);
    assert.ok(ranking.reason?.includes("No route satisfies all hard constraints"));
  });

  test("ranking is marked feasible when hard arrival_deadline required departure is in the future", () => {
    const candidate = createMockCandidate({ durationMinutes: 60, candidateId: "c1" });
    const deadline = "2026-10-07T10:00:00Z";
    const currentTime = "2026-10-07T08:30:00Z"; // required departure 09:00:00Z is 30 min in the future

    const evaluation = engine.evaluate(
      candidate,
      [{ type: "arrival_deadline", severity: "hard", value: deadline }],
      undefined,
      currentTime
    );
    const ranking = engine.rank([evaluation]);

    assert.strictEqual(ranking.feasible, true);
    assert.strictEqual(ranking.recommended?.valid, true);
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
  
  test("calculateBuffer negative", () => {
    const arr = "2026-10-07T09:15:00Z";
    const deadline = "2026-10-07T09:00:00Z";
    const buffer = TimeUtils.calculateBuffer(arr, deadline);
    assert.strictEqual(buffer, -15);
  });
  
  test("calculateBuffer zero", () => {
    const arr = "2026-10-07T09:00:00Z";
    const deadline = "2026-10-07T09:00:00Z";
    const buffer = TimeUtils.calculateBuffer(arr, deadline);
    assert.strictEqual(buffer, 0);
  });
});
