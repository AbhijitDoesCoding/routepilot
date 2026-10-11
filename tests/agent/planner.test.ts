import { test, describe } from "node:test";
import * as assert from "node:assert";
import { updateTravelPlanFromCompareRoutes } from "../../src/agent/planner.js";
import { TravelPlan } from "../../src/agent/types.js";

const createBasePlan = (): TravelPlan => ({
  id: "test-session-plan",
  origin: undefined,
  destination: undefined,
  constraints: []
});

describe("Deterministic TravelPlan Extraction", () => {
  test("1. extracts route geometry and metrics from compare_routes response for deadline-first planning", () => {
    const plan = createBasePlan();
    const input = {
      locations: [
        { lat: 18.528, lon: 73.874, name: "Pune Railway Station" },
        { lat: 18.579, lon: 73.908, name: "Pune Airport" }
      ],
      mode: "auto",
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: "2026-10-12T07:00:00.000Z" }
      ]
    };

    const result = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          candidateId: "fastest",
          distanceKm: 21.4,
          durationMinutes: 52,
          drivingDurationMinutes: 52,
          stopDurationMinutes: 0,
          hasToll: false,
          hasHighway: false,
          geometry: {
            type: "LineString",
            coordinates: [[73.874, 18.528], [73.89, 18.55], [73.908, 18.579]]
          }
        },
        constraintEvaluations: [
          { type: "avoid_tolls", severity: "hard", status: "satisfied", reason: "No tolls on route" },
          { type: "arrival_deadline", severity: "hard", status: "satisfied", reason: "Feasible latest departure at 2026-10-12T06:08:00.000Z" }
        ]
      },
      alternatives: []
    };

    updateTravelPlanFromCompareRoutes(plan, input, result);

    assert.strictEqual(plan.distanceKm, 21.4);
    assert.strictEqual(plan.durationMinutes, 52);
    assert.strictEqual(plan.drivingDurationMinutes, 52);
    assert.strictEqual(plan.stopDurationMinutes, 0);
    assert.ok(plan.routeGeometry);
    assert.strictEqual(plan.routeGeometry.type, "LineString");
    assert.strictEqual(plan.routeGeometry.coordinates.length, 3);
    assert.strictEqual(plan.arrivalDeadline, "2026-10-12T07:00:00.000Z");
    assert.strictEqual(plan.departureTime, "2026-10-12T06:08:00.000Z");
    assert.strictEqual(plan.actualEta, "2026-10-12T07:00:00.000Z");
    assert.strictEqual(plan.bufferMinutes, 0);
    assert.strictEqual(plan.constraintEvaluations?.length, 2);
    assert.strictEqual(plan.warnings, undefined);
  });

  test("2. stop dwell duration is included in deadline-first departure arithmetic", () => {
    const plan = createBasePlan();
    const input = {
      locations: [
        { lat: 18.528, lon: 73.874, name: "Origin" },
        { lat: 18.55, lon: 73.89, name: "Café Coffee Day" },
        { lat: 18.579, lon: 73.908, name: "Destination" }
      ],
      mode: "auto",
      stops: [
        { locationIndex: 1, name: "Café Coffee Day", lat: 18.55, lon: 73.89, durationMinutes: 15 }
      ],
      constraints: [
        { type: "arrival_deadline", severity: "hard", value: "2026-10-12T07:00:00.000Z" }
      ]
    };

    const totalMinutes = 52 + 15; // 67 minutes
    const result = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          candidateId: "with-stop",
          distanceKm: 22.1,
          durationMinutes: totalMinutes,
          drivingDurationMinutes: 52,
          stopDurationMinutes: 15,
          geometry: {
            type: "LineString",
            coordinates: [[73.874, 18.528], [73.89, 18.55], [73.908, 18.579]]
          }
        },
        constraintEvaluations: [
          { type: "arrival_deadline", severity: "hard", status: "satisfied" }
        ]
      },
      alternatives: []
    };

    updateTravelPlanFromCompareRoutes(plan, input, result);

    assert.strictEqual(plan.durationMinutes, 67);
    assert.strictEqual(plan.drivingDurationMinutes, 52);
    assert.strictEqual(plan.stopDurationMinutes, 15);
    assert.strictEqual(plan.stops?.length, 1);
    assert.strictEqual(plan.stops[0].name, "Café Coffee Day");
    // Departure must be 67 minutes before 07:00 = 05:53
    assert.strictEqual(plan.departureTime, "2026-10-12T05:53:00.000Z");
    assert.strictEqual(plan.actualEta, "2026-10-12T07:00:00.000Z");
  });

  test("3. departure-first planning preserves requested departure and calculates buffer", () => {
    const plan = createBasePlan();
    const input = {
      locations: [
        { lat: 18.5, lon: 73.8 },
        { lat: 18.58, lon: 73.9 }
      ],
      mode: "auto",
      departure_time: "2026-10-12T06:00:00.000Z",
      constraints: [
        { type: "arrival_deadline", severity: "hard", value: "2026-10-12T07:00:00.000Z" }
      ]
    };

    const result = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          distanceKm: 20,
          durationMinutes: 45,
          drivingDurationMinutes: 45,
          stopDurationMinutes: 0,
          geometry: {
            type: "LineString",
            coordinates: [[73.8, 18.5], [73.9, 18.58]]
          }
        },
        constraintEvaluations: [
          { type: "arrival_deadline", severity: "hard", status: "satisfied" }
        ]
      },
      alternatives: []
    };

    updateTravelPlanFromCompareRoutes(plan, input, result);

    assert.strictEqual(plan.departureTime, "2026-10-12T06:00:00.000Z");
    assert.strictEqual(plan.actualEta, "2026-10-12T06:45:00.000Z");
    assert.strictEqual(plan.bufferMinutes, 15); // 15 min buffer before 07:00
  });

  test("4. infeasible route sets warning and does not present invalid route as successful recommendation", () => {
    const plan = createBasePlan();
    const input = {
      locations: [{ lat: 18.5, lon: 73.8 }, { lat: 18.6, lon: 73.9 }],
      mode: "auto",
      constraints: [{ type: "avoid_tolls", severity: "hard" }]
    };

    const result = {
      feasible: false,
      reason: "No route satisfies all hard constraints.",
      recommended: {
        valid: false,
        route: {
          distanceKm: 25,
          durationMinutes: 40,
          hasToll: true,
          geometry: { type: "LineString", coordinates: [[73.8, 18.5], [73.9, 18.6]] }
        },
        constraintEvaluations: [
          { type: "avoid_tolls", severity: "hard", status: "violated", reason: "Route contains tolls" }
        ]
      },
      alternatives: []
    };

    updateTravelPlanFromCompareRoutes(plan, input, result);

    assert.strictEqual(plan.routeGeometry, undefined);
    assert.strictEqual(plan.distanceKm, undefined);
    assert.strictEqual(plan.durationMinutes, undefined);
    assert.strictEqual(plan.departureTime, undefined);
    assert.strictEqual(plan.actualEta, undefined);
    assert.ok(plan.warnings?.length);
    assert.strictEqual(plan.warnings[0], "No route satisfies all hard constraints.");
    assert.strictEqual(plan.constraintEvaluations?.[0].status, "violated");
  });

  test("5. missing or malformed geometry produces explicit warning rather than silent blank map", () => {
    const plan = createBasePlan();
    const input = {
      locations: [{ lat: 18.5, lon: 73.8 }, { lat: 18.6, lon: 73.9 }],
      mode: "auto"
    };

    const result = {
      feasible: true,
      recommended: {
        valid: true,
        route: {
          distanceKm: 15,
          durationMinutes: 30,
          drivingDurationMinutes: 30,
          stopDurationMinutes: 0,
          geometry: { type: "LineString", coordinates: [] } // Malformed empty coordinates
        },
        constraintEvaluations: []
      },
      alternatives: []
    };

    updateTravelPlanFromCompareRoutes(plan, input, result);

    assert.strictEqual(plan.routeGeometry, undefined);
    assert.ok(plan.warnings?.length);
    assert.ok(plan.warnings[0].includes("malformed route geometry"));
  });
});
