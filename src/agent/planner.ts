import { TravelPlan } from "./types.js";
import { ConstraintType, RouteConstraint, TimeUtils } from "../domain/constraints.js";
import { Place } from "../providers/places/types.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

const SAME_ENDPOINT_TOLERANCE_METERS = 200;
const STOP_MATCH_TOLERANCE_METERS = 100;

type StopInput = NonNullable<TravelPlan["stops"]>[number] & { locationIndex?: number };

export interface PlanUpdateOptions {
  recentPlaces?: Place[];
  mergeWarnings?: string[];
  userMessage?: string;
  now?: Date;
  timeZone?: string;
}

export interface PreparedCompareRoutesInput {
  input: any;
  warnings: string[];
  journeyChanged: boolean;
}

const isFiniteNumber = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * sinLon * sinLon;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const samePoint = (
  a: { lat: number; lon: number } | undefined,
  b: { lat: number; lon: number } | undefined,
  toleranceMeters: number
): boolean => {
  if (!a || !b || !isFiniteNumber(a.lat) || !isFiniteNumber(a.lon) || !isFiniteNumber(b.lat) || !isFiniteNumber(b.lon)) {
    return false;
  }
  return distanceMeters(a, b) <= toleranceMeters;
};

const sameStop = (a: StopInput, b: StopInput): boolean => {
  if (a.placeId && b.placeId && a.placeId === b.placeId) return true;
  return samePoint(a, b, STOP_MATCH_TOLERANCE_METERS);
};

const uniqueWarnings = (warnings: string[]): string[] => [...new Set(warnings.filter(Boolean))];

const cloneStops = (stops: StopInput[] | undefined): StopInput[] =>
  (stops ?? []).map(s => ({ ...s }));

const STOP_INTENT_PATTERN = /\b(coffee|caf[eé]s?|shops?|stops?|break|breakfast|lunch|dinner|restaurant|food|fuel|petrol|charging|atm|pharmacy|store|market|visit|pickup|pick up|via|detour)\b/i;

const localDate = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const shiftDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

/**
 * The model chooses the absolute date, but explicit relative-day words are
 * deterministic and must not drift. If the user said "tomorrow" (or "today"),
 * rewrite the wall-clock date while preserving the requested time and offset.
 */
const alignExplicitRelativeDate = (
  iso: string,
  userMessage: string,
  now: Date,
  timeZone: string
): string => {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return iso;
  const target = /\btomorrow\b/i.test(userMessage)
    ? shiftDate(localDate(now, timeZone), 1)
    : /\btoday\b/i.test(userMessage)
      ? localDate(now, timeZone)
      : undefined;
  if (!target) return iso;
  if (localDate(new Date(iso), timeZone) === target) return iso;
  return iso.replace(/^\d{4}-\d{2}-\d{2}/, target);
};

/**
 * Deterministically merges the active session plan into a new compare_routes input.
 *
 * Semantics:
 * - Endpoints unchanged: omitted constraints, deadline/departure mode and stops are inherited.
 * - Endpoints changed: prior stops are NOT carried automatically (the stop must be
 *   rediscovered for the new journey). Active constraints and the deadline ARE preserved,
 *   because omission never deletes them.
 * - constraints present: upsert by type; other active constraints are preserved.
 * - clear_stops / remove_constraints: explicit deletion. Omission never deletes.
 * - stops present (non-empty): replaces the stop list. Missing `stops` preserves prior stops.
 * - Incomplete replacement stops are completed from the active stop or a recently returned
 *   place by place ID or name. If no usable replacement survives, the active stops are kept.
 * - Selected stops are matched against recent find_places_along_route results when available,
 *   and their waypoints are inserted into `locations` before the route is calculated.
 */
