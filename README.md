# RoutePilot

RoutePilot is a conversational travel-planning and decision-making agent built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** (Alexa+ Track). Instead of requiring manual travel configurations, users express their travel goals in natural language (voice or text), and RoutePilot resolves constraints, searches for on-route stops, and evaluates deterministic route options to recommend the optimal plan.

## Project Status: Phase 8 (Alexa+ Experience Simulator & Submission Hardening)

RoutePilot implements a self-hosted **Model Context Protocol (MCP)** server over **Streamable HTTP** (specification >= 2025-11-25) paired with a multimodal **Alexa+ experience simulator** frontend built in React, MapLibre GL JS, and Tailwind CSS.

> **Note on Hackathon Track Implementation:**  
> RoutePilot participates in the **Alexa+ Track**. Because private-preview access to the native `@alexa-ai/cli` and Alexa+ Add-on developer toolkit is restricted, RoutePilot delivers the hackathon's officially approved alternative: a fully functional, self-hosted MCP server over Streamable HTTP paired with a high-fidelity multimodal Alexa+ experience simulator. We do NOT claim native Alexa+ device/runtime integration.
>
> **Note on Traffic:** Real-time live traffic feeds are **NOT** currently supported. Routing times are deterministic and based on OpenStreetMap road classifications via Valhalla.
>
> **Provider Status:** Groq (`openai/gpt-oss-120b`) is the active demo provider. The Amazon Bedrock Converse path is implemented behind `LLM_PROVIDER=bedrock`, but it was **not live-verified** in the current release pass.
>
> **Voice Output:** Assistant replies use Groq Orpheus neural TTS through `POST /api/tts` when configured. If that endpoint is unavailable, the frontend falls back to browser `speechSynthesis`.

---

## Architecture

```
Browser / Alexa-like Simulator (Voice & Text)
                    ↓
              POST /api/chat
                    ↓
         createAgent (GroqAgent | BedrockAgent)
                    ↓
             MCPClientService (Streamable HTTP Client)
                    ↓
        RoutePilot MCP Server (POST /mcp)
                    ↓
    ┌────────────────┬────────────────┬────────────────┐
    │   Nominatim    │    Valhalla    │    Overpass    │
    │   (Geocoding)  │   (Routing)    │    (Places)    │
    └────────────────┴────────────────┴────────────────┘
                    ↓
        ConstraintEngine + Deterministic Planning
                    ↓
               TravelPlan (Canonical Structured Plan)
                    ↓
        Multimodal UI (Voice Output + MapLibre + Plan Card)
```

---

## Core Capabilities

1. **Conversational Travel Planning:** Natural language interface orchestrated through Groq's tool-calling API for the active demo, with an implemented Amazon Bedrock Converse alternative.
2. **Deterministic Route Evaluation:** `ConstraintEngine` enforces hard constraints (e.g. `arrival_deadline`, `avoid_tolls`, `avoid_highways`) and scores soft preferences outside the LLM.
3. **Route-Aware Stop Discovery:** Discovers real OpenStreetMap POIs (cafes, coffee shops) along the computed route corridor via Overpass API, with a Nominatim fallback when Overpass is unavailable. It never fabricates places.
4. **Deadline-First Arithmetic:** Computes required departure times by subtracting driving duration and stop dwell times from the deadline using strictly deterministic date math. The LLM never computes travel times or departure dates. The current implementation uses a **0-minute planning buffer** for deadline-first plans, so the calculated ETA equals the deadline.
5. **Interactive MapLibre Map:** Visualizes origin, stops (amber markers), destination (red marker), and route geometry via GeoJSON LineStrings without requiring proprietary map tokens.
6. **Voice Input & Output:** Web Speech API microphone dictation plus Groq Orpheus neural TTS, with browser `speechSynthesis` as the fallback.

---

## MCP Server & Available Tools

The RoutePilot MCP server is exposed over Streamable HTTP at `http://localhost:3000/mcp`.

