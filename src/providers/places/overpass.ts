import { PlacesProvider, FindPlacesRequest, Place } from "./types.js";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty"
  }
});

export class OverpassError extends Error {
  public readonly category: "rate_limited" | "server_error" | "timeout" | "client_error" | "malformed_response" | "invalid_request";
  public readonly status?: number;
  public readonly retryable: boolean;
  public readonly attempts: number;

  constructor(
    message: string,
    category: "rate_limited" | "server_error" | "timeout" | "client_error" | "malformed_response" | "invalid_request",
    options?: { status?: number; retryable?: boolean; attempts?: number }
  ) {
    super(message);
    this.name = "OverpassError";
    this.category = category;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
    this.attempts = options?.attempts ?? 1;
  }
}

// Haversine distance between two points in meters
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Distance from point to line segment
const pointToSegmentDistance = (pLat: number, pLon: number, lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const l2 = Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2);
  if (l2 === 0) return haversineDistance(pLat, pLon, lat1, lon1);
  let t = ((pLat - lat1) * (lat2 - lat1) + (pLon - lon1) * (lon2 - lon1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projLat = lat1 + t * (lat2 - lat1);
  const projLon = lon1 + t * (lon2 - lon1);
  return haversineDistance(pLat, pLon, projLat, projLon);
};

// Distance from point to GeoJSON LineString
const distanceToLineString = (lat: number, lon: number, coordinates: number[][]): number => {
  let minDistance = Infinity;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    const dist = pointToSegmentDistance(lat, lon, lat1, lon1, lat2, lon2);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  return minDistance;
};

export class OverpassProvider implements PlacesProvider {
  private baseUrl: string;
  private userAgent: string;

  constructor() {
    this.baseUrl = process.env.OVERPASS_BASE_URL || "https://overpass-api.de/api/interpreter";
    this.userAgent = process.env.OVERPASS_USER_AGENT || "RoutePilot/0.1.0";
  }

  async findPlacesAlongRoute(request: FindPlacesRequest): Promise<Place[]> {
    try {
      return await this.queryOverpass(request);
    } catch (err) {
      // Public Overpass instances are frequently at capacity; Nominatim exposes
      // the same OSM data and is a cheap single-request fallback.
      const coordinates = request.routeGeometry?.coordinates;
      if (Array.isArray(coordinates) && coordinates.length > 0) {
        try {
          const places = await this.findPlacesViaNominatim(
            request.category,
            coordinates,
            request.radiusMeters,
            request.limit ?? 10
          );
          logger.info({ provider: "Nominatim", count: places.length }, "Overpass unavailable; using Nominatim fallback");
          return places;
        } catch (fallbackErr: any) {
          logger.warn({ provider: "Nominatim", error: fallbackErr?.message }, "Nominatim fallback failed");
        }
      }
      throw err;
    }
  }

  private async findPlacesViaNominatim(
    category: string,
    coordinates: number[][],
    radiusMeters: number,
    limit: number
  ): Promise<Place[]> {
    if (category !== "coffee_shop" && category !== "cafe") {
      return [];
    }

    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const [lon, lat] of coordinates) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    const latPad = radiusMeters / 111000;
    const lonPad = radiusMeters / (111000 * Math.cos(minLat * Math.PI / 180));
    const url = new URL("/search", process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org");
    url.searchParams.set("amenity", "cafe");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "40");
    url.searchParams.set("bounded", "1");
    // Nominatim viewbox is west,north,east,south
    url.searchParams.set("viewbox", `${minLon - lonPad},${maxLat + latPad},${maxLon + lonPad},${minLat - latPad}`);

    const response = await fetch(url, {
      headers: { "User-Agent": this.userAgent },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json() as Array<{
      place_id: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
    }>;

    const places: Place[] = [];
    for (const item of data) {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const dist = distanceToLineString(lat, lon, coordinates);
      if (dist <= radiusMeters) {
        places.push({
          id: String(item.place_id),
          name: item.name || item.display_name.split(",")[0],
          lat,
          lon,
          category,
          distanceToRouteMeters: dist
        });
      }
    }

    places.sort((a, b) => (a.distanceToRouteMeters || 0) - (b.distanceToRouteMeters || 0));
    return places.slice(0, limit);
  }

  private async queryOverpass(request: FindPlacesRequest): Promise<Place[]> {
    const { routeGeometry, category, radiusMeters, limit = 10 } = request;
    if (!routeGeometry || !routeGeometry.coordinates || routeGeometry.coordinates.length === 0) {
      throw new OverpassError("Invalid route geometry", "invalid_request", { retryable: false, attempts: 0 });
    }

    // Determine category OSM tags
    let tags = "";
    if (category === "coffee_shop" || category === "cafe") {
      tags = `["amenity"="cafe"]`;
    } else {
      throw new OverpassError(`Unsupported category: ${category}`, "invalid_request", { retryable: false, attempts: 0 });
    }

    // Compute bounding box of the route to limit the query
    const coordinates: number[][] = routeGeometry.coordinates;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    
    for (const [lon, lat] of coordinates) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    // Pad bounding box roughly by radius
    const latPad = radiusMeters / 111000;
    const lonPad = radiusMeters / (111000 * Math.cos(minLat * Math.PI / 180));
    const bbox = `${minLat - latPad},${minLon - lonPad},${maxLat + latPad},${maxLon + lonPad}`;

    const query = `
      [out:json][timeout:10];
      node${tags}(${bbox});
      out body;
    `;

    const maxAttempts = 2; // At most one retry (2 attempts total)
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.userAgent
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });

        const durationMs = Date.now() - attemptStart;

        if (!response.ok) {
          const status = response.status;
          const isRetryable = status === 429 || (status >= 500 && status < 600);
          const errorCategory = status === 429 ? "rate_limited" : (status >= 500 ? "server_error" : "client_error");

          logger.warn({
            toolName: "find_places_along_route",
            provider: "Overpass",
            errorCategory,
            httpStatus: status,
            retryable: isRetryable,
            attempt,
            durationMs
          }, `Overpass HTTP error: ${status}`);

          const err = new OverpassError(`Overpass API error: ${status}`, errorCategory, {
            status,
            retryable: isRetryable,
            attempts: attempt
          });

          if (isRetryable && attempt < maxAttempts) {
            lastError = err;
            await new Promise(resolve => setTimeout(resolve, 800));
            continue;
          }
          throw err;
        }

        const data = await response.json();
        if (!data || !data.elements) {
          logger.warn({
            toolName: "find_places_along_route",
            provider: "Overpass",
            errorCategory: "malformed_response",
            retryable: false,
            attempt,
            durationMs: Date.now() - attemptStart
          }, "Malformed Overpass response");
          throw new OverpassError("Malformed Overpass response", "malformed_response", { retryable: false, attempts: attempt });
        }

        const places: Place[] = [];
        for (const el of data.elements) {
          if (el.type === "node" && el.tags && el.tags.name) {
            const dist = distanceToLineString(el.lat, el.lon, coordinates);
            if (dist <= radiusMeters) {
              places.push({
                id: el.id.toString(),
                name: el.tags.name,
                lat: el.lat,
                lon: el.lon,
                category,
                distanceToRouteMeters: dist
              });
            }
          }
        }

        // Sort by distance and limit
        places.sort((a, b) => (a.distanceToRouteMeters || 0) - (b.distanceToRouteMeters || 0));
        return places.slice(0, limit);

      } catch (err: any) {
        const durationMs = Date.now() - attemptStart;
        if (err instanceof OverpassError) {
          throw err;
        }

        const isTimeout = err.name === "AbortError" || err.message?.includes("timeout");
        const errorCategory = isTimeout ? "timeout" : "client_error";
        // Retrying a timeout only doubles the user-facing wait for an interactive query.
        const isRetryable = false;

        logger.warn({
          toolName: "find_places_along_route",
          provider: "Overpass",
          errorCategory,
          retryable: isRetryable,
          attempt,
          durationMs
        }, `Overpass request exception: ${err.message}`);

        const overpassErr = new OverpassError(
          isTimeout ? "Overpass API timeout" : (err.message || "Overpass query failed"),
          errorCategory,
          { retryable: isRetryable, attempts: attempt }
        );

        if (isRetryable && attempt < maxAttempts) {
          lastError = overpassErr;
          await new Promise(resolve => setTimeout(resolve, 800));
          continue;
        }
        throw overpassErr;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new OverpassError("Overpass query failed after retries", "server_error", { attempts: maxAttempts });
  }
}
