# RoutePilot: Technical Specification

## 1. System Architecture
RoutePilot follows a modular monolith architecture for initial development, separating the AI decision layer from deterministic geospatial services. 
- **Frontend:** A React-based web application containing a chat interface and MapLibre GL JS map.
- **Backend (Agent API):** Node.js/TypeScript application handling session state and interfacing with Amazon Bedrock.
- **MCP Server:** A separate Node.js process exposing geospatial tools via the Model Context Protocol (MCP) using Streamable HTTP on a `/mcp` endpoint (specification minimum: 2025-11-25) and the current official MCP TypeScript SDK. (stdio may be used optionally for local testing).
- **Geospatial Services:** External APIs (Nominatim, Valhalla) abstracted behind provider interfaces.

## 2. Component Architecture
- **Chat Controller:** Manages the multi-turn conversation and session state.
- **LLM Client:** Interfaces with Amazon Bedrock to parse intent and generate responses.
- **MCP Client:** Connects the LLM to the MCP Server tools.
- **Constraint Engine:** A local module that validates tool outputs (routes) against the user's parsed constraints.
- **Provider Interfaces:** Abstractions for Geocoding (`NominatimProvider`), Routing (`ValhallaProvider`), etc.

## 3. Repository Structure
```text
routepilot/
├── backend/
│   ├── src/
│   │   ├── agent/       # Bedrock integration, chat loops
│   │   ├── models/      # TravelPlan, Constraints data models
│   │   └── api/         # HTTP endpoints for frontend
├── mcp-server/
│   ├── src/
│   │   ├── tools/       # MCP tool definitions
│   │   └── providers/   # Nominatim, Valhalla implementations
├── frontend/
│   ├── src/
│   │   ├── components/  # ChatUI, Map, PlanCard
│   │   └── hooks/
├── docs/                # PRD, Tech Spec
└── .env.example
```

## 4. MCP Architecture & Domain Separation
The MCP Server acts as the standardized tool boundary between the LLM and the real world. The agent NEVER directly calls Nominatim or Valhalla; it only communicates through the MCP interface. The explicit interaction flow is:
```text
Frontend / simulator
    ↓
Agent API
    ↓
Bedrock Converse/tool-use loop
    ↓
MCP Client
    ↓
RoutePilot MCP Server
    ↓
Provider implementations
    ├── Nominatim
    └── Valhalla
```
**Domain Separation:** The LLM extracts user intent and orchestrates tool calls. The Provider adapters communicate with external deterministic services. The domain/constraint logic (outside the LLM) explicitly evaluates the resulting routes. The LLM must not perform deterministic calculations itself.

## 5. MCP Tools and Schemas

### `geocode`
- **Purpose:** Convert a place name/address into coordinates.
- **Backend:** Nominatim.
- **Input Schema:** `{ "query": "string" }`
- **Output Schema:** `{ "results": [{ "lat": number, "lon": number, "name": "string", "address": "string" }] }`

### `calculate_route`
- **Purpose:** Calculate a route between waypoints with specific costing models.
- **Backend:** Valhalla.
- **Input Schema:** `{ "locations": [{ "lat": number, "lon": number, "name": "string" }], "mode": "auto|pedestrian|bicycle", "avoid_tolls": boolean, "avoid_highways": boolean }`
- **Output Schema:** `{ "distanceKm": number, "durationMinutes": number, "geometry": { "type": "LineString", "coordinates": [...] }, "legs": [...], "maneuvers": [...] }`

### `compare_routes`
- **Purpose:** Request multiple route alternatives, evaluate them against constraints, and output a ranked recommendation.
- **Backend:** ConstraintEngine (using Valhalla candidates).
- **Input Schema:** `{ "locations": [...], "mode": "auto", "constraints": [{ "type": "avoid_tolls", "severity": "hard" }] }`
- **Output Schema:** `{ "feasible": boolean, "recommended": RouteEvaluation, "alternatives": RouteEvaluation[], "reason": "string" }`