| Tool Name | Description | Key Parameters |
|---|---|---|
| `health_check` | Validates MCP server connectivity and status. | None |
| `geocode` | Geocodes human-readable queries to coordinates using OpenStreetMap Nominatim. | `query` (string) |
| `calculate_route` | Calculates a point-to-point route via Valhalla routing engine. | `locations`, `mode`, `avoid_tolls`, `avoid_highways` |
| `compare_routes` | Generates alternate route candidates and deterministically evaluates them against hard/soft constraints and dwell times. | `locations`, `mode`, `departure_time`, `stops`, `constraints`, `remove_constraints`, `clear_stops` |
| `find_places_along_route` | Queries Overpass API for real POIs along the computed route geometry corridor, falling back to Nominatim if Overpass fails. | `locations`, `mode`, `category`, `radiusMeters`, `limit`, `avoid_tolls`, `avoid_highways` |

---

## Route-Aware Stop Workflow

When a user requests a stop (e.g., *"I need to get to Pune Airport by 7 AM, avoid tolls, and find a coffee shop on the way"*):

1. **Baseline Route:** The agent geocodes locations and generates a baseline route candidate.
2. **Corridor Search:** `find_places_along_route` queries Overpass API for real OSM amenities (e.g., `amenity=cafe`) within a bounded buffer around the route geometry.
3. **Stop Selection:** The agent selects the closest real place returned by the tool (never fabricating place names or coordinates).
4. **Recalculation:** `compare_routes` is called with the selected stop inserted into `locations` and its dwell duration included in `stops`.
5. **Total Journey Arithmetic:** Total duration = Driving Time + Stop Dwell Time.
6. **Latest Departure:** Deterministically calculated using `TimeUtils.calculateLatestDeparture(deadline, totalDuration, buffer)` with the current 0-minute planning buffer.
7. **Continuity:** On a follow-up that only adds or removes a constraint, the backend inherits omitted constraints, deadline, planning mode, and active stops, reinserts the stop waypoint, and recomputes the route. A constraint-only follow-up cannot silently swap the selected stop. Explicit removal uses `remove_constraints` or `clear_stops`.
8. **Multimodal Presentation:** The frontend renders the amber stop marker on MapLibre and updates the `TravelPlanCard` breakdown.

---

## Getting Started

### Prerequisites

- Node.js >= 20.x
- Groq API key for the active demo (`GROQ_API_KEY`)
- AWS credentials only if you choose the Bedrock provider (`AWS_REGION`, Bedrock access)
- Local or remote Valhalla instance (defaults to `http://localhost:8002` or mockable for tests)

### Installation

```bash
# Clone the repository
git clone https://github.com/AbhijitDoesCoding/routepilot.git
cd routepilot

# Install root/backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### Configuration

Copy `.env.example` to `.env` in the project root:

```env
PORT=3000
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=RoutePilot/1.0
VALHALLA_BASE_URL=http://localhost:8002
OVERPASS_BASE_URL=https://overpass-api.de/api/interpreter
OVERPASS_USER_AGENT=RoutePilot/1.0

# LLM Provider Configuration ("groq" or "bedrock")
LLM_PROVIDER=groq

# When LLM_PROVIDER=groq:
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL_ID=openai/gpt-oss-120b
GROQ_MAX_COMPLETION_TOKENS=1200
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
GROQ_TTS_VOICE=hannah

# When LLM_PROVIDER=bedrock:
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key

DEFAULT_TIMEZONE=Asia/Kolkata
DEFAULT_ORIGIN_QUERY=Pune Railway Station
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

#### Provider Switching
RoutePilot provides a clean model-provider abstraction:
- **Groq (`LLM_PROVIDER=groq`):** Active demo provider, using Groq's official tool-calling API (`openai/gpt-oss-120b`). Does not require AWS Bedrock credentials.
- **Bedrock (`LLM_PROVIDER=bedrock`):** Implemented against the Amazon Bedrock Converse API (`BEDROCK_MODEL_ID`). This path is present but was not live-verified in the current release pass.

Both providers interact with the same deterministic MCP tools (`health_check`, `geocode`, `calculate_route`, `compare_routes`, `find_places_along_route`) via Streamable HTTP. Neither provider performs arithmetic or route metrics itself.

#### Neural TTS and Browser Fallback
When `GROQ_API_KEY` is configured, `POST /api/tts` uses Groq Orpheus (`GROQ_TTS_MODEL`, default `canopylabs/orpheus-v1-english`; `GROQ_TTS_VOICE`, default `hannah`). If the endpoint returns an error, the frontend falls back to the browser's `speechSynthesis` voices. Text interaction continues to work if neither is available.

