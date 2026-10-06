# RoutePilot: Product Requirements Document

## 1. Executive Summary
RoutePilot is a conversational travel-planning and decision-making agent built for the "Build, Ship, Shape: Amazon Developer Hackathon 2026". Unlike traditional navigation apps that simply answer "How do I get there?", RoutePilot answers "Given what I am trying to accomplish, what should I do?". Users describe their travel goals naturally (e.g., "I need to reach the airport by 7 AM, avoid tolls, and have luggage"), and RoutePilot understands the constraints, compares possible routes using deterministic geospatial services (Nominatim, Valhalla), and returns a recommended, visually structured travel plan along with conversational context.

## 2. Problem Statement
Current navigation tools require users to manually input origin, destination, time constraints, and preferences across disjointed settings menus. They do not understand natural language goals or constraints. Users must translate their real-world needs (e.g., "I have a meeting at 9 AM, I need coffee on the way, and I want to minimize walking") into complex app configurations, often resorting to mental math and manual route comparisons.

## 3. Target Users
- Commuters with strict arrival deadlines.
- Travelers dealing with complex multi-stop itineraries.
- Users who prefer conversational interfaces (like Alexa) over screen-heavy configurations.
- Delivery or gig workers who need to optimize routes on the fly.

## 4. User Personas
- **Busy Professional (Alice):** Needs to reach meetings on time. Values precise ETAs, clear buffer times, and hands-free updates while getting ready or driving.
- **Leisure Traveler (Bob):** Unfamiliar with the area. Wants to find coffee shops on the way and prefers scenic or toll-free routes.
- **Accessibility-Conscious User (Charlie):** Needs routes that minimize walking distance and avoid complicated transit transfers.

## 5. User Stories
- As a user, I want to tell the agent when I need to arrive, so that it tells me exactly when to leave.
- As a user, I want to state my preferences (e.g., avoid tolls, no highways), so that the recommended route respects them without me digging through menus.
- As a user, I want to ask "What if I leave 30 minutes later?", so that I can compare travel options without restarting my search.
- As a user, I want to add a stop (e.g., "Find a coffee shop on the way"), so the agent automatically recalculates the optimal route and adjusted departure time.

## 6. Core Use Cases
- **Constraint-Based Planning:** Generating travel plans based on strict arrival times and routing preferences.
- **Multi-Turn Route Adjustments:** Modifying an active plan conversationally (adding stops, changing times, altering constraints).
- **Trade-Off Explanation:** Explaining why a specific route was chosen over another (e.g., "I chose the highway because avoiding it would make you 15 minutes late").

## 7. Example Conversations
**User:** "I need to reach Pune Airport by 7 AM. I cannot be more than 10 minutes late, avoid tolls, and I have luggage."
**RoutePilot:** "To reach Pune Airport by 7:00 AM while avoiding tolls, you should leave home by 5:42 AM. This route minimizes walking for your luggage and takes 54 minutes, giving you a 24-minute buffer. Here is your travel plan."

**User:** "Actually, what if I leave at 6?"
**RoutePilot:** "If you leave at 6:00 AM on the toll-free route, you will arrive at 6:55 AM. That only leaves a 5-minute buffer, which breaks your 'no more than 10 minutes late' constraint. Do you want to take the toll road instead to save time?"

**User:** "Find a coffee shop on the way."
**RoutePilot:** "I found a Blue Tokai coffee shop 15 minutes into your route. Adding a 15-minute stop means you now need to leave by 5:27 AM to maintain your 24-minute buffer. I've updated your plan."

## 8. Product Goals
- Parse complex natural language constraints into structured geospatial queries.
- Combine LLM reasoning with deterministic geospatial APIs (Nominatim, Valhalla).
- Provide both conversational responses and structured visual travel plans.
- Create a robust MCP (Model Context Protocol) interface for geospatial tools.
- Fulfill requirements for the Alexa+, AWS Builder, and Open Source hackathon tracks.

## 9. Non-Goals
- Building a proprietary map rendering engine (we will use MapLibre GL JS).
- Building proprietary geocoding or routing engines (we will use Nominatim and Valhalla).
- Creating fake real-time traffic data (we will design abstractions, but not fake data).
- Replacing standard turn-by-turn navigation (we focus on the *planning* and *decision-making* phase).

## 10. Functional Requirements
- The system must extract intent, destination, time constraints, and preferences from natural language.
- The system must geocode natural language places to coordinates.
- The system must calculate routes and alternatives with accurate distances and durations.
- The system must evaluate route alternatives against user constraints.
- The system must output a structured `TravelPlan` object.
- The system must support conversational context across multiple turns.

## 11. Non-Functional Requirements
- **Latency:** Geospatial tool calls must be fast enough to support fluid conversation.
- **Extensibility:** The MCP architecture must easily support new tools (weather, calendar).
- **Accuracy:** The LLM must *never* hallucinate coordinates, distances, durations, or geometry. All math and mapping data must come from deterministic tools.
- **Portability:** The frontend must work as a web-based simulator, easily adaptable to voice interfaces.