## 6. ConstraintEngine & Route Evaluation
To shield the LLM from arithmetic and arbitrary path evaluation, a deterministic `ConstraintEngine` performs route evaluations.
- **Statuses:** `satisfied`, `violated`, `not_evaluable`.
- **Hard Constraints:** Eliminate a route if violated (`valid = false`). If a hard constraint is `not_evaluable` (e.g. missing metadata), the route is also invalidated since it cannot be proven safe.
- **Soft Preferences:** Penalize a route's ranking score without eliminating it. A `not_evaluable` soft constraint incurs a small penalty.
- **Deterministic Scoring:** Lower score is better. `score = (duration * 1.0) + (distance * 0.5) + (soft_penalties)`.
- **TimeUtils / Deadlines:** Deterministically calculates ETAs, required departure times, and buffers using ISO-8601 mathematics to evaluate `arrival_deadline`.

## 6.1 Nominatim Integration
Used strictly for geocoding. Wrapped in a `GeocodeProvider` interface. Rate limiting and user-agent requirements of the public API must be respected.

## 7. Valhalla Integration
Used for routing. Wrapped in a `RoutingProvider` interface. Leverages Valhalla's flexible costing options (e.g., heavily penalizing tolls or highways) to generate diverse candidates. Valhalla preferences are NOT constraints; the `ConstraintEngine` independently verifies if the generated route actually has tolls or highways to determine constraint satisfaction.

## 8. MapLibre Integration
The frontend uses MapLibre GL JS. The actual geometry flow is:
`Valhalla encoded shape -> ValhallaProvider -> GeoJSON LineString -> RouteResult -> future TravelPlan -> MapLibre`
The frontend must NOT decode Valhalla's encoded polyline. It receives ready-to-use GeoJSON.

## 9. AI/Agent Architecture
The agent uses a ReAct (Reasoning and Acting) converse loop via Amazon Bedrock (`BedrockAgent`). The architecture is model-agnostic; the model ID is configurable via `BEDROCK_MODEL_ID`.
1. `AgentService` receives user input and maintains multi-turn context in a memory `SessionStore`.
2. A deterministic `Clock` provides explicit `currentTime` and `timezone` to the system prompt.
3. Bedrock plans tool usage based on extracted constraints.
4. An `MCPClientService` routes tool requests through Streamable HTTP (`/mcp`) to the RoutePilot MCP Server.
5. `compare_routes` resolves geometries, constraints, and deterministically calculates the latest departure deadline via `TimeUtils`.
6. Tool outputs are natively appended back into the Converse loop to generate a final conversational response (`AgentResponse`).
7. During the loop, `AgentService` intercepts structured tool results to incrementally populate the structured `TravelPlan` sidecar object (for the future MapLibre frontend).

## 10. Bedrock Integration Strategy
Uses `@aws-sdk/client-bedrock-runtime` and the `Converse` API. Supports multi-turn conversation and sequential tool execution up to a configurable maximum round limit to prevent infinite loops. The agent never hallucinates metrics; it only reports metrics retrieved by the MCP server.

## 11. TravelPlan & AgentResponse Data Model
Canonical JSON object representing the plan.
```typescript
interface TravelPlan {
  id: string;
  origin?: Location;
  destination?: Location;
  departureTime?: string; // ISO8601
  actualEta?: string; // ISO8601
  arrivalDeadline?: string; // ISO8601
  bufferMinutes?: number;
  durationMinutes?: number;
  distanceKm?: number;
  transportMode?: string;
  routeGeometry?: any; // GeoJSON LineString
  stops?: Array<{ name: string; lat: number; lon: number; durationMinutes: number }>;
  warnings?: string[];
  constraints?: RouteConstraint[];
}

interface AgentResponse {
  message: string;
  travelPlan?: TravelPlan;
}
```

## 11.1 Planning Flows
- **Deadline-First Planning**: User gives deadline (e.g. "arrive by 7 AM"). Agent extracts destination and deadline. Calls `geocode` and `compare_routes`. Application determines route duration and uses `TimeUtils.calculateLatestDeparture()` to populate `departureTime`, `actualEta`, and `bufferMinutes`. The LLM only explains the final plan.
- **Departure-First Planning**: User gives departure time (e.g. "leave at 6 AM"). Agent calls `compare_routes` with `departure_time`. Application calculates arrival and buffer (if a deadline is also provided).

## 12. Constraint Model
Parsed by the LLM from user input and fed into `compare_routes`.
```typescript
type RouteConstraint = 
  | { type: "avoid_tolls"; severity: "hard" | "soft" }
  | { type: "avoid_highways"; severity: "hard" | "soft" }
  | { type: "max_walking_distance"; severity: "hard" | "soft"; value: number }
  | { type: "arrival_deadline"; severity: "hard" | "soft"; value: string };
```

