# RoutePilot: Technical Specification

## 1. System Architecture
RoutePilot follows a clean modular architecture separating the agentic orchestration layer from deterministic geospatial and constraint services:
- **Frontend (Alexa+ Simulator):** A React/TypeScript web application providing a voice-first Alexa-like simulator, conversational chat, and interactive MapLibre GL JS map. Features on-device neural TTS (Kokoro-82M ONNX via WebGPU/WASM) and browser speech fallback.
- **Backend (Agent API & MCP Server):** A Node.js/TypeScript server hosting:
  - `POST /mcp`: Self-hosted MCP Server exposed via Streamable HTTP (MCP specification >= 2025-11-25) using `@modelcontextprotocol/server`.
  - `POST /api/chat`: Conversational endpoint orchestrating the active LLM provider (Groq for the demo; Bedrock implemented but not live-verified) via an internal `MCPClientService`.
  - `POST /api/tts`: Backward-compatibility Groq Orpheus TTS endpoint (bypassed by frontend in favor of on-device Kokoro TTS).
  - `GET /api/plan?sessionId=...`: Returns the current canonical plan for early map rendering and stale-route polling.
- **Geospatial & POI Providers:** Real deterministic services (OpenStreetMap Nominatim, Valhalla routing engine, Overpass API) abstracted behind typed provider interfaces.

## 2. Component Architecture
- **Chat Controller (`src/api/chat.ts`):** Validates incoming requests and connects to the active RoutePilot agent.
- **Agent Factory (`src/agent/factory.ts`):** Instantiates either `GroqAgent` (`LLM_PROVIDER=groq`) or `BedrockAgent` (`LLM_PROVIDER=bedrock`).
- **Bedrock Agent (`src/agent/client.ts`):** Orchestrates multi-turn dialogue via the Amazon Bedrock Converse API.
- **Groq Agent (`src/agent/groq.ts`):** Orchestrates multi-turn dialogue via Groq's official tool-calling API (`openai/gpt-oss-120b`).
- **Shared Planner (`src/agent/planner.ts`):** Deterministic merge of active plan state into new route requests, plus canonical `TravelPlan` extraction from `compare_routes` tool results across all LLM providers. Enforces plan continuity, explicit removal semantics, stop provenance, and stale-state propagation.
- **MCP Client (`src/mcp/client/index.ts`):** Dynamic client connecting over Streamable HTTP to discover and execute MCP tools.
- **Constraint Engine (`src/domain/constraints.ts`):** Deterministic engine validating route candidates against hard constraints and soft preferences outside the LLM.
- **Speech Formatter (`frontend/src/lib/speechFormatter.ts`):** Natural language speech normalization layer that decouples UI Markdown rendering from spoken audio instructions. Strips Markdown noise, expands navigation abbreviations (`km` -> `kilometers`), formats timestamps into natural 12-hour AM/PM times, and articulates canonical route facts.
- **On-Device Voice Engine (`frontend/src/lib/localVoice.ts` & `kokoroTts.worker.ts`):** Client-side Web Worker running `Kokoro-82M-v1.0-ONNX` (`q8`) with WebGPU acceleration (WASM fallback). Supports configurable personas (`af_bella`, `af_heart`, `am_michael`) and pacing (`speed: 0.95`).
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
│   │   ├── planner.ts         # Deterministic plan merge, continuity and TravelPlan extraction
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
│   │   ├── components/        # RouteMap (MapLibre), TravelPlanCard, PlanUpdateSummary
│   │   ├── hooks/             # useRoutePilot, useSpeech (Web Speech API + Kokoro)
│   │   ├── lib/               # localVoice.ts, speechFormatter.ts, planDiff.ts
│   │   ├── workers/           # kokoroTts.worker.ts (WebGPU/WASM ONNX Worker)
│   │   ├── types/             # Shared API & TravelPlan types
│   │   └── App.tsx            # Alexa+ simulator UI with voice input/output
│   └── tests/                 # 93 Playwright E2E tests (smoke, voice, matrix, phase2)
├── tests/                     # 150 automated unit, domain, Groq, continuity, and integration tests
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
- **Input:** `{ "locations": [...], "mode": "auto", "departure_time"?: string, "stops"?: [{ "locationIndex": number, "placeId"?: string, "name": string, "lat": number, "lon": number, "durationMinutes": number }], "constraints"?: [...], "remove_constraints"?: string[], "clear_stops"?: boolean }`
- **Output:** `{ "feasible": boolean, "recommended": RouteEvaluation, "alternatives": RouteEvaluation[], "reason"?: string }`

