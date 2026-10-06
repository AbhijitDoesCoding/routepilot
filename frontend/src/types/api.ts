export interface Location {
  name?: string;
  lat: number;
  lon: number;
}

export interface RouteConstraint {
  type: string;
  severity: "hard" | "soft";
  value?: any;
}

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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}
