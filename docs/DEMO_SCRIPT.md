# RoutePilot: Video Demonstration Script (< 3 Minutes)

**Target Duration:** ~2 minutes 30 seconds  
**Focus Scenario:** Intelligent, deadline-driven travel planning with route-aware stop discovery.

---

## Video Outline & Timeline

### 0:00 – 0:25: Introduction & Problem Statement
- **Presenter (Voiceover / Screen):**
  > *"Traditional navigation apps force users to manually configure departure times, look up intermediate stops, and guess how long a detour will take. Welcome to RoutePilot — an agentic travel assistant designed for the Alexa+ hackathon that combines natural-language conversation with deterministic geospatial decision-making."*
- **Visual:** Show the RoutePilot simulator running at `http://localhost:5173`. Point out the clean multimodal layout: the voice-first conversation panel on the left and the interactive MapLibre map on the right.

---

### 0:25 – 1:05: Turn 1 – Goal-Oriented Planning with Constraints
- **Action:** Click the microphone button or type:
  > *"I need to reach Pune Airport by 7 AM and avoid tolls."*
- **Behind the Scenes (Explain while the plan loads):**
  - Groq parses user intent and identifies destination (`Pune Airport`), deadline (`7:00 AM`), and a hard constraint (`avoid_tolls`).
  - The agent executes the `geocode` MCP tool to resolve Pune Airport coordinates via OpenStreetMap Nominatim.
  - The agent calls the `compare_routes` MCP tool with the `avoid_tolls` and `arrival_deadline` constraints.
  - The deterministic `ConstraintEngine` generates route candidates via Valhalla, confirms toll avoidance, and calculates the exact latest departure time using `TimeUtils`. The current deadline-first buffer is `0` minutes, so ETA equals the deadline.
- **Visual Result:**
  - Route line renders on MapLibre from origin to Pune Airport.
  - Recommended Plan card displays values returned by the tool. For example, if the chosen route is 52 minutes:
    - Departure: `6:08 AM`
    - Arrival: `7:00 AM` (0-minute planning buffer)
    - Travel Time: `52 min`
    - Buffer: `0 min buffer`
    - Constraint badge: `✓ avoid tolls` (verified by the backend, not guessed by the LLM).

---

### 1:05 – 1:50: Turn 2 – Route-Aware Stop Planning
- **Action:** Ask:
  > *"Also find a coffee shop on the way."*
- **Behind the Scenes (Explain):**
  - Rather than a generic city-wide search, the agent calls the `find_places_along_route` MCP tool.
  - It queries the OpenStreetMap Overpass API for real cafes along the actual route corridor. If Overpass is unavailable, the provider falls back to a bounded Nominatim search over the same area.
  - The closest verified place returned by the tool is selected; no place name is invented.
  - The agent calls `compare_routes` with the coffee stop as an intermediate waypoint and includes a 15-minute dwell time.
  - **Deterministic Math:** For the same route, the backend computes:
    $$\text{Total Duration} = 52\text{ min (driving)} + 15\text{ min (coffee stop)} = 67\text{ min}$$
    $$\text{Latest Departure} = 7:00\text{ AM} - 67\text{ min} - 0\text{ min buffer} = 5:53\text{ AM}$$
- **Visual Result:**
  - Map updates with an amber marker for the coffee stop.
  - Plan card title updates to: `Home → Café Corner → Pune Airport` when that is the returned place name.
  - Detailed breakdown displays:
    - `Driving: 52 min`
    - `Café Corner: 15 min stop`
    - `Total: 67 min`
    - `Buffer: 0 min buffer`

---

### 1:50 – 2:20: Turn 3 – Multi-Turn Context Retention
- **Action:** Ask:
  > *"Avoid highways too."*
- **Behind the Scenes (Explain):**
  - The server-side merge policy preserves the origin, destination, deadline, both avoid constraints, and the selected coffee stop, even if the model omits them from the third tool call.
  - The agent re-evaluates the route with both `avoid_tolls` and `avoid_highways` enabled.
  - The stop waypoint and 15-minute dwell are reinserted deterministically before the route is calculated. If no feasible highway-free route exists, the agent reports infeasibility instead of inventing one.
- **Visual Result:**
  - Route geometry on the map dynamically adjusts.
  - Constraint badges display both:
    - `✓ avoid tolls`
    - `✓ avoid highways`
  - The 15-minute café stop remains in the title and breakdown.
  - Audio playback speaks aloud using on-device Kokoro-82M neural TTS (Warm Copilot Bella) via WebGPU, with browser speech synthesis as a fallback.

---

### 2:20 – 2:35: Architecture & Hackathon Compliance Conclusion
- **Presenter (Voiceover):**
  > *"RoutePilot's foundation is a self-hosted Model Context Protocol server communicating over Streamable HTTP at `/mcp`, with Groq orchestrating real Nominatim, Valhalla, and Overpass geospatial tools. Deterministic plan merging, explicit constraint removal, and stale-route handling keep the visual plan and the conversation in agreement. Thank you!"*
- **Visual:** Briefly show the MCP server log in the terminal running tool calls over `/mcp`.