export function prepareCompareRoutesInput(
  travelPlan: TravelPlan,
  rawInput: any,
  options: PlanUpdateOptions = {}
): PreparedCompareRoutesInput {
  const warnings: string[] = [];
  const input: any = { ...(rawInput || {}) };
  input.locations = Array.isArray(rawInput?.locations)
    ? rawInput.locations.map((l: any) => ({ ...l }))
    : rawInput?.locations;

  const locations = input.locations;
  const hasPriorJourney = !!travelPlan.origin && !!travelPlan.destination;
  const hasNewEndpoints = Array.isArray(locations) && locations.length >= 2;
  const journeyChanged = !!(hasPriorJourney && hasNewEndpoints && (
    !samePoint(travelPlan.origin, locations[0], SAME_ENDPOINT_TOLERANCE_METERS) ||
    !samePoint(travelPlan.destination, locations[locations.length - 1], SAME_ENDPOINT_TOLERANCE_METERS)
  ));

  if (journeyChanged) {
    warnings.push("New origin/destination detected; prior stops were not carried over. Active journey constraints and the deadline were preserved. Rediscover stops for the new journey.");
  }

  // 1. Constraints: inherit, then upsert new ones, then apply explicit removals.
  // Constraints are user goals, so they survive endpoint changes unless explicitly removed.
  const removals = new Set<ConstraintType>(
    Array.isArray(rawInput?.remove_constraints) ? rawInput.remove_constraints : []
  );
  let mergedConstraints: RouteConstraint[] = (travelPlan.constraints ?? []).map(c => ({ ...c }));

  if (Array.isArray(rawInput?.constraints)) {
    for (const constraint of rawInput.constraints) {
      if (!constraint || typeof constraint.type !== "string") continue;
      mergedConstraints = mergedConstraints.filter(c => c.type !== constraint.type);
      mergedConstraints.push({ ...constraint });
    }
  }
  mergedConstraints = mergedConstraints.filter(c => !removals.has(c.type));
  input.constraints = mergedConstraints;

  // 2. Stops: explicit clear, explicit replacement, or inheritance.
  // A constraint-only follow-up must not silently swap the chosen stop just
  // because the model resent a different POI. Replacement requires stop intent.
  const hasStopInput = Array.isArray(rawInput?.stops) && rawInput.stops.length > 0;
  const stopChangeRequested = !options.userMessage || STOP_INTENT_PATTERN.test(options.userMessage);
  let stops: StopInput[];
  if (rawInput?.clear_stops === true) {
    stops = [];
  } else if (hasStopInput && stopChangeRequested) {
    stops = cloneStops(rawInput.stops);
  } else if (!journeyChanged) {
    stops = cloneStops(travelPlan.stops);
  } else {
    stops = [];
  }

  const priorStops = journeyChanged ? [] : cloneStops(travelPlan.stops);
  const cleanedStops: StopInput[] = [];
  const stopName = (stop: StopInput | undefined) => stop?.name?.trim().toLowerCase() || "";
  for (const rawCandidate of stops) {
    const candidate: StopInput = { ...rawCandidate };
    const priorMatch = priorStops.find(s => sameStop(s, candidate) ||
      (!!stopName(candidate) && stopName(s) === stopName(candidate)));

    if (!isFiniteNumber(candidate.lat) || !isFiniteNumber(candidate.lon)) {
      const recentMatch = options.recentPlaces?.find(p =>
        (!!candidate.placeId && p.id === candidate.placeId) ||
        (!!stopName(candidate) && p.name.trim().toLowerCase() === stopName(candidate)));
      const known = priorMatch ?? recentMatch;
      if (!known) {
        warnings.push(`Stop "${candidate?.name ?? "unknown"}" has invalid coordinates and was ignored.`);
        continue;
      }
      candidate.lat = known.lat;
      candidate.lon = known.lon;
      candidate.name = candidate.name || known.name;
      candidate.placeId = candidate.placeId ?? (priorMatch ? priorMatch.placeId : (known as Place).id);
      warnings.push(`Stop "${candidate.name}" was missing coordinates; restored them from the ${priorMatch ? "active plan" : "recently returned place"}.`);
    }

    if (!isFiniteNumber(candidate.durationMinutes) || candidate.durationMinutes <= 0) {
      const priorWithDwell = priorStops.find(s => s === priorMatch || sameStop(s, candidate) || stopName(s) === stopName(candidate));
      if (!priorWithDwell || !isFiniteNumber(priorWithDwell.durationMinutes) || priorWithDwell.durationMinutes <= 0) {
        warnings.push(`Stop "${candidate.name ?? "unknown"}" has no valid dwell duration and was ignored.`);
        continue;
      }
      candidate.durationMinutes = priorWithDwell.durationMinutes;
      warnings.push(`Stop "${candidate.name}" was missing a dwell duration; restored ${candidate.durationMinutes} minutes from the active plan.`);
    }

    if (hasNewEndpoints && (
      samePoint(candidate, locations[0], STOP_MATCH_TOLERANCE_METERS) ||
      samePoint(candidate, locations[locations.length - 1], STOP_MATCH_TOLERANCE_METERS)
    )) {
      warnings.push(`Stop "${candidate.name ?? "unknown"}" overlaps an origin/destination and was ignored.`);
      continue;
    }

    const activeMatch = priorStops.find(s => sameStop(s, candidate));
    if (activeMatch) {
      cleanedStops.push({
        ...candidate,
        placeId: candidate.placeId ?? activeMatch.placeId,
        name: activeMatch.name || candidate.name,
        lat: activeMatch.lat,
        lon: activeMatch.lon
      });
      continue;
    }

    if (!journeyChanged && options.recentPlaces && options.recentPlaces.length > 0) {
      const verified = options.recentPlaces.find(p =>
        (candidate.placeId && p.id === candidate.placeId) ||
        samePoint(candidate, p, STOP_MATCH_TOLERANCE_METERS)
      );
      if (!verified) {
        warnings.push(`Stop "${candidate.name ?? "unknown"}" did not match a recently returned place and was ignored.`);
        continue;
      }
      cleanedStops.push({
        ...candidate,
        placeId: verified.id,
        name: verified.name,
        lat: verified.lat,
        lon: verified.lon
      });
      continue;
    }

    cleanedStops.push({ ...candidate });
  }

  if (hasStopInput && rawInput?.clear_stops !== true && cleanedStops.length === 0 && priorStops.length > 0) {
    cleanedStops.push(...cloneStops(priorStops));
    warnings.push("The replacement stop list contained no usable stop; the active stops were preserved.");
  }

  const dedupedStops: StopInput[] = [];
  for (const stop of cleanedStops) {
    if (!dedupedStops.some(existing => sameStop(existing, stop))) {
      dedupedStops.push(stop);
    }
  }

  // 3. Ensure every selected stop is an actual route waypoint before execution.
  const routeLocations = Array.isArray(locations) ? locations : [];

  // If a constraint-only follow-up resent a different stop, do not leave its
  // orphaned waypoint in the route. The active stop is reinserted below.
  if (hasStopInput && !stopChangeRequested && !journeyChanged && routeLocations.length >= 2) {
    const ignored = new Set<number>();
    for (const rawStop of rawInput.stops) {
      if (
        Number.isInteger(rawStop?.locationIndex) &&
        rawStop.locationIndex > 0 &&
        rawStop.locationIndex < routeLocations.length - 1
      ) {
        ignored.add(rawStop.locationIndex);
      }
    }
    for (let i = routeLocations.length - 2; i >= 1; i--) {
      if (ignored.has(i)) continue;
      const isIgnoredStop = rawInput.stops.some((rawStop: any) =>
        isFiniteNumber(rawStop?.lat) &&
        isFiniteNumber(rawStop?.lon) &&
        samePoint(rawStop, routeLocations[i], STOP_MATCH_TOLERANCE_METERS)
      );
      if (isIgnoredStop) ignored.add(i);
    }
    if (ignored.size > 0) {
      for (let i = routeLocations.length - 1; i >= 0; i--) {
        if (ignored.has(i)) routeLocations.splice(i, 1);
      }
    }
  }

  for (const stop of dedupedStops) {
    let index = routeLocations.findIndex((loc: any) => samePoint(loc, stop, STOP_MATCH_TOLERANCE_METERS));
    if (index === -1 && routeLocations.length >= 2) {
      const insertAt = routeLocations.length - 1;
      routeLocations.splice(insertAt, 0, { lat: stop.lat, lon: stop.lon, name: stop.name });
      index = insertAt;
    }
    if (index === -1) {
      warnings.push(`Stop "${stop.name}" could not be added to the route waypoints and was ignored.`);
      continue;
    }
    stop.locationIndex = index;
  }

  input.locations = routeLocations;
  input.stops = dedupedStops.filter(s => isFiniteNumber(s.locationIndex));

  // 4. Preserve departure-first mode when the follow-up omits the departure.
  const arrivalConstraint = mergedConstraints.find(c => c.type === "arrival_deadline");
  if (!input.departure_time &&
      travelPlan.planningMode === "departure_first" &&
      travelPlan.requestedDepartureTime) {
    input.departure_time = travelPlan.requestedDepartureTime;
  }

  // 5. Explicit relative-day words ("tomorrow", "today") override the date
  // component chosen by the model; time of day and offset are preserved.
  if (options.userMessage) {
    const timeZone = options.timeZone || process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";
    const now = options.now ?? new Date();
    if (arrivalConstraint?.value) {
      arrivalConstraint.value = alignExplicitRelativeDate(arrivalConstraint.value, options.userMessage, now, timeZone);
    }
    if (input.departure_time) {
      input.departure_time = alignExplicitRelativeDate(input.departure_time, options.userMessage, now, timeZone);
    }
    input.constraints = mergedConstraints;
  }

  logger.info({
    journeyChanged,
    constraintTypes: mergedConstraints.map(c => c.type),
    stopNames: input.stops.map((s: StopInput) => s.name),
    stopWaypoints: input.stops.map((s: StopInput) => s.locationIndex),
    hasDeadline: !!arrivalConstraint,
    departureTime: input.departure_time
  }, "Prepared compare_routes input for deterministic plan continuity");

  return { input, warnings, journeyChanged };
}

