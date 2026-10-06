import { RoutingProvider, RouteRequest, RouteResult } from "./types.js";

function decodePolyline(str: string, precision: number = 6): [number, number][] {
    let index = 0, lat = 0, lng = 0, coordinates: [number, number][] = [];
    let shift = 0, result = 0, byte = null, latitude_change, longitude_change;
    let factor = Math.pow(10, precision);

    while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += latitude_change; lng += longitude_change;
        coordinates.push([lng / factor, lat / factor]); // GeoJSON expects [lon, lat]
    }
    return coordinates;
}

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

    const valhallaReq: any = {
      locations: request.locations.map((l) => ({ lat: l.lat, lon: l.lon, type: "break" })),
      costing: costing,
      directions_options: {
        units: "kilometers"
      },
    };

    if (request.avoidTolls || request.avoidHighways) {
      valhallaReq.costing_options = { [costing]: {} };
      if (request.avoidTolls) {
        valhallaReq.costing_options[costing].toll_penalty = 10000;
      }
      if (request.avoidHighways) {
        valhallaReq.costing_options[costing].use_highways = 0.0;
        valhallaReq.costing_options[costing].highway_penalty = 10000; // redundant but safe
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

      const data = await response.json();

      if (!data.trip || !data.trip.summary || !Array.isArray(data.trip.legs) || data.trip.legs.length === 0) {
        throw new Error("Malformed response from Valhalla API: Missing trip details.");
      }

      const summary = data.trip.summary;
      const allCoordinates: [number, number][] = [];
      const allManeuvers: any[] = [];
      const allLegs: any[] = [];

      for (const leg of data.trip.legs) {
        if (!leg.shape) {
          throw new Error("Malformed response from Valhalla API: Missing route shape.");
        }
        const coords = decodePolyline(leg.shape, 6);
        allCoordinates.push(...coords);
        if (leg.maneuvers) allManeuvers.push(...leg.maneuvers);
        allLegs.push({
          distanceKm: leg.summary?.length || 0,
          durationMinutes: (leg.summary?.time || 0) / 60,
        });
      }

      const geojson = {
        type: "LineString",
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
