import { RouteResult } from "../providers/routing/types.js";

export type ConstraintType = "avoid_tolls" | "avoid_highways" | "max_walking_distance";

export interface RouteConstraint {
  type: ConstraintType;
  severity: "hard" | "soft";
  value?: any;
}

export interface RouteEvaluation {
  route: RouteCandidate;
  valid: boolean;
  violatedConstraints: ConstraintType[];
  satisfiedConstraints: ConstraintType[];
  score: number;
  explanation: string;
}

export interface RouteCandidate extends RouteResult {
  candidateId: string;
  costingProfile: string;
}

export class ConstraintEngine {
  /**
   * Deterministic score weights.
   * Lower score is better.
   */
  private static DURATION_WEIGHT = 1.0;
  private static DISTANCE_WEIGHT = 0.5;
  private static SOFT_VIOLATION_PENALTY = 50.0;

  public evaluate(candidate: RouteCandidate, constraints: RouteConstraint[]): RouteEvaluation {
    let valid = true;
    const violated: ConstraintType[] = [];
    const satisfied: ConstraintType[] = [];
    let softPenalties = 0;

    for (const constraint of constraints) {
      let isViolated = false;
      let evaluable = true;

      switch (constraint.type) {
        case "avoid_tolls":
          if (candidate.hasToll) {
            isViolated = true;
          }
          break;
        case "avoid_highways":
          if (candidate.hasHighway) {
            isViolated = true;
          }
          break;
        case "max_walking_distance":
          if (typeof candidate.walkingDistanceMeters === "number") {
            if (candidate.walkingDistanceMeters > (constraint.value as number)) {
              isViolated = true;
            }
          } else {
            evaluable = false;
          }
          break;
      }

      if (evaluable) {
        if (isViolated) {
          violated.push(constraint.type);
          if (constraint.severity === "hard") {
            valid = false;
          } else {
            softPenalties += ConstraintEngine.SOFT_VIOLATION_PENALTY;
          }
        } else {
          satisfied.push(constraint.type);
        }
      }
    }

    // Score = duration + (distance * weight) + soft penalties
    const score = (candidate.durationMinutes * ConstraintEngine.DURATION_WEIGHT) +
                  (candidate.distanceKm * ConstraintEngine.DISTANCE_WEIGHT) +
                  softPenalties;

    const explanationParts = [];
    if (!valid) {
      explanationParts.push(`Invalid: violates hard constraints (${violated.filter(v => constraints.find(c => c.type === v)?.severity === 'hard').join(', ')}).`);
    } else {
      explanationParts.push("Valid route.");
    }
    if (violated.length > 0) {
      explanationParts.push(`Violated: ${violated.join(', ')}.`);
    }

    return {
      route: candidate,
      valid,
      violatedConstraints: violated,
      satisfiedConstraints: satisfied,
      score,
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
