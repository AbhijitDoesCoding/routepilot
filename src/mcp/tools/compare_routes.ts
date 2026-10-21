import { z } from "zod";
import { ValhallaProvider } from "../../providers/routing/valhalla.js";
import { ConstraintEngine, RouteConstraint, RouteCandidate } from "../../domain/constraints.js";

const provider = new ValhallaProvider();
const engine = new ConstraintEngine();

export const compareRoutesDefinition = {
  name: "compare_routes",
  description: "Generate and evaluate multiple alternative routes against hard and soft constraints.",
  parameters: z.object({
    locations: z.array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        name: z.string().optional()
      })
    ).min(2).describe("Waypoints to route between"),
    mode: z.enum(["auto", "pedestrian", "bicycle"]).default("auto").describe("Transport mode"),
    departure_time: z.string().datetime({ offset: true }).optional().describe("Optional ISO-8601 departure time (for departure-first planning; if omitted, latest departure is calculated deterministically from arrival_deadline)"),
    current_time: z.string().datetime({ offset: true }).optional().describe("Optional ISO-8601 current reference time for deadline verification"),
    stops: z.array(
      z.object({
        locationIndex: z.number().int().min(0).describe("Index in the locations array this stop corresponds to"),
        placeId: z.string().optional().describe("ID of the place returned by find_places_along_route, when available"),
        name: z.string(),
        lat: z.number(),
        lon: z.number(),
        durationMinutes: z.number().positive().describe("Dwell time at the stop in minutes")
      })
    ).optional().describe("Optional intermediate stops with dwell duration. When omitted, active stops are preserved. A non-empty list replaces the active stops."),
    clear_stops: z.boolean().optional().describe("Set true only when the user explicitly asks to remove all stops. Omitted or false preserves active stops."),
    constraints: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("avoid_tolls"), severity: z.enum(["hard", "soft"]) }),
        z.object({ type: z.literal("avoid_highways"), severity: z.enum(["hard", "soft"]) }),
        z.object({ type: z.literal("max_walking_distance"), severity: z.enum(["hard", "soft"]), value: z.number().positive() }),
        z.object({ type: z.literal("arrival_deadline"), severity: z.enum(["hard", "soft"]), value: z.string().datetime({ offset: true }) })
      ])
    ).optional().default([]).describe("Constraints to add or update. Omitted constraints are preserved; supplied constraints are upserted by type."),
    remove_constraints: z.array(
      z.enum(["avoid_tolls", "avoid_highways", "max_walking_distance", "arrival_deadline"])
    ).optional().describe("Constraint types the user explicitly asked to remove. Omission means no removal.")
  })
};

export const compareRoutesHandler = async (args: any) => {
  try {
    const { locations, mode, departure_time, current_time, constraints, stops } = args;
    const typedConstraints = constraints as RouteConstraint[];
    
    // Calculate total stop duration
    let stopDurationMinutes = 0;
    if (stops && Array.isArray(stops)) {
      stopDurationMinutes = stops.reduce((acc, stop) => acc + (stop.durationMinutes || 0), 0);
    }

    // Generate candidates by varying profiles if applicable
    const candidatePromises = [];

    // Helper to inject stop duration
    const processResult = (res: any, id: string, profile: string) => {
      const drivingDuration = res.durationMinutes;
      return {
        ...res,
        drivingDurationMinutes: drivingDuration,
        stopDurationMinutes: stopDurationMinutes,
        durationMinutes: drivingDuration + stopDurationMinutes,
        candidateId: id,
        costingProfile: profile
      };
    };

    // Profile 1: Default (Fastest)
    candidatePromises.push(
      provider.calculateRoute({ locations, mode, avoidTolls: false, avoidHighways: false })
        .then(res => processResult(res, "fastest", "default"))
        .catch(err => { console.error("Fastest failed:", err); return null; })
    );

    // If mode is auto, we can explore constraint-driven alternate costings
    if (mode === "auto") {
      const avoidTollsRelevant = typedConstraints.some(c => c.type === "avoid_tolls");
      const avoidHighwaysRelevant = typedConstraints.some(c => c.type === "avoid_highways");

      // Profile 2: Toll-averse
      if (avoidTollsRelevant) {
        candidatePromises.push(
          provider.calculateRoute({ locations, mode, avoidTolls: true, avoidHighways: false })
            .then(res => processResult(res, "no-tolls", "avoid_tolls"))
            .catch(() => null)
        );
      }
      
      // Profile 3: Highway-averse
      if (avoidHighwaysRelevant) {
        candidatePromises.push(
          provider.calculateRoute({ locations, mode, avoidTolls: false, avoidHighways: true })
            .then(res => processResult(res, "no-highways", "avoid_highways"))
            .catch(() => null)
        );
      }

      // Profile 4: Toll and Highway averse combined
      if (avoidTollsRelevant && avoidHighwaysRelevant) {
        candidatePromises.push(
          provider.calculateRoute({ locations, mode, avoidTolls: true, avoidHighways: true })
            .then(res => processResult(res, "no-tolls-no-highways", "avoid_tolls_and_highways"))
            .catch(() => null)
        );
      }
    }

    // Wait for all to finish
    const settled = await Promise.allSettled(candidatePromises);
    const candidates: RouteCandidate[] = [];
    
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        // deduplicate identical routes by distance and time 
        // to avoid presenting functionally identical routes
        const exists = candidates.find(c => 
          Math.abs(c.distanceKm - result.value!.distanceKm) < 0.01 && 
          Math.abs(c.durationMinutes - result.value!.durationMinutes) < 0.1
        );
        if (!exists) {
          candidates.push(result.value as RouteCandidate);
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error("Failed to generate any route candidates.");
    }

    // Determine effective current time: use provided valid current_time or generate backend ISO timestamp
    const effectiveCurrentTime = (current_time && typeof current_time === "string" && !isNaN(new Date(current_time).getTime()))
      ? current_time
      : new Date().toISOString();

    // Evaluate candidates
    const evaluations = candidates.map(c => engine.evaluate(c, typedConstraints, departure_time, effectiveCurrentTime));

    // Rank candidates
    const ranking = engine.rank(evaluations);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(ranking, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ feasible: false, error: error.message || "An error occurred during route comparison" })
        }
      ],
      isError: true,
    };
  }
};
