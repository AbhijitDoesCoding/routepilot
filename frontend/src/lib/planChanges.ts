import type { TravelPlan } from "../types/api.js";

export type PlanChangeKind =
  | "constraint_added"
  | "constraint_removed"
  | "stop_added"
  | "stop_removed"
  | "stop_retained"
  | "departure_changed"
  | "eta_changed"
  | "duration_changed"
  | "deadline_unchanged";

export interface PlanChangeEvent {
  kind: PlanChangeKind;
  label: string;
  detail?: string;
}

export type PlanDiffResult =
  | { status: "no_baseline"; changes: [] }
  | { status: "insufficient"; changes: [] }
  | { status: "no_change"; changes: [] }
  | { status: "changed"; changes: PlanChangeEvent[] };

/** One rendered confirmation of a final, successful canonical plan update. */
export interface PlanUpdateNotice {
  id: number;
  result: PlanDiffResult;
}

const CONSTRAINT_LABELS: Record<string, string> = {
  avoid_highways: "Highway avoidance",
  avoid_tolls: "Toll avoidance",
  arrival_deadline: "Arrival deadline",
};

function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
}

function constraintLabel(type: string): string {
  return CONSTRAINT_LABELS[type] ?? humanize(type);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minuteOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : null;
}

function isUsable(plan: TravelPlan | null | undefined): plan is TravelPlan {
  if (!plan) return false;
  return Boolean(
    plan.origin ||
      plan.destination ||
      plan.routeGeometry ||
      plan.departureTime ||
      (typeof plan.distanceKm === "number" && Number.isFinite(plan.distanceKm))
  );
}

function constraintTypes(plan: TravelPlan): Set<string> {
  const types = new Set<string>();
  for (const constraint of plan.constraints ?? []) {
    if (constraint?.type) types.add(constraint.type);
  }
  for (const evaluation of plan.constraintEvaluations ?? []) {
    if (evaluation?.type) types.add(evaluation.type);
  }
  return types;
}

function normalizeStopName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function stopName(stop: { name?: string }): string | null {
  const name = stop?.name?.trim().replace(/\s+/g, " ");
  return name ? name : null;
}

function stopLabel(name: string, durationMinutes: number | undefined): string {
  return Number.isFinite(durationMinutes)
    ? `${name} retained — ${durationMinutes}-minute stop.`
    : `${name} retained.`;
}

export function diffTravelPlans(
  previous: TravelPlan | null | undefined,
  current: TravelPlan | null | undefined
): PlanDiffResult {
  // A stale plan is a failed snapshot, not a successful itinerary change.
  if (!isUsable(previous) || previous.stale) {
    return { status: "no_baseline", changes: [] };
  }
  if (!isUsable(current) || current.stale) {
    return { status: "insufficient", changes: [] };
  }

  const constraintEvents: PlanChangeEvent[] = [];
  const stopEvents: PlanChangeEvent[] = [];
  const timingEvents: PlanChangeEvent[] = [];

  const previousConstraints = constraintTypes(previous);
  const currentConstraints = constraintTypes(current);

  const addedConstraints = [...currentConstraints]
    .filter((type) => !previousConstraints.has(type))
    .sort();
  const removedConstraints = [...previousConstraints]
    .filter((type) => !currentConstraints.has(type))
    .sort();

  for (const type of addedConstraints) {
    constraintEvents.push({
      kind: "constraint_added",
      label: `${constraintLabel(type)} added.`,
    });
  }
  for (const type of removedConstraints) {
    constraintEvents.push({
      kind: "constraint_removed",
      label: `${constraintLabel(type)} removed.`,
    });
  }

  const previousStops = new Map<string, { name: string; durationMinutes?: number }>();
  for (const stop of previous.stops ?? []) {
    const name = stopName(stop);
    if (!name) continue;
    const key = normalizeStopName(name);
    if (!previousStops.has(key)) {
      previousStops.set(key, { name, durationMinutes: stop.durationMinutes });
    }
  }

  const currentStops = new Map<string, { name: string; durationMinutes?: number }>();
  for (const stop of current.stops ?? []) {
    const name = stopName(stop);
    if (!name) continue;
    const key = normalizeStopName(name);
    if (!currentStops.has(key)) {
      currentStops.set(key, { name, durationMinutes: stop.durationMinutes });
    }
  }

  for (const [key, stop] of currentStops) {
    if (!previousStops.has(key)) {
      stopEvents.push({
        kind: "stop_added",
        label: `${stop.name} added to the route.`,
      });
    }
  }
  for (const [key, stop] of previousStops) {
    if (!currentStops.has(key)) {
      stopEvents.push({
        kind: "stop_removed",
        label: `${stop.name} removed from the route.`,
      });
    }
  }

  const stops = [...currentStops.entries()]
    .filter(([key]) => previousStops.has(key))
    .map(([, stop]) => stop);

  const previousDeparture = minuteOf(previous.departureTime);
  const currentDeparture = minuteOf(current.departureTime);
  if (
    previousDeparture !== null &&
    currentDeparture !== null &&
    previousDeparture !== currentDeparture
  ) {
    timingEvents.push({
      kind: "departure_changed",
      label: `Departure changed from ${formatTime(previous.departureTime!)} to ${formatTime(current.departureTime!)}.`,
    });
  }

  const previousEta = minuteOf(previous.actualEta);
  const currentEta = minuteOf(current.actualEta);
  if (previousEta !== null && currentEta !== null && previousEta !== currentEta) {
    timingEvents.push({
      kind: "eta_changed",
      label: `Estimated arrival changed from ${formatTime(previous.actualEta!)} to ${formatTime(current.actualEta!)}.`,
    });
  }

  const previousDuration = previous.durationMinutes;
  const currentDuration = current.durationMinutes;
  if (
    typeof previousDuration === "number" &&
    Number.isFinite(previousDuration) &&
    typeof currentDuration === "number" &&
    Number.isFinite(currentDuration) &&
    previousDuration !== currentDuration
  ) {
    timingEvents.push({
      kind: "duration_changed",
      label: `Total duration changed from ${previousDuration} to ${currentDuration} minutes.`,
    });
  }

  const hasMeaningfulChange =
    constraintEvents.length > 0 ||
    stopEvents.length > 0 ||
    timingEvents.length > 0;

  if (!hasMeaningfulChange) {
    return { status: "no_change", changes: [] };
  }

  const changes: PlanChangeEvent[] = [
    ...constraintEvents,
    ...stopEvents,
    ...stops.map((stop) => ({
      kind: "stop_retained" as const,
      label: stopLabel(stop.name, stop.durationMinutes),
    })),
    ...timingEvents,
  ];

  const previousDeadline = minuteOf(previous.arrivalDeadline);
  const currentDeadline = minuteOf(current.arrivalDeadline);
  if (
    previousDeadline !== null &&
    currentDeadline !== null &&
    previousDeadline === currentDeadline
  ) {
    changes.push({
      kind: "deadline_unchanged",
      label: `Arrival deadline unchanged — ${formatTime(current.arrivalDeadline!)}.`,
    });
  }

  const seen = new Set<string>();
  const uniqueChanges = changes.filter((change) => {
    const key = `${change.kind}|${change.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { status: "changed", changes: uniqueChanges };
}