/**
 * Propagate active avoid preferences into POI corridor routing so the selected
 * stop is relevant to the constrained journey, not an unconstrained baseline.
 */
export function prepareFindPlacesInput(travelPlan: TravelPlan, rawInput: any): any {
  const input = { ...(rawInput || {}) };
  const types = new Set((travelPlan.constraints ?? []).map(c => c.type));
  if (input.avoid_tolls === undefined && types.has("avoid_tolls")) {
    input.avoid_tolls = true;
  }
  if (input.avoid_highways === undefined && types.has("avoid_highways")) {
    input.avoid_highways = true;
  }
  return input;
}

function clearRouteMetrics(travelPlan: TravelPlan): void {
  travelPlan.routeGeometry = undefined;
  travelPlan.durationMinutes = undefined;
  travelPlan.drivingDurationMinutes = undefined;
  travelPlan.stopDurationMinutes = undefined;
  travelPlan.distanceKm = undefined;
  travelPlan.departureTime = undefined;
  travelPlan.actualEta = undefined;
  travelPlan.bufferMinutes = undefined;
}

/**
 * Explicitly marks the last successful plan as stale after a failed recalculation.
 * Metrics are retained so the user can still see the last known route, but the
 * stale flag and warning make clear they are not the result of the latest request.
 */
