import { test, describe } from "node:test";
import * as assert from "node:assert";
import { updateTravelPlanFromCompareRoutes, prepareCompareRoutesInput, markTravelPlanStale } from "../../src/agent/planner.js";
import { TravelPlan } from "../../src/agent/types.js";

const ORIGIN = { lat: 18.528, lon: 73.874, name: "Pune Railway Station" };
const CAFE = { lat: 18.55, lon: 73.89, name: "Corner Cafe" };
const AIRPORT = { lat: 18.579, lon: 73.908, name: "Pune Airport" };
const DEADLINE = "2026-10-12T07:00:00.000Z";
const GEOMETRY = {
  type: "LineString",
  coordinates: [[73.874, 18.528], [73.89, 18.55], [73.908, 18.579]]
};

const successfulResult = (durationMinutes: number, stopDurationMinutes = 0, constraints: any[] = []) => ({
  feasible: true,
  recommended: {
    valid: true,
    route: {
      distanceKm: 21.4,
      durationMinutes,
      drivingDurationMinutes: durationMinutes - stopDurationMinutes,
      stopDurationMinutes,
      geometry: GEOMETRY
    },
    constraintEvaluations: constraints.map(c => ({ type: c.type, severity: c.severity, status: "satisfied" }))
  },
  alternatives: []
});

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

