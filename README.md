# RoutePilot

RoutePilot is a conversational travel-planning and decision-making agent built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** (Alexa+ Track). Instead of requiring manual travel configurations, users express their travel goals in natural language (voice or text), and RoutePilot resolves constraints, searches for on-route stops, and evaluates deterministic route options to recommend the optimal plan.

## Project Status: Phase 8 (Alexa+ Experience Simulator & Submission Hardening)

RoutePilot implements a self-hosted **Model Context Protocol (MCP)** server over **Streamable HTTP** (specification >= 2025-11-25) paired with a multimodal **Alexa+ experience simulator** frontend built in React, MapLibre GL JS, and Tailwind CSS.

> **Note on Hackathon Track Implementation:**  
> RoutePilot participates in the **Alexa+ Track**. Because private-preview access to the native `@alexa-ai/cli` and Alexa+ Add-on developer toolkit is restricted, RoutePilot delivers the hackathon's officially approved alternative: a fully functional, self-hosted MCP server over Streamable HTTP paired with a high-fidelity multimodal Alexa+ experience simulator. We do NOT claim native Alexa+ device/runtime integration.
>
> **Note on Traffic:** Real-time live traffic feeds are **NOT** currently supported. Routing times are deterministic and based on OpenStreetMap road classifications via Valhalla.

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

1. **Conversational Travel Planning:** Natural language interface orchestrated via Amazon Bedrock Converse API.
2. **Deterministic Route Evaluation:** `ConstraintEngine` enforces hard constraints (e.g. `arrival_deadline`, `avoid_tolls`) and scores soft preferences outside the LLM.
3. **Route-Aware Stop Discovery:** Discovers real OpenStreetMap POIs (cafes, coffee shops) along the computed route corridor via Overpass API without fabricating places.
4. **Deadline-First Arithmetic:** Computes required departure times by subtracting driving duration and stop dwell times from the deadline using strictly deterministic date math. The LLM never computes travel times or departure dates.
5. **Interactive MapLibre Map:** Visualizes origin, stops (amber markers), destination (red marker), and route geometry via GeoJSON LineStrings without requiring proprietary map tokens.
6. **Voice Input & Output:** Web Speech API integration provides microphone dictation, listening states, and spoken audio responses.

---

## MCP Server & Available Tools

The RoutePilot MCP server is exposed over Streamable HTTP at `http://localhost:3000/mcp`.

| Tool Name | Description | Key Parameters |
|---|---|---|
| `health_check` | Validates MCP server connectivity and status. | None |
| `geocode` | Geocodes human-readable queries to coordinates using OpenStreetMap Nominatim. | `query` (string) |
| `calculate_route` | Calculates a point-to-point route via Valhalla routing engine. | `locations`, `mode`, `avoid_tolls`, `avoid_highways` |
| `compare_routes` | Generates alternate route candidates and deterministically evaluates them against hard/soft constraints and dwell times. | `locations`, `mode`, `departure_time`, `stops`, `constraints` |
| `find_places_along_route` | Queries Overpass API for real POIs along the computed route geometry corridor. | `locations`, `mode`, `category`, `radiusMeters`, `limit` |

---

## Route-Aware Stop Workflow

When a user requests a stop (e.g., *"I need to get to Pune Airport by 7 AM, avoid tolls, and find a coffee shop on the way"*):

1. **Baseline Route:** The agent geocodes locations and generates a baseline route candidate.
2. **Corridor Search:** `find_places_along_route` queries Overpass API for real OSM amenities (e.g., `amenity=cafe`) within a bounded buffer around the route geometry.
3. **Stop Selection:** The agent selects the closest real place returned by the tool (never fabricating place names or coordinates).
4. **Recalculation:** `compare_routes` is called with the selected stop inserted into `locations` and its dwell duration included in `stops`.
5. **Total Journey Arithmetic:** Total duration = Driving Time + Stop Dwell Time.
6. **Latest Departure:** Deterministically calculated using `TimeUtils.calculateLatestDeparture(deadline, totalDuration)`.
7. **Multimodal Presentation:** The frontend renders the amber stop marker on MapLibre and updates the `TravelPlanCard` breakdown.

---

## Getting Started

### Prerequisites

- Node.js >= 20.x
- AWS credentials configured (`AWS_REGION`, Bedrock access)
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
- **Groq (`LLM_PROVIDER=groq`):** Fast development and execution using Groq's official tool calling API (`openai/gpt-oss-120b`). Does not require AWS Bedrock credentials.
- **Bedrock (`LLM_PROVIDER=bedrock`):** Production hackathon deployment using Amazon Bedrock Converse API (`BEDROCK_MODEL_ID`).

Both providers interact with the same deterministic MCP tools (`health_check`, `geocode`, `calculate_route`, `compare_routes`, `find_places_along_route`) via Streamable HTTP. Neither provider performs arithmetic or route metrics itself.

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
Runs 60 automated tests covering:
- Agent multi-turn conversation loop
- Chat API handler and error sanitization
- ConstraintEngine evaluation and ranking
- Stop duration and deadline arithmetic
- Valhalla, Nominatim, and Overpass providers
- MCP server registration and Streamable HTTP client communication

### Frontend Typecheck & Build

```bash
cd frontend
npm run build
```

### Playwright E2E Smoke Tests

```bash
cd frontend
npx playwright test
```

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