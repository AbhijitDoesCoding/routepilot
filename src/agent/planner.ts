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
 * Deterministically update the canonical TravelPlan from a successful compare_routes tool execution.
 * Both BedrockAgent and GroqAgent share this exact implementation.
 */
export function updateTravelPlanFromCompareRoutes(travelPlan: TravelPlan, input: any, result: any): void {
  try {
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

    if (result.feasible && result.recommended && result.recommended.route) {
      const route = result.recommended.route;
      travelPlan.durationMinutes = route.durationMinutes;
      travelPlan.drivingDurationMinutes = route.drivingDurationMinutes;
      travelPlan.stopDurationMinutes = route.stopDurationMinutes;
      travelPlan.distanceKm = route.distanceKm;
      travelPlan.routeGeometry = route.geometry;

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
      }
    }
  } catch (err) {
    logger.error({ error: err }, "Failed to parse compare_routes result for TravelPlan update");
  }
}
