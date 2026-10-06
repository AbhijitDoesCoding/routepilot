import { RouteResult } from "../providers/routing/types.js";

export type ConstraintType = "avoid_tolls" | "avoid_highways" | "max_walking_distance" | "arrival_deadline";
export type Severity = "hard" | "soft";

export type RouteConstraint = 
  | { type: "avoid_tolls"; severity: Severity }
  | { type: "avoid_highways"; severity: Severity }
  | { type: "max_walking_distance"; severity: Severity; value: number }
  | { type: "arrival_deadline"; severity: Severity; value: string };

export type EvaluationStatus = "satisfied" | "violated" | "not_evaluable";

export interface ConstraintEvaluation {
  type: ConstraintType;
  severity: Severity;
  status: EvaluationStatus;
  reason?: string;
}

export interface RouteEvaluation {
  route: RouteCandidate;
  valid: boolean;
  score: number;
  constraintEvaluations: ConstraintEvaluation[];
  violatedConstraints: ConstraintType[];
  notEvaluableConstraints: ConstraintType[];
  satisfiedConstraints: ConstraintType[];
  explanation: string;
}

export interface RouteCandidate extends RouteResult {
  candidateId: string;
  costingProfile: string;
}

export class ConstraintEngine {
  private static DURATION_WEIGHT = 1.0;
  private static DISTANCE_WEIGHT = 0.5;
  private static SOFT_VIOLATION_PENALTY = 50.0;
  private static NOT_EVALUABLE_SOFT_PENALTY = 20.0;

  /**
   * Evaluate a route candidate against constraints.
   * @param candidate The route to evaluate.
   * @param constraints Array of constraints.
   * @param departureTimeIso Optional departure time needed for time-based evaluations.
   */
  public evaluate(
    candidate: RouteCandidate, 
    constraints: RouteConstraint[],
    departureTimeIso?: string
  ): RouteEvaluation {
    let valid = true;
    const constraintEvaluations: ConstraintEvaluation[] = [];
    const violated: ConstraintType[] = [];
    const satisfied: ConstraintType[] = [];
    const notEvaluable: ConstraintType[] = [];
    let softPenalties = 0;

    for (const constraint of constraints) {
      let status: EvaluationStatus = "not_evaluable";
      let reason: string | undefined;

      switch (constraint.type) {
        case "avoid_tolls":
          status = candidate.hasToll ? "violated" : "satisfied";
          reason = candidate.hasToll ? "Route contains tolls" : "No tolls on route";
          break;

        case "avoid_highways":
          status = candidate.hasHighway ? "violated" : "satisfied";
          reason = candidate.hasHighway ? "Route uses highways" : "No highways on route";
          break;

        case "max_walking_distance":
          if (typeof candidate.walkingDistanceMeters === "number") {
            if (candidate.walkingDistanceMeters > constraint.value) {
              status = "violated";
              reason = `Walking distance (${Math.round(candidate.walkingDistanceMeters)}m) exceeds maximum (${constraint.value}m)`;
            } else {
              status = "satisfied";
              reason = `Walking distance (${Math.round(candidate.walkingDistanceMeters)}m) is within limit`;
            }
          } else {
            status = "not_evaluable";
            reason = "Walking distance metadata unavailable for this route";
          }
          break;

        case "arrival_deadline":
          if (departureTimeIso) {
            const arrival = TimeUtils.calculateArrivalTime(departureTimeIso, candidate.durationMinutes);
            const buffer = TimeUtils.calculateBuffer(arrival, constraint.value);
            if (buffer < 0) {
              status = "violated";
              reason = `Arrives ${Math.abs(Math.round(buffer))} minutes late`;
            } else {
              status = "satisfied";
              reason = `Arrives ${Math.round(buffer)} minutes before deadline`;
            }
          } else {
            status = "not_evaluable";
            reason = "Departure time is unknown; cannot compute arrival time";
          }
          break;
      }

      constraintEvaluations.push({
        type: constraint.type,
        severity: constraint.severity,
        status,
        reason
      });

      if (status === "violated") {
        violated.push(constraint.type);
        if (constraint.severity === "hard") {
          valid = false;
        } else {
          softPenalties += ConstraintEngine.SOFT_VIOLATION_PENALTY;
        }
      } else if (status === "not_evaluable") {
        notEvaluable.push(constraint.type);
        if (constraint.severity === "hard") {
          valid = false; // Hard constraint must be proven satisfied
        } else {
          softPenalties += ConstraintEngine.NOT_EVALUABLE_SOFT_PENALTY;
        }
      } else {
        satisfied.push(constraint.type);
      }
    }

    const score = (candidate.durationMinutes * ConstraintEngine.DURATION_WEIGHT) +
                  (candidate.distanceKm * ConstraintEngine.DISTANCE_WEIGHT) +
                  softPenalties;

    const explanationParts = [];
    if (!valid) {
      const invalidReasons = [];
      if (violated.some(v => constraints.find(c => c.type === v)?.severity === "hard")) {
        invalidReasons.push(`violates hard constraints (${violated.filter(v => constraints.find(c => c.type === v)?.severity === 'hard').join(', ')})`);
      }
      if (notEvaluable.some(v => constraints.find(c => c.type === v)?.severity === "hard")) {
        invalidReasons.push(`cannot evaluate hard constraints (${notEvaluable.filter(v => constraints.find(c => c.type === v)?.severity === 'hard').join(', ')})`);
      }
      explanationParts.push(`Invalid: ${invalidReasons.join(" and ")}.`);
    } else {
      explanationParts.push("Valid route.");
    }
    
    if (violated.length > 0) {
      explanationParts.push(`Violated: ${violated.join(', ')}.`);
    }

    return {
      route: candidate,
      valid,
      score,
      constraintEvaluations,
      violatedConstraints: violated,
      notEvaluableConstraints: notEvaluable,
      satisfiedConstraints: satisfied,
      explanation: explanationParts.join(" ")
    };
  }

