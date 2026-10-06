# RoutePilot

RoutePilot is a conversational travel-planning and decision-making agent designed for the "Build, Ship, Shape: Amazon Developer Hackathon 2026". Instead of requiring manual travel configurations, users can state their travel goals in natural language, and RoutePilot manages constraints and evaluates deterministic route options to recommend the best plan.

## Current Phase: Phase 4.1 (Constraint Hardening)

We are currently at **Phase 4.1**, which hardens deterministic constraint evaluation, introduces deadline math, NOT_EVALUABLE semantics, and combined route generation in the `compare_routes` tool.

*Note: AI agent logic, map visualization (MapLibre), live traffic, weather, and the conversational frontend are **future phases** and are not yet implemented. This system does NOT currently provide live or Google-style traffic data.*

### Architecture at this Stage

The current architecture consists of a Node.js HTTP server exposing an MCP interface (using Streamable HTTP). The `NominatimProvider` serves as a clean abstraction for geocoding, and the `ValhallaProvider` abstracts route calculation. The `ConstraintEngine` deterministically evaluates route candidates against hard constraints and soft preferences (e.g. avoiding tolls, highways, deadline math) entirely within the RoutePilot domain, removing the need for an LLM to perform arithmetic or evaluate path logic.

### Configuration

To run the tools, you must set configuration values. Copy `.env.example` to `.env` and set:

```env
PORT=3000
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=RoutePilot/0.1.0
VALHALLA_BASE_URL=http://localhost:8002
```

**⚠️ Public Nominatim Usage Limitations:**
When using the public Nominatim endpoint, you must comply with their strict usage policies. A descriptive `NOMINATIM_USER_AGENT` is required. You must maintain a reasonable request rate and avoid flooding the API. Do not use the public API for bulk geocoding or commercial production traffic.

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/AbhijitDoesCoding/routepilot.git
cd routepilot

# Install dependencies
npm install
```

### Running the Server

Start the local development server:

```bash
npm run dev
```

Alternatively, build and start the production server:

```bash
npm run build
npm start
```

The server will start on `http://localhost:3000` by default.

### MCP Endpoint

The server exposes the MCP Streamable HTTP endpoint at:

```
POST http://localhost:3000/mcp
```

### Available Tools

Currently, the server exposes the following MCP tools:

- **`health_check`**: Returns structural information validating the health of the RoutePilot MCP server.
- **`geocode`**: Converts a human-readable place or address into geographic locations.
- **`calculate_route`**: Calculates a deterministic route between two or more geographic locations.
- **`compare_routes`**: Generates and evaluates multiple route candidates against constraints and returns a ranked recommendation.

#### Example MCP Usage (calculate_route)

An MCP client can call the `calculate_route` tool like this:

```json
{
  "method": "tools/call",
  "params": {
    "name": "calculate_route",
    "arguments": {
      "locations": [
        { "lat": 18.5793, "lon": 73.9089 },
        { "lat": 18.5204, "lon": 73.8567 }
      ],
      "mode": "auto",
      "avoid_tolls": false,
      "avoid_highways": false
    }
  }
}
```

This returns a normalized structured route including distance (km), duration (minutes), GeoJSON LineString geometry, and maneuvers.

### Running Tests

Run the integration tests and provider unit tests:

```bash
npm test
```

To run a quick manual script testing the routing and geocoding:

```bash
npx tsx scripts/test-nominatim.ts
npx tsx scripts/test-valhalla.ts
```