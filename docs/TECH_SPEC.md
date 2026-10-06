# RoutePilot: Technical Specification

## 1. System Architecture
RoutePilot follows a modular monolith architecture for initial development, separating the AI decision layer from deterministic geospatial services. 
- **Frontend:** A React-based web application containing a chat interface and MapLibre GL JS map.
- **Backend (Agent API):** Node.js/TypeScript application handling session state and interfacing with Amazon Bedrock.
- **MCP Server:** A separate Node.js process exposing geospatial tools via the Model Context Protocol (MCP) using stdio or SSE.
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

## 4. MCP Architecture
The MCP Server acts as the bridge between the LLM and the real world. It implements the official MCP TypeScript SDK. The agent uses the `call_tool` capability to request geocoding, routing, or place information. The tools are designed to return structured JSON that the LLM can easily interpret and use in its reasoning loop.

## 5. MCP Tools and Schemas

### `geocode`
- **Purpose:** Convert a place name/address into coordinates.
- **Backend:** Nominatim.
- **Input Schema:** `{ "query": "string" }`
- **Output Schema:** `{ "lat": number, "lon": number, "name": "string", "address": "string" }`

### `calculate_route`
- **Purpose:** Calculate a route between waypoints with specific costing models.
- **Backend:** Valhalla.
- **Input Schema:** `{ "locations": [{ "lat": number, "lon": number }], "costing": "auto|pedestrian|bicycle", "options": { "toll": number } }`
- **Output Schema:** `{ "distance": number, "time": number, "geometry": "string (polyline)", "legs": [...] }`

### `compare_routes`
- **Purpose:** Request multiple route alternatives (e.g., fastest vs. toll-free) for comparison.
- **Backend:** Valhalla (Alternatives API).
- **Input Schema:** Similar to `calculate_route` but asks for multiple costing profiles.
- **Output Schema:** Array of routes.

## 6. Nominatim Integration
Used strictly for geocoding. Wrapped in a `GeocodeProvider` interface. Rate limiting and user-agent requirements of the public API must be respected, or a dedicated instance/alternative (like Photon) must be used if traffic increases.

## 7. Valhalla Integration
Used for routing. Wrapped in a `RoutingProvider` interface. Leverages Valhalla's flexible costing options (e.g., heavily penalizing tolls or highways) to fulfill user constraints dynamically.

## 8. MapLibre Integration
The frontend uses MapLibre GL JS. The LLM provides the `TravelPlan` object containing polyline strings (from Valhalla). The frontend decodes these polylines and renders them as GeoJSON `LineString` features on the map, alongside markers for origin, destination, and stops.

## 9. AI/Agent Architecture
The agent uses a ReAct (Reasoning and Acting) or plan-and-execute loop via Amazon Bedrock (Claude 3.5 Sonnet). 
1. Receive user input.
2. Update constraint model based on input.
3. Determine required tools (e.g., `geocode` origin, `geocode` destination).
4. Call tools.
5. Call `calculate_route` with constraints.
6. Evaluate results.
7. Generate `TravelPlan` and conversational response.

## 10. Bedrock Integration Strategy
Use the AWS SDK for JavaScript to communicate with Amazon Bedrock. Utilize the `Converse` API, which natively supports tool use (function calling) and maintains conversation history.

## 11. TravelPlan Data Model
Canonical JSON object representing the plan.
```typescript
interface TravelPlan {
  id: string;
  origin: { name: string; lat: number; lon: number };
  destination: { name: string; lat: number; lon: number };
  departureTime: string; // ISO8601
  arrivalDeadline?: string; // ISO8601
  actualEta: string; // ISO8601
  bufferMinutes: number;
  durationMinutes: number;
  distanceKm: number;
  transportMode: string;
  routeGeometry: string; // Encoded polyline
  stops: Array<{ name: string; lat: number; lon: number; durationMinutes: number }>;
  warnings: string[];
}
```

## 12. Constraint Model
Parsed by the LLM from user input.
```typescript
interface Constraints {
  arrivalDeadline?: string;
  earliestDeparture?: string;
  avoidTolls: boolean;
  avoidHighways: boolean;
  maxWalkingDistanceMeters?: number;
  requiredStops: string[]; // e.g., ["coffee shop"]
}
```

## 13. Route Option Model
The parameters sent to Valhalla based on the `Constraints`.

## 14. Provider Abstraction Design
```typescript
interface GeocodeProvider {
  search(query: string): Promise<Location[]>;
}
interface RoutingProvider {
  getRoute(request: RouteRequest): Promise<RouteResult>;
}
```

## 15. TrafficProvider Abstraction
```typescript
interface TrafficProvider {
  getDelayEstimate(routeGeometry: string, time: Date): Promise<number>;
}
```
*Note: Implemented as a mock or null provider initially. Do not fake traffic data.*

## 16-18. Other Providers
- **PlacesProvider:** For finding POIs along a route (e.g., "coffee shop"). Could use Nominatim or Overpass API.
- **WeatherProvider / CalendarProvider:** Abstract interfaces for future implementation.

## 19. Conversation/Session State
Maintained in memory (or a lightweight local DB for development) per user/session ID. Includes the chat history, the current `Constraints` object, and the active `TravelPlan`.

## 20. Error Handling
- **LLM Tool Errors:** MCP server returns error strings; LLM is prompted to retry or ask user for clarification.
- **API Errors:** Geospatial API failures are caught and returned to the LLM to explain the outage gracefully.

## 21. Validation
- **Runtime:** `zod` for validating MCP tool inputs and API requests.
- **Logic:** The `ConstraintEngine` explicitly validates the Valhalla route against the `Constraints` before presenting it to the user.

## 22. Observability/Logging
Pino for structured logging. Log LLM prompts, tool calls, and latencies. Do not log PII (user addresses) in production logs.

## 23. Testing Strategy
- **Unit:** Jest/Vitest for Provider logic, parsing, and the Constraint Engine.
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
For the hackathon, deploy via AWS CDK or SAM.
- **Frontend:** AWS Amplify or S3+CloudFront.
- **Backend/MCP:** AWS Lambda function URL or API Gateway.

## 29. Alexa+ Integration
The backend API exposes a specific endpoint `/alexa` that accepts standard Alexa intents. It maps the intent to the conversational session, generates the response, and formats the `TravelPlan` into an APL directive.

## 30. Web Simulator Architecture
A React SPA that polls or connects via WebSocket to the backend to receive streaming LLM text and structured `TravelPlan` updates concurrently.

## 31. API/MCP Examples
**User:** "Find a route from Central Park to Times Square avoiding tolls."
**Agent calls:** `calculate_route({ locations: [Central Park coords, Times Square coords], options: { toll: 0 } })`

## 32. Example Tool Calls
See Section 5.

## 33. Example TravelPlan JSON
See Section 11 for the interface structure.

## 34. Future Extensibility
The provider model allows swapping Nominatim for Google Places or Valhalla for Mapbox Routing later without changing the LLM prompts or core logic. New MCP tools can be added easily by extending the server definition.
