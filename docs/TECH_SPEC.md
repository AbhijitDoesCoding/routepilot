# RoutePilot: Technical Specification

## 1. System Architecture
RoutePilot follows a clean modular architecture separating the agentic orchestration layer from deterministic geospatial and constraint services:
- **Frontend (Alexa+ Simulator):** A React/TypeScript web application providing a voice-first Alexa-like simulator, conversational chat, and interactive MapLibre GL JS map.
- **Backend (Agent API & MCP Server):** A Node.js/TypeScript server hosting:
  - `POST /mcp`: Self-hosted MCP Server exposed via Streamable HTTP (MCP specification >= 2025-11-25) using `@modelcontextprotocol/server`.
  - `POST /api/chat`: Conversational endpoint orchestrating Amazon Bedrock via an internal `MCPClientService`.
- **Geospatial & POI Providers:** Real deterministic services (OpenStreetMap Nominatim, Valhalla routing engine, Overpass API) abstracted behind typed provider interfaces.

## 2. Component Architecture
- **Chat Controller (`src/api/chat.ts`):** Validates incoming requests and connects to the active RoutePilot agent.
- **Agent Factory (`src/agent/factory.ts`):** Instantiates either `GroqAgent` (`LLM_PROVIDER=groq`) or `BedrockAgent` (`LLM_PROVIDER=bedrock`).
- **Bedrock Agent (`src/agent/client.ts`):** Orchestrates multi-turn dialogue via the Amazon Bedrock Converse API.
- **Groq Agent (`src/agent/groq.ts`):** Orchestrates multi-turn dialogue via Groq's official tool-calling API (`openai/gpt-oss-120b`).
- **Shared Planner (`src/agent/planner.ts`):** Deterministic parser extracting canonical `TravelPlan` metrics from `compare_routes` tool results across all LLM providers.
- **MCP Client (`src/mcp/client/index.ts`):** Dynamic client connecting over Streamable HTTP to discover and execute MCP tools.
- **Constraint Engine (`src/domain/constraints.ts`):** Deterministic engine validating route candidates against hard constraints and soft preferences outside the LLM.
- **Provider Adapters (`src/providers/`):**
  - `NominatimProvider`: Geocodes human-readable queries to geographic coordinates.
  - `ValhallaProvider`: Calculates routes and decodes precision-6 polyline geometries to GeoJSON.
  - `OverpassProvider`: Queries OpenStreetMap amenities along route corridors for real POIs.

## 3. Repository Structure
```text
routepilot/
├── src/
│   ├── agent/                 # Agent loop, session store, clock, prompts, providers
│   │   ├── client.ts          # BedrockAgent (Amazon Bedrock Converse API)
│   │   ├── groq.ts            # GroqAgent (Groq tool-calling API)
│   │   ├── factory.ts         # Agent factory selecting provider via LLM_PROVIDER
│   │   ├── planner.ts         # Shared deterministic TravelPlan extraction
│   │   ├── clock.ts           # Deterministic time provider
│   │   ├── session.ts         # In-memory session context
│   │   └── types.ts           # RoutePilotAgent, TravelPlan & AgentResponse models
│   ├── api/
│   │   └── chat.ts            # POST /api/chat endpoint with safe error sanitization
│   ├── domain/
│   │   └── constraints.ts     # ConstraintEngine, RouteCandidate, TimeUtils
│   ├── mcp/
│   │   ├── client/            # MCPClientService over Streamable HTTP
│   │   ├── tools/             # health_check, geocode, calculate_route, compare_routes, find_places_along_route
│   │   └── server.ts          # McpServer instance & tool registration
│   ├── providers/
│   │   ├── geocoding/         # Nominatim geocoding provider
│   │   ├── places/            # Overpass places provider (amenity=cafe)
│   │   └── routing/           # Valhalla routing provider & polyline decoder
│   └── index.ts               # Unified HTTP server exposing /mcp and /api/chat
├── frontend/
│   ├── src/
│   │   ├── components/        # RouteMap (MapLibre), TravelPlanCard
│   │   ├── hooks/             # useRoutePilot, useSpeech (Web Speech API)
│   │   ├── types/             # Shared API & TravelPlan types
│   │   └── App.tsx            # Alexa+ simulator UI with voice input/output
│   └── tests/                 # Playwright E2E smoke tests (Scenarios A-I)
├── tests/                     # 72 automated unit, domain, Groq, and integration tests
├── docs/                      # PRD, TECH_SPEC, HACKATHON_CHECKLIST, DEMO_SCRIPT
└── .env.example               # Complete environment variable template
```

