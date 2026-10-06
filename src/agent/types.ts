import { RouteConstraint } from "../domain/constraints.js";
import { Location } from "../providers/geocoding/types.js";

export interface TravelPlan {
  id: string;
  origin?: Location;
  destination?: Location;
  departureTime?: string; // ISO-8601
  actualEta?: string; // ISO-8601
  arrivalDeadline?: string; // ISO-8601
  bufferMinutes?: number;
  durationMinutes?: number;
  distanceKm?: number;
  transportMode?: string;
  routeGeometry?: any; // GeoJSON LineString
  stops?: Array<{ name: string; lat: number; lon: number; durationMinutes: number }>;
  warnings?: string[];
  constraints?: RouteConstraint[];
}

export interface AgentResponse {
  message: string;
  travelPlan?: TravelPlan;
}

export interface AgentContext {
  sessionId: string;
  travelPlan: TravelPlan;
  messages: any[]; // Bedrock Message[]
}
