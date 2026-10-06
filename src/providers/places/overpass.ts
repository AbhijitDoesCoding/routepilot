import { PlacesProvider, FindPlacesRequest, Place } from "./types.js";

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
    const { routeGeometry, category, radiusMeters, limit = 10 } = request;
    if (!routeGeometry || !routeGeometry.coordinates || routeGeometry.coordinates.length === 0) {
      throw new Error("Invalid route geometry");
    }

    // Determine category OSM tags
    let tags = "";
    if (category === "coffee_shop" || category === "cafe") {
      tags = `["amenity"="cafe"]`;
    } else {
      throw new Error(`Unsupported category: ${category}`);
    }

    // Compute bounding box of the route to limit the query
    const coordinates: number[][] = routeGeometry.coordinates;
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    
    // Sample coordinates if too large to avoid huge bounding box logic? No, just use standard bounding box.
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
      [out:json][timeout:25];
      node${tags}(${bbox});
      out body;
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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

      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.elements) {
        throw new Error("Malformed Overpass response");
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
      if (err.name === "AbortError") {
        throw new Error("Overpass API timeout");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
