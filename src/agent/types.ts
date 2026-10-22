import { RouteConstraint } from "../domain/constraints.js";
import { Location } from "../providers/geocoding/types.js";
import { Place } from "../providers/places/types.js";

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
  requestedDepartureTime?: string; // ISO-8601, only for departure-first planning
  stale?: boolean;
  staleReason?: string;
}

export interface AgentResponse {
  message: string;
  travelPlan?: TravelPlan;
  /** Optional structured failure metadata for recoverable provider limits. */
  failureKind?: "provider";
  error?: string;
}

export interface RoutePilotAgent {
  converse(sessionId: string, userMessage: string): Promise<AgentResponse>;
}

export interface AgentContext {
  sessionId: string;
  travelPlan: TravelPlan;
  messages: any[]; // Provider message array (Bedrock Message[] or Groq/OpenAI Message[])
  recentPlaces?: Place[]; // Bounded provenance set for selected stops (not exposed to UI)
}
