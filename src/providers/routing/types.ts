import { Location } from "../geocoding/types.js";

export type TransportMode = "auto" | "pedestrian" | "bicycle";

export interface RouteRequest {
  locations: Location[];
  mode: TransportMode;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
}

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  hasToll: boolean;
  hasHighway: boolean;
  walkingDistanceMeters?: number;
  geometry: any; // GeoJSON LineString
  legs: any[];
  maneuvers: any[];
}

export interface RoutingProvider {
  calculateRoute(request: RouteRequest): Promise<RouteResult>;
}