  public rank(evaluations: RouteEvaluation[]): { feasible: boolean, recommended?: RouteEvaluation, alternatives: RouteEvaluation[], reason?: string } {
    const validEvals = evaluations.filter(e => e.valid);
    const invalidEvals = evaluations.filter(e => !e.valid);
    
    // Sort invalid routes by score too, just in case
    invalidEvals.sort((a, b) => a.score - b.score);

    if (validEvals.length === 0) {
      return {
        feasible: false,
        recommended: invalidEvals[0],
        alternatives: invalidEvals.slice(1),
        reason: "No route satisfies all hard constraints."
      };
    }

    // Sort valid routes by score (lowest is best)
    validEvals.sort((a, b) => a.score - b.score);

    return {
      feasible: true,
      recommended: validEvals[0],
      alternatives: [...validEvals.slice(1), ...invalidEvals],
      reason: "Successfully found a feasible route."
    };
  }
}

export class TimeUtils {
  /**
   * Returns latest departure time given an arrival deadline, duration, and buffer.
   */
  public static calculateLatestDeparture(arrivalDeadlineIso: string, durationMinutes: number, bufferMinutes: number = 0): string {
    const arrivalTime = new Date(arrivalDeadlineIso);
    const totalSubtractMs = (durationMinutes + bufferMinutes) * 60 * 1000;
    const latestDeparture = new Date(arrivalTime.getTime() - totalSubtractMs);
    return latestDeparture.toISOString();
  }

  /**
   * Returns arrival time given a departure time and duration.
   */
  public static calculateArrivalTime(departureTimeIso: string, durationMinutes: number): string {
    const depTime = new Date(departureTimeIso);
    const arrivalTime = new Date(depTime.getTime() + durationMinutes * 60 * 1000);
    return arrivalTime.toISOString();
  }

  /**
   * Returns buffer in minutes between arrival time and arrival deadline.
   * Positive means arriving before deadline. Negative means arriving late.
   */
  public static calculateBuffer(arrivalTimeIso: string, arrivalDeadlineIso: string): number {
    const arr = new Date(arrivalTimeIso);
    const deadline = new Date(arrivalDeadlineIso);
    return (deadline.getTime() - arr.getTime()) / (60 * 1000);
  }
}
