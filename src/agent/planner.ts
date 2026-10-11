import { TravelPlan } from "./types.js";
import { TimeUtils } from "../domain/constraints.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

/**
 * Deterministically update the canonical TravelPlan from a compare_routes tool execution.
 * Both BedrockAgent and GroqAgent share this exact implementation.
 */
export function updateTravelPlanFromCompareRoutes(travelPlan: TravelPlan, input: any, result: any): void {
  try {
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

    if (input.constraints) {
      travelPlan.constraints = input.constraints;
    }
    if (input.locations && input.locations.length >= 2) {
      travelPlan.origin = input.locations[0];
      travelPlan.destination = input.locations[input.locations.length - 1];
    }
    if (input.mode) {
      travelPlan.transportMode = input.mode;
    }

    if (input.stops && Array.isArray(input.stops)) {
      travelPlan.stops = input.stops;
    } else {
      travelPlan.stops = undefined;
    }

    // Infeasible route handling: do not present invalid routes as successful recommendations
    if (!result || !result.feasible) {
      const reason = result?.reason || "No route satisfies all hard constraints.";
      travelPlan.warnings = [reason];
      travelPlan.routeGeometry = undefined;
      travelPlan.durationMinutes = undefined;
      travelPlan.drivingDurationMinutes = undefined;
      travelPlan.stopDurationMinutes = undefined;
      travelPlan.distanceKm = undefined;
      travelPlan.departureTime = undefined;
      travelPlan.actualEta = undefined;
      travelPlan.bufferMinutes = undefined;
      if (result?.recommended?.constraintEvaluations) {
        travelPlan.constraintEvaluations = result.recommended.constraintEvaluations;
      }
      return;
    }

    // Feasible route handling
    if (result.feasible && result.recommended && result.recommended.route) {
      const route = result.recommended.route;
      travelPlan.warnings = undefined;
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
        travelPlan.warnings = ["Missing or malformed route geometry from routing provider."];
      }

      if (result.recommended.constraintEvaluations) {
        travelPlan.constraintEvaluations = result.recommended.constraintEvaluations;
      }

      const arrivalConstraint = input.constraints?.find((c: any) => c.type === "arrival_deadline");

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
    }
  } catch (err) {
    logger.error({ error: err }, "Failed to parse compare_routes result for TravelPlan update");
  }
}