## 13. Route Option Model
The parameters sent to Valhalla based on the `Constraints`. `compare_routes` generates combined route candidates automatically when both toll and highway avoidance are requested.

## 14. Provider Abstraction Design
```typescript
interface GeocodeProvider {
  search(query: string): Promise<Location[]>;
}
interface RoutingProvider {
  calculateRoute(request: RouteRequest): Promise<RouteResult>;
}
```

## 15. TrafficProvider Abstraction
```typescript
interface TrafficProvider {
  getDelayEstimate(routeGeometry: any, time: Date): Promise<number>;
}
```
*Note: Implemented as an abstraction initially. Do not add fake traffic values. Real-time traffic requires a legitimate external traffic data provider and will be added only when available and legally usable.*

## 16-18. Other Providers
- **PlacesProvider:** For finding POIs along a route (e.g., "coffee shop"). Could use Nominatim or Overpass API.
- **WeatherProvider / CalendarProvider:** Abstract interfaces for future implementation.

## 19. Conversation/Session State
Maintained in memory (or a lightweight local DB for development) per user/session ID. Includes the chat history, the current constraints, and the active `TravelPlan`.

## 20. Error Handling
- **LLM Tool Errors:** MCP server returns error strings; LLM is prompted to retry or ask user for clarification.
- **API Errors:** Geospatial API failures are caught and returned to the LLM to explain the outage gracefully.

## 21. Validation
- **Runtime:** `zod` for validating MCP tool inputs and API requests.
- **Logic:** The `ConstraintEngine` explicitly validates the Valhalla route against the `Constraints` before presenting it to the user.

## 22. Observability/Logging
Pino for structured logging. Log LLM prompts, tool calls, and latencies. Do not log PII (user addresses) in production logs.

## 23. Testing Strategy
- **Unit:** node:test for Provider logic, parsing, and the Constraint Engine.
- **Integration:** Test MCP tools against mock geospatial APIs.
- **E2E:** Playwright for the frontend flow.

## 24. Security
- Environment variables for AWS credentials.
- No direct database exposure.
- Input sanitization on chat endpoints.

## 25. Configuration/Environment Variables
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
NOMINATIM_USER_AGENT=RoutePilot/1.0 (Hackathon)
PORT=3000
```

## 26. Local Development
Use `npm run dev` to start the frontend, backend, and MCP server concurrently using something like `concurrently` or Turborepo.

## 27-28. Deployment & AWS Architecture
Local development is the primary focus first to keep things simple. AWS deployment (e.g., via AWS CDK or SAM) is a future hackathon deployment option. We will use AWS services only when they have a concrete role.

## 29. Alexa+ Integration
RoutePilot's core Alexa+ implementation is a self-hosted MCP server implementing MCP 2025-11-25+ over Streamable HTTP. Our own web simulator will demonstrate the conversational Alexa+ experience. The `TravelPlan` remains a structured canonical object that can later be adapted to other presentation formats. We do not claim actual Alexa+ device/runtime integration (or APL) unless it is implemented, and there is no strict requirement for a `/alexa` backend endpoint initially.

## 30. Web Simulator Architecture
A React + Vite + Tailwind SPA that communicates with the backend via the `POST /api/chat` endpoint. It leverages a custom hook `useRoutePilot` to maintain conversation messages and the active `TravelPlan`. `MapLibre GL JS` is used as the frontend map renderer, initialized with a configurable `VITE_MAP_STYLE_URL` (defaulting to OpenFreeMap Liberty for OpenStreetMap styling).
The frontend strictly renders the `AgentResponse` and does no constraint evaluation, geometry decoding (backend returns GeoJSON directly), or ETA calculation.

## 31. API/MCP Examples
**User:** "Find a route from Central Park to Times Square avoiding tolls."
**Agent calls:** `compare_routes({ locations: [Central Park coords, Times Square coords], constraints: [{ type: "avoid_tolls", severity: "hard" }] })`

## 32. Example Tool Calls
See Section 5.

## 33. Example TravelPlan JSON
See Section 11 for the interface structure.

## 34. Future Extensibility
The provider model allows swapping Nominatim for Google Places or Valhalla for Mapbox Routing later without changing the LLM prompts or core logic. New MCP tools can be added easily by extending the server definition.