describe("Deterministic plan continuity and removal semantics", () => {
  test("three-turn follow-up preserves deadline, both avoid constraints, stop and dwell; stop waypoint is in the route request", () => {
    const plan = createBasePlan();
    const turn1 = {
      locations: [ORIGIN, AIRPORT],
      mode: "auto",
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: DEADLINE }
      ]
    };
    updateTravelPlanFromCompareRoutes(plan, turn1, successfulResult(52, 0, turn1.constraints));

    const stop = { locationIndex: 1, placeId: "cafe_1", name: CAFE.name, lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 };
    const turn2 = {
      locations: [ORIGIN, CAFE, AIRPORT],
      mode: "auto",
      stops: [stop],
      // deadline and avoid_tolls omitted on purpose
      constraints: []
    };
    const prepared2 = prepareCompareRoutesInput(plan, turn2);
    updateTravelPlanFromCompareRoutes(plan, prepared2.input, successfulResult(67, 15, turn1.constraints));

    assert.strictEqual(plan.stops?.length, 1);
    assert.strictEqual(plan.stopDurationMinutes, 15);

    // Turn 3 omits the deadline, the stop, and its waypoint, and only adds highways.
    const turn3 = {
      locations: [ORIGIN, AIRPORT],
      mode: "auto",
      constraints: [{ type: "avoid_highways", severity: "hard" }]
    };
    const prepared3 = prepareCompareRoutesInput(plan, turn3);

    const types = prepared3.input.constraints.map((c: any) => c.type);
    assert.deepStrictEqual(new Set(types), new Set(["avoid_tolls", "arrival_deadline", "avoid_highways"]));
    assert.strictEqual(prepared3.input.stops.length, 1);
    assert.strictEqual(prepared3.input.stops[0].name, "Corner Cafe");
    assert.strictEqual(prepared3.input.stops[0].locationIndex, 1);
    assert.strictEqual(prepared3.input.locations.length, 3, "stop waypoint must be inserted into the route request");
    assert.strictEqual(prepared3.input.locations[1].name, "Corner Cafe");

    const allConstraints = prepared3.input.constraints;
    updateTravelPlanFromCompareRoutes(plan, prepared3.input, successfulResult(75, 15, allConstraints));

    assert.strictEqual(plan.arrivalDeadline, DEADLINE);
    assert.strictEqual(plan.departureTime, "2026-10-12T05:45:00.000Z"); // 75 minutes before 07:00
    assert.strictEqual(plan.actualEta, DEADLINE);
    assert.strictEqual(plan.durationMinutes, 75);
    assert.strictEqual(plan.drivingDurationMinutes, 60);
    assert.strictEqual(plan.stopDurationMinutes, 15);
    assert.strictEqual(plan.stops?.length, 1);
    assert.strictEqual(plan.stops?.[0].durationMinutes, 15);
    assert.deepStrictEqual(new Set(plan.constraints?.map(c => c.type)), new Set(["avoid_tolls", "arrival_deadline", "avoid_highways"]));
    assert.strictEqual(plan.constraintEvaluations?.length, 3);
    assert.strictEqual(plan.stale, undefined);
  });

  test("explicit 'tomorrow' deterministically corrects the model's deadline date", () => {
    const plan = createBasePlan();
    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: "2026-10-22T01:30:00Z" }
      ]
    }, {
      userMessage: "I need to reach Pune Airport by 7 AM tomorrow and avoid tolls.",
      now: new Date("2026-10-21T20:48:42Z"), // 2026-10-22 02:18 IST
      timeZone: "Asia/Kolkata"
    });

    assert.strictEqual(
      prepared.input.constraints.find((c: any) => c.type === "arrival_deadline").value,
      "2026-10-23T01:30:00Z" // still 07:00 IST, now on the requested day
    );
    assert.strictEqual(prepared.input.constraints.find((c: any) => c.type === "avoid_tolls").type, "avoid_tolls");
  });

  test("a follow-up without an explicit relative day keeps the inherited deadline date", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      constraints: [{ type: "arrival_deadline", severity: "hard", value: DEADLINE }]
    };

    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      constraints: [{ type: "avoid_highways", severity: "hard" }]
    }, {
      userMessage: "Avoid highways too.",
      now: new Date("2026-10-21T20:48:42Z"),
      timeZone: "Asia/Kolkata"
    });

    assert.strictEqual(prepared.input.constraints.find((c: any) => c.type === "arrival_deadline").value, DEADLINE);
  });

  test("a constraint-only follow-up keeps the selected stop even if the model resends a different POI", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      stops: [{ name: "Vohuman Cafe", placeId: "249099210", lat: 18.5324382, lon: 73.8768496, durationMinutes: 15 }],
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: DEADLINE }
      ]
    };
    const replacement = { lat: 18.5229615, lon: 73.8638644, name: "Mochi Cafe" };

    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, replacement, AIRPORT],
      stops: [{ locationIndex: 1, ...replacement, placeId: "249438254", durationMinutes: 15 }],
      constraints: [{ type: "avoid_highways", severity: "hard" }]
    }, {
      userMessage: "Avoid highways too.",
      now: new Date("2026-10-21T20:48:42Z"),
      timeZone: "Asia/Kolkata"
    });

    assert.strictEqual(prepared.input.stops.length, 1);
    assert.strictEqual(prepared.input.stops[0].name, "Vohuman Cafe");
    assert.strictEqual(prepared.input.stops[0].durationMinutes, 15);
    assert.strictEqual(prepared.input.locations.length, 3);
    assert.strictEqual(prepared.input.locations[1].name, "Vohuman Cafe");
    assert.ok(prepared.input.locations.some((l: any) => l.name === "Mochi Cafe") === false);
  });

  test("explicit remove_constraints and clear_stops delete only what was named", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      stops: [{ name: CAFE.name, placeId: "cafe_1", lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }],
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "avoid_highways", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: DEADLINE }
      ]
    };

    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      remove_constraints: ["avoid_tolls"],
      clear_stops: true
    });

    assert.deepStrictEqual(new Set(prepared.input.constraints.map((c: any) => c.type)), new Set(["avoid_highways", "arrival_deadline"]));
    assert.deepStrictEqual(prepared.input.stops, []);
    assert.strictEqual(prepared.input.locations.length, 2);
  });

  test("changed origin/destination does not carry the old cafe, but preserves omitted deadline and constraints", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      stops: [{ name: CAFE.name, placeId: "cafe_1", lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }],
      constraints: [
        { type: "avoid_tolls", severity: "hard" },
        { type: "arrival_deadline", severity: "hard", value: DEADLINE }
      ]
    };
    const newOrigin = { lat: 18.62, lon: 73.8, name: "New Origin" };
    const newDestination = { lat: 18.4, lon: 73.95, name: "New Destination" };

    const prepared = prepareCompareRoutesInput(plan, { locations: [newOrigin, newDestination] });

    assert.strictEqual(prepared.journeyChanged, true);
    assert.deepStrictEqual(new Set(prepared.input.constraints.map((c: any) => c.type)), new Set(["avoid_tolls", "arrival_deadline"]));
    assert.deepStrictEqual(prepared.input.stops, []);
    assert.strictEqual(prepared.input.locations.length, 2);
    assert.ok(prepared.warnings.some(w => w.includes("New origin/destination")));

    updateTravelPlanFromCompareRoutes(plan, prepared.input, successfulResult(40));
    assert.strictEqual(plan.destination?.name, "New Destination");
    assert.strictEqual(plan.stops, undefined);
    assert.strictEqual(plan.arrivalDeadline, DEADLINE);
    assert.deepStrictEqual(new Set(plan.constraints?.map(c => c.type)), new Set(["avoid_tolls", "arrival_deadline"]));
  });

  test("departure-first planning preserves the requested departure when a follow-up omits it", () => {
    const plan = createBasePlan();
    const turn1 = {
      locations: [ORIGIN, AIRPORT],
      mode: "auto",
      departure_time: "2026-10-12T06:00:00.000Z",
      constraints: [{ type: "arrival_deadline", severity: "hard", value: DEADLINE }]
    };
    updateTravelPlanFromCompareRoutes(plan, turn1, successfulResult(45, 0, turn1.constraints));

    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      constraints: [{ type: "avoid_highways", severity: "hard" }]
    });

    assert.strictEqual(prepared.input.departure_time, "2026-10-12T06:00:00.000Z");
  });

  test("failed reroute marks the last successful route stale; the next success clears stale", () => {
    const plan = createBasePlan();
    const input = { locations: [ORIGIN, AIRPORT], mode: "auto" };
    updateTravelPlanFromCompareRoutes(plan, input, successfulResult(52));
    assert.strictEqual(plan.distanceKm, 21.4);

    markTravelPlanStale(plan, "Routing provider unavailable");
    assert.strictEqual(plan.stale, true);
    assert.strictEqual(plan.staleReason, "Routing provider unavailable");
    assert.strictEqual(plan.distanceKm, 21.4, "last successful metrics are retained, but marked stale");
    assert.ok(plan.warnings?.some(w => w.includes("stale")));

    updateTravelPlanFromCompareRoutes(plan, input, successfulResult(48));
    assert.strictEqual(plan.stale, undefined);
    assert.strictEqual(plan.staleReason, undefined);
    assert.strictEqual(plan.durationMinutes, 48);
    assert.strictEqual(plan.warnings, undefined);
  });

  test("a selected stop is validated against recently returned POIs when provenance exists", () => {
    const plan: TravelPlan = { ...createBasePlan(), origin: ORIGIN, destination: AIRPORT };
    const recentPlaces = [{ id: "cafe_1", name: "Corner Cafe", lat: CAFE.lat, lon: CAFE.lon, category: "cafe" }];

    const fabricated = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      stops: [{ locationIndex: 1, name: "Invented Cafe", lat: 18.62, lon: 73.95, durationMinutes: 15 }]
    }, { recentPlaces });

    assert.deepStrictEqual(fabricated.input.stops, []);
    assert.ok(fabricated.warnings.some(w => w.includes("did not match a recently returned place")));

    const verified = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      stops: [{ locationIndex: 1, placeId: "cafe_1", name: "Corner Cafe", lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }]
    }, { recentPlaces });

    assert.strictEqual(verified.input.stops.length, 1);
    assert.strictEqual(verified.input.stops[0].placeId, "cafe_1");
    assert.strictEqual(verified.input.locations.length, 3);
  });

  test("incomplete replacement stop reuses the active stop's coordinates and dwell", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      stops: [{ name: CAFE.name, placeId: "cafe_1", lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }]
    };

    const missingCoords = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      stops: [{ locationIndex: 1, name: CAFE.name, durationMinutes: 15 }]
    });
    assert.strictEqual(missingCoords.input.stops.length, 1);
    assert.strictEqual(missingCoords.input.stops[0].lat, CAFE.lat);
    assert.strictEqual(missingCoords.input.stops[0].lon, CAFE.lon);
    assert.strictEqual(missingCoords.input.stops[0].placeId, "cafe_1");
    assert.strictEqual(missingCoords.input.locations.length, 3);

    const missingDwell = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      stops: [{ locationIndex: 1, name: CAFE.name, lat: CAFE.lat, lon: CAFE.lon }]
    });
    assert.strictEqual(missingDwell.input.stops.length, 1);
    assert.strictEqual(missingDwell.input.stops[0].durationMinutes, 15);
    assert.ok(missingDwell.warnings.some(w => w.includes("missing a dwell duration")));
  });

  test("replacement stop data with no usable entries preserves the active stops", () => {
    const plan: TravelPlan = {
      ...createBasePlan(),
      origin: ORIGIN,
      destination: AIRPORT,
      stops: [{ name: CAFE.name, placeId: "cafe_1", lat: CAFE.lat, lon: CAFE.lon, durationMinutes: 15 }]
    };

    const prepared = prepareCompareRoutesInput(plan, {
      locations: [ORIGIN, AIRPORT],
      stops: [{ locationIndex: 1, name: "Unusable Stop" }]
    });

    assert.strictEqual(prepared.input.stops.length, 1);
    assert.strictEqual(prepared.input.stops[0].name, CAFE.name);
    assert.strictEqual(prepared.input.stops[0].durationMinutes, 15);
    assert.ok(prepared.warnings.some(w => w.includes("active stops were preserved")));
  });
});
