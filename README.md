# RoutePilot

RoutePilot is a conversational travel-planning and decision-making agent designed for the "Build, Ship, Shape: Amazon Developer Hackathon 2026". Instead of requiring manual travel configurations, users can state their travel goals in natural language, and RoutePilot manages constraints and evaluates deterministic route options to recommend the best plan.

## Current Phase: Phase 2 (Nominatim Geocoding)

We are currently at **Phase 2**, which integrates the public Nominatim API for geocoding through the MCP server.

*Note: Valhalla (routing) is the next phase. AI agent logic, map visualization (MapLibre), traffic, weather, and the conversational frontend are **future phases** and are not yet implemented.*

### Architecture at this Stage

The current architecture consists of a Node.js HTTP server exposing an MCP interface (using Streamable HTTP). The `NominatimProvider` serves as a clean abstraction connecting the MCP tool to the real Nominatim OpenStreetMap search API. The LLM agent will only interact with the normalized MCP schema, isolating it from the specifics of the Nominatim API.

### Configuration

To run the geocoding tools, you must set configuration values. Copy `.env.example` to `.env` and set:

```env
PORT=3000
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=RoutePilot/0.1.0
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

#### Example MCP Usage (geocode)

An MCP client can call the `geocode` tool like this:

```json
{
  "method": "tools/call",
  "params": {
    "name": "geocode",
    "arguments": {
      "query": "Pune Airport"
    }
  }
}
```

This returns a normalized structured array of potential locations with numerical coordinates (`lat` and `lon`).

### Running Tests

Run the integration tests and provider unit tests:

```bash
npm test
```

To run a quick manual script testing the real Nominatim API:

```bash
npx tsx scripts/test-nominatim.ts
```