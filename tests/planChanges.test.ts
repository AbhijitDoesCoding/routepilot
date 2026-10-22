import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffTravelPlans } from "../frontend/src/lib/planChanges.js";
import type { TravelPlan } from "../frontend/src/types/api.js";

const fmt = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const stop = (name: string, durationMinutes = 15) => ({
  name,
  lat: 18.52,
  lon: 73.85,
  durationMinutes,
});

const basePlan = (overrides: Partial<TravelPlan> = {}): TravelPlan => ({
  id: "plan-1",
  origin: { name: "Home", lat: 18.5, lon: 73.8 },
  destination: { name: "Office", lat: 18.6, lon: 73.9 },
  departureTime: "2026-10-20T09:00:00",
  actualEta: "2026-10-20T09:30:00",
  durationMinutes: 30,
  distanceKm: 12,
  stops: [],
  constraints: [],
  ...overrides,
});

describe("diffTravelPlans", () => {
  test("1. constraint added", () => {
    const previous = basePlan({ constraints: [] });
    const current = basePlan({
      constraints: [{ type: "avoid_highways", severity: "hard" }],
    });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "constraint_added", label: "Highway avoidance added." },
    ]);
  });

  test("1b. constraint added via constraintEvaluations with humanized fallback", () => {
    const previous = basePlan({ constraints: undefined, constraintEvaluations: [] });
    const current = basePlan({
      constraints: undefined,
      constraintEvaluations: [
        { type: "avoid_tolls", severity: "hard", status: "satisfied" },
        { type: "avoid_ferries", severity: "soft", status: "satisfied" },
      ],
    });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "constraint_added", label: "Avoid ferries added." },
      { kind: "constraint_added", label: "Toll avoidance added." },
    ]);
  });

  test("2. constraint removed", () => {
    const previous = basePlan({
      constraints: [{ type: "avoid_highways", severity: "hard" }],
    });
    const current = basePlan({ constraints: [] });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "constraint_removed", label: "Highway avoidance removed." },
    ]);
  });

  test("3. retained stop with dwell during a constraint-only update", () => {
    const previous = basePlan({ stops: [stop("Vohuman Cafe", 15)] });
    const current = basePlan({
      stops: [stop("Vohuman Cafe", 15)],
      constraints: [{ type: "avoid_tolls", severity: "hard" }],
    });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "constraint_added", label: "Toll avoidance added." },
      { kind: "stop_retained", label: "Vohuman Cafe retained — 15-minute stop." },
    ]);
  });

  test("4. stop added", () => {
    const previous = basePlan({ stops: [] });
    const current = basePlan({ stops: [stop("Vohuman Cafe", 15)] });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "stop_added", label: "Vohuman Cafe added to the route." },
    ]);
  });

  test("5. stop removed", () => {
    const previous = basePlan({ stops: [stop("Vohuman Cafe", 15)] });
    const current = basePlan({ stops: [] });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "stop_removed", label: "Vohuman Cafe removed from the route." },
    ]);
  });

  test("6. departure changed", () => {
    const previous = basePlan({ departureTime: "2026-10-20T09:00:00" });
    const current = basePlan({ departureTime: "2026-10-20T09:15:00" });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      {
        kind: "departure_changed",
        label: `Departure changed from ${fmt("2026-10-20T09:00:00")} to ${fmt("2026-10-20T09:15:00")}.`,
      },
    ]);
  });

  test("7. ETA changed", () => {
    const previous = basePlan({ actualEta: "2026-10-20T09:30:00" });
    const current = basePlan({ actualEta: "2026-10-20T09:45:00" });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      {
        kind: "eta_changed",
        label: `Estimated arrival changed from ${fmt("2026-10-20T09:30:00")} to ${fmt("2026-10-20T09:45:00")}.`,
      },
    ]);
  });

  test("7b. duration changed", () => {
    const previous = basePlan({ durationMinutes: 30 });
    const current = basePlan({ durationMinutes: 42 });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      {
        kind: "duration_changed",
        label: "Total duration changed from 30 to 42 minutes.",
      },
    ]);
  });

  test("8. unchanged deadline and retained stop appear only alongside real changes", () => {
    const deadline = "2026-10-20T07:00:00";
    const previous = basePlan({
      arrivalDeadline: deadline,
      stops: [stop("Vohuman Cafe", 15)],
    });
    const current = basePlan({
      arrivalDeadline: deadline,
      stops: [stop("Vohuman Cafe", 15)],
      departureTime: "2026-10-20T09:15:00",
    });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changes, [
      { kind: "stop_retained", label: "Vohuman Cafe retained — 15-minute stop." },
      {
        kind: "departure_changed",
        label: `Departure changed from ${fmt("2026-10-20T09:00:00")} to ${fmt("2026-10-20T09:15:00")}.`,
      },
      { kind: "deadline_unchanged", label: `Arrival deadline unchanged — ${fmt(deadline)}.` },
    ]);
  });

  test("9. same plan passed twice is a no-op", () => {
    const plan = basePlan({
      arrivalDeadline: "2026-10-20T07:00:00",
      stops: [stop("Vohuman Cafe", 15)],
    });

    const result = diffTravelPlans(plan, plan);

    assert.equal(result.status, "no_change");
    assert.deepEqual(result.changes, []);
  });

  test("10. missing or insufficient plans", () => {
    const usable = basePlan();

    assert.deepEqual(diffTravelPlans(undefined, usable), {
      status: "no_baseline",
      changes: [],
    });
    assert.deepEqual(diffTravelPlans(null, usable), {
      status: "no_baseline",
      changes: [],
    });
    assert.deepEqual(diffTravelPlans(usable, undefined), {
      status: "insufficient",
      changes: [],
    });
    assert.deepEqual(diffTravelPlans({ id: "bare" } as TravelPlan, usable), {
      status: "no_baseline",
      changes: [],
    });
    assert.deepEqual(diffTravelPlans(usable, { id: "bare" } as TravelPlan), {
      status: "insufficient",
      changes: [],
    });
  });

  test("11. stale plans are not treated as a successful change", () => {
    const previous = basePlan();
    const current = basePlan({
      departureTime: "2026-10-20T09:15:00",
      stale: true,
      staleReason: "route refresh failed",
    });

    const result = diffTravelPlans(previous, current);

    assert.equal(result.status, "insufficient");
    assert.deepEqual(result.changes, []);

    const staleBaseline = diffTravelPlans(
      basePlan({ stale: true }),
      basePlan({ departureTime: "2026-10-20T09:15:00" })
    );
    assert.equal(staleBaseline.status, "no_baseline");
    assert.deepEqual(staleBaseline.changes, []);
  });

  test("12. duplicate polling and duplicate stops cannot add events", () => {
    const previous = basePlan({ stops: [] });
    const current = basePlan({ stops: [stop("Vohuman Cafe", 15), stop("Vohuman Cafe", 15)] });

    const first = diffTravelPlans(previous, current);
    const second = diffTravelPlans(previous, current);

    assert.deepEqual(first, second);
    assert.equal(first.status, "changed");
    assert.deepEqual(first.changes, [
      { kind: "stop_added", label: "Vohuman Cafe added to the route." },
    ]);
  });
});
