import { test, describe } from "node:test";
import * as assert from "node:assert";
import { ConstraintEngine, TimeUtils } from "../../src/domain/constraints.js";
import type { RouteCandidate, RouteConstraint } from "../../src/domain/constraints.js";

const mockRoute = (overrides: Partial<RouteCandidate> = {}): RouteCandidate => ({
  distanceKm: 21.4,
  durationMinutes: 52,
  drivingDurationMinutes: 52,
  stopDurationMinutes: 0,
  hasToll: false,
  hasHighway: false,
  geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.57]] },
  legs: [],
  maneuvers: [],
  candidateId: "fastest",
  costingProfile: "default",
  ...overrides,
});

describe("Stop Duration Math", () => {
  test("route without stops: durationMinutes is driving time", () => {
    const r = mockRoute({ durationMinutes: 45, drivingDurationMinutes: 45, stopDurationMinutes: 0 });
    assert.strictEqual(r.durationMinutes, 45);
    assert.strictEqual(r.drivingDurationMinutes, 45);
  });

  test("route with 15 min coffee stop: total duration is 60", () => {
    const drivingMinutes = 45;
    const stopMinutes = 15;
    const r = mockRoute({
      drivingDurationMinutes: drivingMinutes,
      stopDurationMinutes: stopMinutes,
      durationMinutes: drivingMinutes + stopMinutes, // 60
    });
    assert.strictEqual(r.durationMinutes, 60);
    assert.strictEqual(r.drivingDurationMinutes, 45);
    assert.strictEqual(r.stopDurationMinutes, 15);
  });

  test("deadline calculation includes stop duration", () => {
    const deadline = "2026-10-07T07:00:00Z";
    const totalDuration = 60; // 45 driving + 15 stop
    const departure = TimeUtils.calculateLatestDeparture(deadline, totalDuration, 0);
    const eta = TimeUtils.calculateArrivalTime(departure, totalDuration);
    const buffer = TimeUtils.calculateBuffer(eta, deadline);
    
    assert.strictEqual(buffer, 0);
    // departure should be 60 min before deadline = 06:00 UTC
    const depDate = new Date(departure);
    assert.strictEqual(depDate.getUTCHours(), 6);
    assert.strictEqual(depDate.getUTCMinutes(), 0);
  });

  test("deadline becomes impossible after adding stop", () => {
    const deadline = "2026-10-07T07:00:00Z";
    const departure = "2026-10-07T06:30:00Z"; // 30 min before deadline
    // With 45 min driving + 15 stop = 60 min total
    const totalDuration = 60;
    const eta = TimeUtils.calculateArrivalTime(departure, totalDuration);
    const buffer = TimeUtils.calculateBuffer(eta, deadline);
    
    assert.ok(buffer < 0, "Should be late with a stop when departure is too close");
    assert.strictEqual(Math.round(buffer), -30);
  });

  test("constraint evaluation uses total duration for arrival_deadline", () => {
    const engine = new ConstraintEngine();
    const deadline = "2026-10-07T07:00:00Z";
    const departure = "2026-10-07T05:30:00Z";
    
    // Route with stop: 45 min driving + 15 min stop = 60 total
    const route = mockRoute({
      drivingDurationMinutes: 45,
      stopDurationMinutes: 15,
      durationMinutes: 60,
    });
    
    const constraints: RouteConstraint[] = [
      { type: "arrival_deadline", severity: "hard", value: deadline }
    ];
    
    const result = engine.evaluate(route, constraints, departure);
    
    // 05:30 + 60 min = 06:30 which is before 07:00 => satisfied
    assert.strictEqual(result.constraintEvaluations[0].status, "satisfied");
  });

  test("constraint violated when total duration (with stop) exceeds deadline", () => {
    const engine = new ConstraintEngine();
    const deadline = "2026-10-07T07:00:00Z";
    const departure = "2026-10-07T06:30:00Z";
    
    // Route: 45 driving + 15 stop = 60 total; departs 06:30, arrives 07:30 => LATE
    const route = mockRoute({
      drivingDurationMinutes: 45,
      stopDurationMinutes: 15,
      durationMinutes: 60,
    });
    
    const constraints: RouteConstraint[] = [
      { type: "arrival_deadline", severity: "hard", value: deadline }
    ];
    
    const result = engine.evaluate(route, constraints, departure);
    assert.strictEqual(result.constraintEvaluations[0].status, "violated");
    assert.strictEqual(result.valid, false);
  });
});