## 12. User Experience
The primary UX is conversational. For the hackathon, a web simulator will provide a split-pane or chat-overlay view:
- **Chat Interface:** Text-based conversation with the agent.
- **Visual Travel Plan:** A structured UI card summarizing the plan.
- **Map View:** A MapLibre-rendered map displaying the route geometry, origin, destination, and stops.

## 13. Travel Plan Output Format
The system must generate a visual plan (rendered from a structured JSON object):
```text
--------------------------------
TRIP PLAN

Home → Pune Airport

Leave:       5:42 AM
Arrive:      6:36 AM
Buffer:      24 min
Duration:    54 min

Recommended route:
Avoid tolls
Minimize walking

STOPS
5:42  Leave home
6:20  Coffee stop
6:36  Arrive airport
--------------------------------
```

## 14. Conversational Behavior
- The agent must be decisive and recommend the *best* plan, rather than just listing all options.
- The agent must explicitly acknowledge constraints.
- The agent must explain trade-offs when constraints conflict (e.g., "You can't avoid tolls and arrive by 7 AM").
- The agent must ground all geographic claims in tool outputs.

## 15. Constraint Handling
Constraints must be parsed into a structured model (e.g., `arrival_deadline`, `avoid_tolls`, `max_walking_distance`, `required_stops`). The agent evaluates routes generated by Valhalla against this model. Routes that violate hard constraints are rejected or flagged with warnings.

## 16. Multi-Turn Conversation Requirements
The agent must remember the current `TravelPlan` and constraints. When the user says "Add a stop", the agent must know the active route, geocode the stop, insert it, recalculate the route, and update the plan without asking for the origin and destination again.

## 17. Failure/Error Behavior
- **Geocoding failure:** "I couldn't find a place matching 'XYZ'. Could you be more specific?"
- **Routing failure (no path):** "I couldn't find a valid route between those locations with your current constraints."
- **API timeouts:** Graceful degradation, informing the user that the routing service is temporarily unavailable.
- **Constraint impossibility:** "It is physically impossible to drive 100 miles in 30 minutes. You need to leave earlier."

## 18. Geospatial Architecture
- **Geocoding:** Nominatim (OpenStreetMap). Translates addresses/places to lat/lon.
- **Routing:** Valhalla. Provides route geometries, turn-by-turn steps, distances, durations, and costing (preferences).
- **Visualization:** MapLibre GL JS rendering vector tiles and GeoJSON route lines.
- **Map Data:** OpenStreetMap ecosystem.

## 19. MCP Architecture
The system will expose geospatial capabilities to the LLM via the Model Context Protocol (MCP). The MCP server will be strictly typed, using the official MCP TypeScript SDK. The LLM will use these tools to fetch data deterministically.

## 20. Alexa+ Integration Strategy
The agent's conversational core must be designed so the text-based responses can be piped to Alexa TTS (Text-to-Speech), and the structured `TravelPlan` can power Alexa APL (Alexa Presentation Language) visual cards. The hackathon entry will demonstrate this capability.

## 21. AWS/Bedrock Strategy
- **Core AI:** Amazon Bedrock for foundation models (Claude 3.5 Sonnet or similar) for intent extraction, tool calling, and response generation.
- **Hosting:** AWS Lambda for serverless execution of the MCP server and API endpoints.
- **Future:** DynamoDB for session state if required. No unnecessary services will be added.

## 22. Open Source Strategy
The project leverages MapLibre, Nominatim, and Valhalla. The owner has a history of contributing to these projects. For the Open Source mini-challenge, a *new, meaningful contribution* will be made to one of these repositories (e.g., a documentation improvement, bug fix, or feature related to Valhalla's routing parameters or MapLibre's rendering) during the hackathon period.

## 23. Security/Privacy Considerations
- User locations and travel plans are sensitive.
- No PII (Personally Identifiable Information) will be permanently logged.
- API keys (Bedrock, Map providers) must be stored securely using environment variables (`.env`) and never committed.
- Input validation on all MCP tool arguments to prevent injection.

## 24. Metrics/Success Criteria
- Successfully parses 90%+ of natural language constraints in testing.
- Generates valid travel plans without LLM hallucinations of distances/ETAs.
- Seamlessly handles multi-turn route modifications.
- Successfully integrates the Open Geospatial stack with Amazon Bedrock via MCP.

## 25. Hackathon Judging Strategy
- **Alexa+ Track:** Demonstrate conversational excellence, multi-turn context, and structured output suitable for voice/display interfaces.
- **AWS Builder:** Highlight the use of Amazon Bedrock and serverless AWS architecture.
- **Open Source:** Clearly document the *new* OSS contribution made during the hackathon, distinct from past contributions.

## 26. Future Roadmap
- Phase 0: PRD & Tech Spec (Current)
- Phase 1: MCP Foundation
- Phase 2-4: Core Geospatial (Nominatim, Valhalla, Constraints)
- Phase 5: Agent/Bedrock Integration
- Phase 6-7: MapLibre UI & Multi-turn UX
- Phase 8-10: Hackathon Specifics (Alexa, AWS, OSS)
- Phase 11: Demo & Polish
