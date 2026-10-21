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

export interface ConstraintEvaluation {
  type: string;
  severity: "hard" | "soft";
  status: "satisfied" | "violated" | "not_evaluable";
  reason?: string;
}

export interface TravelPlan {
  id: string;
  origin?: Location;
  destination?: Location;
  departureTime?: string; // ISO-8601
  actualEta?: string; // ISO-8601
  arrivalDeadline?: string; // ISO-8601
  bufferMinutes?: number;
  durationMinutes?: number; // Total duration
  drivingDurationMinutes?: number;
  stopDurationMinutes?: number;
  distanceKm?: number;
  transportMode?: string;
  routeGeometry?: any; // GeoJSON LineString
  stops?: Array<{ name: string; placeId?: string; lat: number; lon: number; durationMinutes: number }>;
  warnings?: string[];
  constraints?: RouteConstraint[];
  constraintEvaluations?: ConstraintEvaluation[];
  planningMode?: "deadline_first" | "departure_first";
  requestedDepartureTime?: string; // ISO-8601
  stale?: boolean;
  staleReason?: string;
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