## 4. MCP Architecture & Tool Interaction Flow
The MCP Server serves as the strict, standardized boundary between the reasoning LLM and external capabilities:
```text
User (Voice or Text)
        ↓
Alexa+ Simulator (React)
        ↓
POST /api/chat
        ↓
createAgent (GroqAgent | BedrockAgent)
        ↓
MCPClientService (Streamable HTTP)
        ↓
RoutePilot MCP Server (POST /mcp)
        ↓
Provider Implementations
  ├── Nominatim (Geocoding)
  ├── Valhalla (Routing)
  └── Overpass (Places along route)
        ↓
ConstraintEngine (Deterministic validation & scoring)
        ↓
TravelPlan Sidecar (Canonical structured plan)
        ↓
Frontend UI (Voice output + MapLibre + Plan Card)
```

## 5. MCP Tools and Specifications

### `health_check`
- **Purpose:** Verifies MCP server health and version.
- **Input:** `{}`
- **Output:** `{ "status": "ok", "service": "RoutePilot MCP", "version": "0.1.0", "timestamp": "..." }`

### `geocode`
- **Purpose:** Convert human-readable query to geographic coordinates via Nominatim.
- **Input:** `{ "query": string }`
- **Output:** `{ "results": [{ "lat": number, "lon": number, "name": string, "address": string }] }`

### `calculate_route`
- **Purpose:** Calculate a deterministic route between waypoints.
- **Input:** `{ "locations": [{ "lat": number, "lon": number, "name"?: string }], "mode": "auto"|"pedestrian"|"bicycle", "avoid_tolls"?: boolean, "avoid_highways"?: boolean }`
- **Output:** `{ "distanceKm": number, "durationMinutes": number, "geometry": GeoJSON.LineString, "legs": [...], "maneuvers": [...] }`

### `compare_routes`
- **Purpose:** Generate alternate route candidates and evaluate them deterministically against constraints and dwell times.
- **Input:** `{ "locations": [...], "mode": "auto", "departure_time"?: string, "stops"?: [{ "locationIndex": number, "name": string, "lat": number, "lon": number, "durationMinutes": number }], "constraints"?: [...] }`
- **Output:** `{ "feasible": boolean, "recommended": RouteEvaluation, "alternatives": RouteEvaluation[], "reason"?: string }`

### `find_places_along_route`
- **Purpose:** Finds real POIs (coffee shops, cafes) within a bounded corridor around calculated route geometry via Overpass API. Never fabricates places.
- **Input:** `{ "locations": [...], "mode": "auto", "category": "coffee_shop"|"cafe", "radiusMeters"?: number, "limit"?: number }`
- **Output:** `{ "places": [{ "id": string, "name": string, "lat": number, "lon": number, "category": string, "distanceToRouteMeters": number }] }`

## 6. ConstraintEngine & Deterministic Mathematics
To shield the LLM from arithmetic and arbitrary path evaluation, a deterministic `ConstraintEngine` performs evaluations:
- **Statuses:** `satisfied`, `violated`, `not_evaluable`.
- **Hard Constraints:** Eliminate a route if violated (`valid = false`).
- **Soft Preferences:** Penalize route ranking without invalidation.
- **Stop Dwell Arithmetic:**
  $$\text{durationMinutes} = \text{drivingDurationMinutes} + \text{stopDurationMinutes}$$
  All deadline and buffer calculations operate on `durationMinutes` (the total journey duration).
- **TimeUtils:**
  - `calculateLatestDeparture(deadline, totalDuration, buffer)`: Computes exact ISO departure timestamp.
  - `calculateArrivalTime(departure, totalDuration)`: Computes exact ETA.
  - `calculateBuffer(actualEta, deadline)`: Computes minutes before deadline (positive) or minutes late (negative).
  - **Zero LLM Arithmetic:** The LLM never computes or estimates dates or durations.

## 7. TravelPlan Data Model
Canonical typed object rendered by the visual simulator:
```typescript
interface TravelPlan {
  id: string;
  origin?: Location;
  destination?: Location;
  departureTime?: string;             // ISO-8601
  actualEta?: string;                 // ISO-8601
  arrivalDeadline?: string;           // ISO-8601
  bufferMinutes?: number;
  durationMinutes?: number;           // Total journey duration (driving + stops)
  drivingDurationMinutes?: number;    // Pure driving duration
  stopDurationMinutes?: number;       // Dwell time across all stops
  distanceKm?: number;
  transportMode?: string;
  routeGeometry?: GeoJSON.LineString; // Rendered by MapLibre
  stops?: Array<{
    name: string;
    lat: number;
    lon: number;
    durationMinutes: number;
  }>;
  warnings?: string[];
  constraints?: RouteConstraint[];
  constraintEvaluations?: ConstraintEvaluation[];
}
```

