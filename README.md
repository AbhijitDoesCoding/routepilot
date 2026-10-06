# RoutePilot

RoutePilot is a conversational travel-planning and decision-making agent designed for the "Build, Ship, Shape: Amazon Developer Hackathon 2026". Instead of requiring manual travel configurations, users can state their travel goals in natural language, and RoutePilot manages constraints and evaluates deterministic route options to recommend the best plan.

## Current Phase: Phase 1 (MCP Foundation)

We are currently at **Phase 1**, establishing the Model Context Protocol (MCP) foundation.

*Note: AI agent logic (Amazon Bedrock), map visualization (MapLibre), geocoding (Nominatim), routing (Valhalla), and the conversational frontend / Alexa+ integration are **future phases** and are not yet implemented.*

### Architecture at this Stage

The current architecture consists of a bare-bones Node.js HTTP server exposing an MCP interface using the official `@modelcontextprotocol/server` SDK (v2). It uses **Streamable HTTP** as the primary transport protocol, exposing a single endpoint for tool invocation and session management.

### The Role of MCP

The Model Context Protocol (MCP) acts as the strict interface boundary between the future Large Language Model (Amazon Bedrock) and deterministic external systems. The LLM will use this endpoint to call tools predictably.

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

The server will start on `http://localhost:3000` by default (configurable via the `PORT` environment variable).

### MCP Endpoint

The server exposes the MCP Streamable HTTP endpoint at:

```
POST http://localhost:3000/mcp
```

### Available Tools

Currently, the server exposes the following MCP tools:

- **`health_check`**: Returns structural information validating the health of the RoutePilot MCP server.

### Running Tests

Run the integration tests (which spin up a real MCP client to connect to the server) with:

```bash
npm test
```