### `find_places_along_route`
- **Purpose:** Finds real POIs (coffee shops, cafes) within a bounded corridor around calculated route geometry via Overpass API. If Overpass fails, it retries within bounds and then queries Nominatim once over the same bounding box. Never fabricates places.
- **Input:** `{ "locations": [...], "mode": "auto", "category": "coffee_shop"|"cafe", "radiusMeters"?: number, "limit"?: number, "avoid_tolls"?: boolean, "avoid_highways"?: boolean }`
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
  - **Current deadline-first buffer:** `0` minutes. The calculated ETA equals the deadline, and `departureTime = deadline - totalDuration`. A departure-first plan instead keeps the requested departure and calculates a real buffer against the deadline.
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
    placeId?: string;
    lat: number;
    lon: number;
    durationMinutes: number;
  }>;
  warnings?: string[];
  constraints?: RouteConstraint[];
  constraintEvaluations?: ConstraintEvaluation[];
  planningMode?: "deadline_first" | "departure_first";
  requestedDepartureTime?: string;    // ISO-8601, departure-first plans
  stale?: boolean;
  staleReason?: string;
  feasible?: boolean;
}
```

## 8. Alexa+ Multimodal Experience Simulator
The project delivers a simulated Alexa+ multimodal experience:
- **Voice Dictation:** Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) for hands-free queries with live listening feedback.
- **Voice Response:** On-device neural speech generation powered by `Kokoro-82M-v1.0-ONNX` (`q8`) running inside a dedicated Web Worker via WebGPU (WASM fallback). Normalizes speech through `speechFormatter.ts`, provides selectable copilot personas (`af_bella`, `af_heart`, `am_michael`), and falls back to browser `speechSynthesis` when on-device inference is unsupported. The legacy `POST /api/tts` endpoint remains for backward compatibility. Text interaction remains available if neither voice path works.
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
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
GROQ_TTS_VOICE=hannah

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
- **`BedrockAgent` (`LLM_PROVIDER=bedrock`):** Uses Amazon Bedrock Converse API with Anthropic Claude or Amazon Nova. Translates RoutePilot MCP tools into Bedrock tool specifications. This path is implemented but was not live-verified in the current release pass; Groq is the verified demo provider.
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
   - Summaries contain only origin, destination, deadline, computed latest departure, ETA, total/driving duration, stops, active constraints, planning mode, requested departure, and stale/feasibility status. No raw coordinate arrays are included.
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

## 13. Deterministic Plan Continuity and Stale State
The server, not the prompt, enforces plan continuity before every `compare_routes` execution:
1. **Inheritance:** Omitted constraints, the arrival deadline, departure-first mode, and active stops are inherited from the session's canonical `TravelPlan`. Supplied constraints are upserted by type.
2. **Explicit removal:** `remove_constraints` removes only the named types. `clear_stops: true` removes all stops. An omitted or empty `stops` array is not an implicit deletion. On a constraint-only follow-up, a replacement stop list is ignored unless the user's message expresses stop intent, so the model cannot silently swap the selected stop.
3. **Endpoint changes:** A new first/last location starts a new journey and does not carry prior stops. Constraints and deadline are preserved unless explicitly removed, and the user/model must rediscover stops.
4. **Stop provenance and recovery:** New stops must match a `find_places_along_route` result by place ID or proximity when provenance exists. A replacement stop missing coordinates or dwell is completed from the active stop or a recently returned place by ID or name. If no usable replacement survives, the active stops are preserved.
5. **Waypoint insertion:** Every active stop is inserted into the route request before the destination so the router actually visits it. Orphaned waypoints from an ignored replacement are removed.
6. **Relative dates:** An explicit "tomorrow" or "today" in the user's message deterministically aligns the deadline date while preserving the requested time and offset.
7. **Failed reroutes:** A `compare_routes` error marks the last successful plan `stale` while retaining its metrics and geometry. A feasible success clears `stale`. A completed infeasible result clears route metrics and is presented as infeasible, not stale.
8. **UI propagation:** `/api/plan` exposes stale plans, `TravelPlanCard` labels them, and `RouteMap` renders retained geometry in faded amber. The next success restores the normal route rendering.

