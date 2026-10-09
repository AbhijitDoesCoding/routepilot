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
  - Amazon Bedrock parses user intent and identifies destination (`Pune Airport`), deadline (`7:00 AM`), and a hard constraint (`avoid_tolls`).
  - Bedrock executes the `geocode` MCP tool to resolve Pune Airport coordinates via OpenStreetMap Nominatim.
  - Bedrock calls the `compare_routes` MCP tool with the `avoid_tolls` constraint.
  - The deterministic `ConstraintEngine` generates route candidates via Valhalla, confirms toll avoidance, and calculates the exact latest departure time using `TimeUtils`.
- **Visual Result:**
  - Route line renders on MapLibre from origin to Pune Airport.
  - Recommended Plan card displays:
    - Departure: `5:58 AM`
    - Arrival: `6:50 AM` (10-minute buffer before 7:00 AM deadline)
    - Travel Time: `52 min`
    - Constraint badge: `✓ avoid tolls` (verified by backend, not guessed by LLM).

---

### 1:05 – 1:50: Turn 2 – Route-Aware Stop Planning
- **Action:** Ask:
  > *"Also find a coffee shop on the way."*
- **Behind the Scenes (Explain):**
  - Rather than a generic city-wide search, the agent calls the `find_places_along_route` MCP tool.
  - It queries the OpenStreetMap Overpass API for real cafes along the actual route corridor.
  - The closest verified place (`Café Corner`) is selected.
  - The agent calls `compare_routes` with the coffee stop as an intermediate waypoint and includes a 15-minute dwell time.
  - **Deterministic Math:** The backend computes:
    $$\text{Total Duration} = 52\text{ min (driving)} + 15\text{ min (coffee stop)} = 67\text{ min}$$
    $$\text{Latest Departure} = 7:00\text{ AM} - 67\text{ min} - 5\text{ min buffer} = 5:48\text{ AM}$$
- **Visual Result:**
  - Map updates with an amber marker for the coffee stop.
  - Plan card title updates to: `Home → Café Corner → Pune Airport`.
  - Detailed breakdown displays:
    - `Driving: 52 min`
    - `Café Corner: 15 min stop`
    - `Total: 67 min`
    - `Buffer: 5 min buffer`

---

### 1:50 – 2:20: Turn 3 – Multi-Turn Context Retention
- **Action:** Ask:
  > *"Avoid highways too."*
- **Behind the Scenes (Explain):**
  - The session preserves the origin, destination, deadline, and selected coffee stop.
  - Bedrock re-evaluates the route with both `avoid_tolls` and `avoid_highways` enabled.
  - A highway-free detour is generated, dwell time is preserved, and the departure time adjusts accordingly.
- **Visual Result:**
  - Route geometry on the map dynamically adjusts.
  - Constraint badges now display both:
    - `✓ avoid tolls`
    - `✓ avoid highways`
  - Audio playback button reads the recommendation aloud using browser speech synthesis.

---

### 2:20 – 2:35: Architecture & Hackathon Compliance Conclusion
- **Presenter (Voiceover):**
  > *"RoutePilot's foundation is a self-hosted Model Context Protocol server communicating over Streamable HTTP at `/mcp`, powering Amazon Bedrock with real Nominatim, Valhalla, and Overpass geospatial tools. Deterministic decisions, zero LLM hallucination, and a true multimodal Alexa+ experience. Thank you!"*
- **Visual:** Briefly show the MCP server log in the terminal running tool calls over `/mcp`.
