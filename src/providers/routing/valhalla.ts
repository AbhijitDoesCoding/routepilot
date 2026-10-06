import { RoutingProvider, RouteRequest, RouteResult } from "./types.js";
import { decodePolyline } from "./polyline.js";

export class ValhallaProvider implements RoutingProvider {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.VALHALLA_BASE_URL || "http://localhost:8002";
  }

  async calculateRoute(request: RouteRequest): Promise<RouteResult> {
    if (!request.locations || request.locations.length < 2) {
      throw new Error("At least 2 locations are required for routing.");
    }
    for (const loc of request.locations) {
      if (typeof loc.lat !== "number" || typeof loc.lon !== "number" || isNaN(loc.lat) || isNaN(loc.lon)) {
        throw new Error("Invalid locations: coordinates must be valid numbers.");
      }
    }

    const modeMapping: Record<string, string> = {
      auto: "auto",
      pedestrian: "pedestrian",
      bicycle: "bicycle",
    };
    const costing = modeMapping[request.mode];
    if (!costing) {
      throw new Error(`Unsupported transport mode: ${request.mode}`);
    }

    interface ValhallaRequest {
      locations: { lat: number; lon: number; type: string }[];
      costing: string;
      directions_options: { units: string };
      costing_options?: Record<string, { use_tolls?: number; use_highways?: number }>;
    }

    const valhallaReq: ValhallaRequest = {
      locations: request.locations.map((l) => ({ lat: l.lat, lon: l.lon, type: "break" })),
      costing: costing,
      directions_options: {
        units: "kilometers"
      },
    };

    if (request.avoidTolls || request.avoidHighways) {
      valhallaReq.costing_options = { [costing]: {} };
      if (request.avoidTolls) {
        valhallaReq.costing_options[costing].use_tolls = 0.0;
      }
      if (request.avoidHighways) {
        valhallaReq.costing_options[costing].use_highways = 0.0;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(`${this.baseUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valhallaReq),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Valhalla API HTTP error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      interface ValhallaResponse {
        trip?: {
          summary?: { length?: number; time?: number };
          legs?: Array<{
            shape?: string;
            summary?: { length?: number; time?: number };
            maneuvers?: any[];
          }>;
        };
      }
      
      const data = (await response.json()) as ValhallaResponse;

      if (!data.trip || !data.trip.summary || !Array.isArray(data.trip.legs) || data.trip.legs.length === 0) {
        throw new Error("Malformed response from Valhalla API: Missing trip details.");
      }

      const summary = data.trip.summary;
      if (typeof summary.length !== "number" || !isFinite(summary.length)) {
        throw new Error("Malformed response from Valhalla API: Invalid trip distance.");
      }
      if (typeof summary.time !== "number" || !isFinite(summary.time)) {
        throw new Error("Malformed response from Valhalla API: Invalid trip duration.");
      }

      const allCoordinates: [number, number][] = [];
      const allManeuvers: any[] = [];
      const allLegs: any[] = [];

      for (const leg of data.trip.legs) {
        if (!leg.shape) {
          throw new Error("Malformed response from Valhalla API: Missing route shape.");
        }
        const coords = decodePolyline(leg.shape, 6);
        if (coords.length === 0) {
           throw new Error("Malformed response from Valhalla API: Decoded route shape contains no coordinates.");
        }
        allCoordinates.push(...coords);
        
        if (Array.isArray(leg.maneuvers)) {
          allManeuvers.push(...leg.maneuvers);
        }
        
        if (!leg.summary || typeof leg.summary.length !== "number" || typeof leg.summary.time !== "number") {
           throw new Error("Malformed response from Valhalla API: Invalid leg summary.");
        }

        allLegs.push({
          distanceKm: leg.summary.length,
          durationMinutes: leg.summary.time / 60,
        });
      }

      const geojson = {
        type: "LineString" as const,
        coordinates: allCoordinates
      };

      return {
        distanceKm: summary.length,
        durationMinutes: summary.time / 60,
        geometry: geojson,
        legs: allLegs,
        maneuvers: allManeuvers,
      };

    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new Error("Valhalla API request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