## 8. Alexa+ Multimodal Experience Simulator
The project delivers a simulated Alexa+ multimodal experience:
- **Voice Dictation:** Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) for hands-free queries with live listening feedback.
- **Voice Response:** Web Speech Synthesis (`SpeechSynthesisUtterance`) to read recommendations aloud upon user request.
- **Multimodal Visual Sidecar:**
  - `RouteMap`: MapLibre GL JS rendering dynamic GeoJSON layers, green origin marker, red destination marker, amber intermediate stop markers, and bounding-box auto-fitting. Safe text rendering avoids DOM injection vulnerabilities.
  - `TravelPlanCard`: Visual breakdown of recommended route, leave/arrive times, travel time breakdown (driving vs. stop), buffer status, and verified constraint badges (`✓`, `⚠`, `○`).
  - Example Prompts: One-click starter prompts representing realistic voice interactions.

## 9. Security & Error Sanitization
- **Safe Error Responses:** Uncaught server errors on `/api/chat` return generic sanitized messages (`"Route planning is temporarily unavailable."`) while logging full details server-side via Pino. No credentials, stack traces, or paths are leaked.
- **CORS Protection:** Configurable `CORS_ORIGIN` defaulting strictly to `http://localhost:5173`.
- **Client Isolation:** AWS credentials, Overpass endpoints, and Valhalla internals remain strictly on the backend server.
- **Map Popup Safety:** Uses `Popup.setText()` instead of raw HTML injection.

## 10. Environment Configuration
```env
PORT=3000
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=RoutePilot/1.0
VALHALLA_BASE_URL=http://localhost:8002
OVERPASS_BASE_URL=https://overpass-api.de/api/interpreter
OVERPASS_USER_AGENT=RoutePilot/1.0

# LLM Provider Configuration ("groq" or "bedrock")
LLM_PROVIDER=groq

# Groq Configuration (when LLM_PROVIDER=groq)
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL_ID=openai/gpt-oss-120b
GROQ_MAX_COMPLETION_TOKENS=1200

# AWS Bedrock Configuration (when LLM_PROVIDER=bedrock)
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key

DEFAULT_TIMEZONE=Asia/Kolkata
DEFAULT_ORIGIN_QUERY=Pune Railway Station
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

## 11. Model-Provider Abstraction
RoutePilot implements a provider boundary isolating the conversational agent from specific LLM vendors:
- **`GroqAgent` (`LLM_PROVIDER=groq`):** Uses Groq's official tool-calling SDK with `openai/gpt-oss-120b`. Translates RoutePilot MCP tools into standard OpenAI-compatible function specifications.
- **`BedrockAgent` (`LLM_PROVIDER=bedrock`):** Uses Amazon Bedrock Converse API with Anthropic Claude or Amazon Nova. Translates RoutePilot MCP tools into Bedrock tool specifications.
- **Shared Deterministic Guarantees:** Regardless of provider:
  1. MCP tools are executed solely through `MCPClientService` over Streamable HTTP (`/mcp`).
  2. The LLM never calculates route metrics, departure times, arrival times, buffers, or stop durations.
  3. All structured `TravelPlan` properties are deterministically extracted and calculated by `updateTravelPlanFromCompareRoutes` in `src/agent/planner.ts`.

## 12. Groq Context Compaction & Token-Budget Management
To accommodate strict token-per-minute (TPM) limits on free and development tiers without sacrificing routing capabilities:
1. **Isolated Working Messages vs. Persistent History:**
   - Completed turns store only human user prompts and final assistant text messages in `session.messages`.
   - Raw tool calls and voluminous tool result payloads are never persisted across conversation turns.
   - Persistent conversational history is strictly capped at the most recent 4–6 messages.
2. **Concise TravelPlan Ingestion:**
   - Active trip context across conversation turns is deterministically summarized by `formatTravelPlanSummary()` and injected into the system prompt.
   - Summaries contain only origin, destination, deadline, computed latest departure, ETA, total/driving duration, stops, active constraints, and feasibility status. No raw coordinate arrays are included.
3. **Model-Facing Tool Payload Compaction (`compactToolResult`):**
   - For `compare_routes`, bulky GeoJSON `LineString` coordinates (often 200–500+ coordinate pairs), encoded polylines, leg details, and step-by-step turn maneuvers are stripped before sending the result to Groq (~95% token reduction).
   - Core metrics (distance, driving/stop durations, toll/highway indicators, constraint evaluations, and candidate IDs) are preserved for model reasoning.
   - The application sidecar receives the uncompacted original MCP result, ensuring MapLibre GL JS renders full high-resolution route geometries.
   - `geocode` results are bounded to top 3 matches; `find_places_along_route` to top 5 places.
4. **Token Budget Enforcement:**
   - Configurable `GROQ_MAX_COMPLETION_TOKENS` (default `1200`).
5. **Compaction Retry & Error Sanitization:**
   - On encountering HTTP 413 or 429 errors from Groq, the agent prunes historical messages from the current working array and retries once cleanly.
   - If limits persist or no history remains to prune, a user-facing sanitized notification is returned without crashing the server or exposing internal error logs.