#### Groq Context Compaction & Token Budgeting
To operate smoothly within Groq rate and token-per-minute (TPM) limits:
- **Separated Working vs. Persistent History:** Completed turns discard verbose tool-call and raw tool-result messages from persistent session history, retaining only pure conversational user/assistant messages bounded to the most recent turns.
- **Deterministic TravelPlan Summary:** Turn-to-turn trip context (origin, destination, deadline, latest departure, duration, stops, constraints, feasibility) is maintained concisely via the system prompt without re-sending bulky coordinate payloads.
- **Compacted Model-Facing Tool Payloads:** `compactToolResult` strips bulky LineString coordinates, legs, and turn maneuvers before returning results to Groq (~95% token reduction on `compare_routes`), while ensuring the frontend map receives full uncompacted GeoJSON geometries via `TravelPlan`.
- **Configurable Token Limit:** `GROQ_MAX_COMPLETION_TOKENS` (default: 1200) prevents token exhaustion on free/dev tiers.
- **Automatic Compaction Retry:** If a rate or token limit (413/429) occurs, the agent prunes historical messages and retries once cleanly. If limits persist, a graceful sanitized message is returned.

#### Frontend Configuration (Optional)

In `frontend/.env`:
```env
# Optional: backend API URL (defaults to Vite proxy /api)
VITE_API_BASE_URL=http://localhost:3000

# Optional: Map style URL (defaults to OpenFreeMap Liberty)
VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

---

## Running RoutePilot

### 1. Start the Backend Server

```bash
npm run dev
```
The server will start on `http://localhost:3000`:
- **MCP Endpoint:** `http://localhost:3000/mcp`
- **Chat API:** `http://localhost:3000/api/chat`

### 2. Start the Alexa+ Simulator Frontend

In a separate terminal:
```bash
cd frontend
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Running Tests

### Backend Test Suite (Unit, Domain, MCP, & Integration)

```bash
npm test
```
Runs 119 automated tests covering:
- Agent multi-turn conversation loop and deterministic plan continuity
- Explicit constraint and stop removal
- Failed-reroute stale-state propagation and recovery
- Chat API handler and error sanitization
- ConstraintEngine evaluation and ranking
- Stop duration and deadline arithmetic
- Valhalla, Nominatim, and Overpass providers, including POI fallback behavior
- MCP server registration and Streamable HTTP client communication

### Frontend Typecheck & Build

```bash
cd frontend
npm run build
npm run lint
```

### Playwright E2E Smoke Tests

```bash
cd frontend
npx playwright install chromium
npx playwright test
```

The suite has 7 scenarios: initial state, route card/MapLibre rendering, the three-turn stop workflow, stale-route presentation, retry behavior, example prompts, and voice/accessibility controls.

### Release Verification Status

- A scripted three-turn regression is part of `npm test` and verifies that the canonical `TravelPlan` retains the deadline, toll avoidance, highway avoidance, selected café, 15-minute dwell, stop waypoint, departure, ETA, and constraint evaluations after an incomplete third turn.
- A bounded live Groq rehearsal completed in one session: all three turns returned HTTP 200 and the final canonical plan retained the next-day 7:00 AM IST deadline, toll and highway avoidance, the selected café with its 15-minute dwell, and matching departure/ETA/duration values.
- The browser suite was run in system Chrome in this environment and all 7 scenarios passed. The Playwright-managed Chromium download was blocked by a CDN timeout, so `npx playwright install chromium` must succeed before the default Playwright project can run locally.
- Bedrock has not been live-verified in this release pass; Groq is the verified demo provider.

---

## Demonstration Script

Try these multi-turn interactions in the simulator:

- **Turn 1 (Goal & Constraints):**  
  *"I need to reach Pune Airport by 7 AM and avoid tolls."*  
  *Outcome:* Geocodes Pune Airport, compares routes, computes departure time for 7 AM deadline, renders map and constraint badges.

- **Turn 2 (Route-Aware Stop):**  
  *"Also find a coffee shop on the way."*  
  *Outcome:* Searches corridor along route via Overpass, inserts intermediate stop with 15-min dwell time, updates total travel time and departure, displays amber stop marker.

- **Turn 3 (Constraint Refinement):**  
  *"Avoid highways too."*  
  *Outcome:* Retains origin, destination, deadline, and coffee stop while recalculating a non-highway route.

---

## License

This project is licensed under the [ISC License](LICENSE).