export function markTravelPlanStale(travelPlan: TravelPlan, reason: string): void {
  travelPlan.stale = true;
  travelPlan.staleReason = reason;
  const warning = travelPlan.distanceKm !== undefined
    ? "The latest route recalculation failed. The displayed route and metrics are from the last successful calculation and are stale."
    : "The latest route recalculation failed. No current route is available.";
  travelPlan.warnings = uniqueWarnings([...(travelPlan.warnings ?? []), warning, reason]);
}

/**
 * Deterministically update the canonical TravelPlan from a compare_routes tool execution.
 * Both BedrockAgent and GroqAgent share this exact implementation.
 */
export function updateTravelPlanFromCompareRoutes(
  travelPlan: TravelPlan,
  rawInput: any,
  result: any,
  options: PlanUpdateOptions = {}
): void {
  try {
    const prepared = prepareCompareRoutesInput(travelPlan, rawInput, options);
    const input = prepared.input;
    const mergeWarnings = uniqueWarnings([...prepared.warnings, ...(options.mergeWarnings ?? [])]);

    const hasRecommended = !!(result && result.recommended);
    const hasRoute = !!(result?.recommended?.route);
    const geometry = result?.recommended?.route?.geometry;
    const coordCount = Array.isArray(geometry?.coordinates) ? geometry.coordinates.length : 0;
    const constraintStatuses = result?.recommended?.constraintEvaluations?.map((ce: any) => ({
      type: ce.type,
      status: ce.status,
      severity: ce.severity
    })) || [];

    logger.info({
      feasible: !!result?.feasible,
      hasRecommended,
      hasRoute,
      hasGeometry: !!geometry,
      geometryType: geometry?.type,
      coordinateCount: coordCount,
      constraintStatuses
    }, "TravelPlan update diagnostic from compare_routes");

    // Apply the merged request state first. This is the canonical record even if
    // the provider then fails or returns an infeasible result.
    travelPlan.constraints = input.constraints;
    if (Array.isArray(input.locations) && input.locations.length >= 2) {
      travelPlan.origin = input.locations[0];
      travelPlan.destination = input.locations[input.locations.length - 1];
    }
    if (input.mode) {
      travelPlan.transportMode = input.mode;
    }
    travelPlan.stops = input.stops && input.stops.length > 0 ? input.stops : undefined;
    travelPlan.requestedDepartureTime = input.departure_time;
    travelPlan.planningMode = input.departure_time
      ? "departure_first"
      : (input.constraints.find((c: RouteConstraint) => c.type === "arrival_deadline") ? "deadline_first" : undefined);

    const arrivalConstraint = input.constraints.find((c: RouteConstraint) => c.type === "arrival_deadline");

    // A successful, evaluated infeasible result is not stale: it is the current answer.
    if (!result || !result.feasible) {
      const reason = result?.reason || "No route satisfies all hard constraints.";
      travelPlan.stale = undefined;
      travelPlan.staleReason = undefined;
      travelPlan.warnings = uniqueWarnings([reason, ...mergeWarnings]);
      clearRouteMetrics(travelPlan);
      travelPlan.arrivalDeadline = arrivalConstraint?.value;
      if (result?.recommended?.constraintEvaluations) {
        travelPlan.constraintEvaluations = result.recommended.constraintEvaluations;
      }
      return;
    }

    // A "successful" comparison without a route is a malformed/failed reroute.
    if (!result.recommended || !result.recommended.route) {
      clearRouteMetrics(travelPlan);
      travelPlan.arrivalDeadline = arrivalConstraint?.value;
      travelPlan.constraintEvaluations = result.recommended?.constraintEvaluations ?? travelPlan.constraintEvaluations;
      markTravelPlanStale(travelPlan, "The routing provider returned no usable route.");
      return;
    }

    const route = result.recommended.route;
    travelPlan.stale = undefined;
    travelPlan.staleReason = undefined;
    travelPlan.warnings = mergeWarnings.length > 0 ? mergeWarnings : undefined;
    travelPlan.durationMinutes = route.durationMinutes;
    travelPlan.drivingDurationMinutes = route.drivingDurationMinutes;
    travelPlan.stopDurationMinutes = route.stopDurationMinutes;
    travelPlan.distanceKm = route.distanceKm;

    // Validate GeoJSON geometry
    if (
      route.geometry &&
      route.geometry.type === "LineString" &&
      Array.isArray(route.geometry.coordinates) &&
      route.geometry.coordinates.length >= 2
    ) {
      travelPlan.routeGeometry = route.geometry;
    } else {
      logger.warn({ routeId: route.candidateId }, "Missing or malformed route geometry from compare_routes candidate");
      travelPlan.routeGeometry = undefined;
      travelPlan.warnings = uniqueWarnings([
        ...(travelPlan.warnings ?? []),
        "Missing or malformed route geometry from routing provider."
      ]);
    }

    if (result.recommended.constraintEvaluations) {
      travelPlan.constraintEvaluations = result.recommended.constraintEvaluations;
    }

    if (input.departure_time) {
      // Departure-first planning
      travelPlan.departureTime = input.departure_time;
      travelPlan.actualEta = TimeUtils.calculateArrivalTime(input.departure_time, route.durationMinutes);

      if (arrivalConstraint?.value) {
        travelPlan.arrivalDeadline = arrivalConstraint.value;
        travelPlan.bufferMinutes = TimeUtils.calculateBuffer(travelPlan.actualEta, arrivalConstraint.value);
      } else {
        travelPlan.arrivalDeadline = undefined;
        travelPlan.bufferMinutes = undefined;
      }
    } else if (arrivalConstraint?.value) {
      // Deadline-first planning
      travelPlan.arrivalDeadline = arrivalConstraint.value;
      const requiredBuffer = 0; // Default buffer for now

      travelPlan.departureTime = TimeUtils.calculateLatestDeparture(arrivalConstraint.value, route.durationMinutes, requiredBuffer);
      travelPlan.actualEta = TimeUtils.calculateArrivalTime(travelPlan.departureTime, route.durationMinutes);
      travelPlan.bufferMinutes = requiredBuffer;
    } else {
      travelPlan.departureTime = undefined;
      travelPlan.actualEta = undefined;
      travelPlan.arrivalDeadline = undefined;
      travelPlan.bufferMinutes = undefined;
    }
  } catch (err) {
    logger.error({ error: err }, "Failed to parse compare_routes result for TravelPlan update");
    markTravelPlanStale(travelPlan, "The route result could not be processed.");
  }
}
