# Hackathon Submission Checklist

**Hackathon:** Build, Ship, Shape: Amazon Developer Hackathon 2026  
**Project:** RoutePilot  
**Repository:** [https://github.com/AbhijitDoesCoding/routepilot](https://github.com/AbhijitDoesCoding/routepilot)  
**Status:** Release candidate — local automated verification complete

---

## 1. Primary Track: Alexa+

- **Track Selection:** Alexa+ Track
- **Implementation Mechanism:** Self-hosted Model Context Protocol (MCP) server over Streamable HTTP paired with a dedicated multimodal Alexa+ experience simulator.
- **Native Alexa+ SDK Disclaimer:** Native integration via `@alexa-ai/cli` and the private Alexa+ developer preview was not accessible to general hackathon participants. In strict adherence to official hackathon rules, RoutePilot provides a verified self-hosted MCP server implementing Streamable HTTP alongside a high-fidelity multimodal voice/visual simulator. We make **NO** false claims of native Alexa+ runtime integration.

---

## 2. Model Context Protocol (MCP) Verification

- **MCP Specification:** 2025-11-25 (or later) via `@modelcontextprotocol/server` v2 and `@modelcontextprotocol/client` v2
- **Transport:** Streamable HTTP (`POST /mcp`)
- **Runtime Tool Discovery:** Each agent loop queries `listTools()` on startup and maps tool schemas into provider tool specifications.
- **Active MCP Tools:**
  1. `health_check` – Validates MCP server connectivity, status, and version.
  2. `geocode` – Geocodes human-readable queries to coordinates via Nominatim.
  3. `calculate_route` – Point-to-point routing and polyline generation via Valhalla.
  4. `compare_routes` – Multi-candidate route evaluation against hard/soft constraints and stop dwell times, with deterministic continuation and explicit removal semantics.
  5. `find_places_along_route` – Real POI corridor search along route geometry via Overpass API, with Nominatim fallback.

---

## 3. LLM Provider Positioning

- **Active Demo Provider: Groq**
  - Model: `openai/gpt-oss-120b` via the official Groq tool-calling SDK.
  - Role: Conversational reasoning, intent parsing, multi-turn dialogue, and MCP tool execution.
  - Verified: the three-turn continuity regression runs against the Groq agent loop.
- **Amazon Bedrock:**
  - Service: `@aws-sdk/client-bedrock-runtime` (Converse API)
  - Status: Implemented as `BedrockAgent`; **not live-verified** in the current release pass.
  - Configuration: `AWS_REGION` (default `us-east-1`) and `BEDROCK_MODEL_ID`.
  - Strict Boundary: the LLM acts as orchestrator; all deterministic arithmetic, ETA calculations, constraint evaluations, geospatial validation, and plan merging are executed outside the model in TypeScript.
- **AWS Services Scope:** Only Amazon Bedrock is integrated. No unused AWS services are added.

---

## 4. External Data & Services

- **Geocoding:** OpenStreetMap Nominatim API (`NOMINATIM_BASE_URL`, `NOMINATIM_USER_AGENT`).
- **Routing Engine:** Valhalla Open-Source Routing Engine (`VALHALLA_BASE_URL`).
- **Places / POI Discovery:** OpenStreetMap Overpass API (`OVERPASS_BASE_URL`, `OVERPASS_USER_AGENT`).
- **Map Vector Tiles:** OpenFreeMap Liberty style (OpenStreetMap-based, keyless, privacy-preserving).
- **Traffic Feeds:** Live real-time traffic is explicitly **NOT** supported; all durations are deterministic based on OpenStreetMap road classifications.

---

## 5. Multimodal Experience Simulator

- **Frontend Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, MapLibre GL JS.
- **Voice Capabilities:**
  - Voice Input: Browser Web Speech API (`SpeechRecognition`) with visual listening feedback.
  - Voice Output: On-device neural speech generation via `Kokoro-82M-v1.0-ONNX` (`q8`) running inside a dedicated Web Worker (WebGPU with WASM fallback). Normalizes speech through `speechFormatter.ts`, provides selectable copilot personas (`af_bella` default warm copilot, `af_heart`, `am_michael`), and falls back to browser `speechSynthesis` when on-device inference is unavailable. The legacy `POST /api/tts` endpoint remains for backward compatibility.
  - Graceful Fallback: Functions completely in text mode on browsers without speech support.
- **Visual Presentation:**
  - Route line rendered dynamically via GeoJSON LineString.
  - Green origin marker, red destination marker, and amber intermediate stop markers.
  - `TravelPlanCard` presenting leave/arrive timestamps, driving vs. stop time breakdown, buffer minutes, and constraint verification badges (`✓`, `⚠`, `○`).
  - Failed reroutes retain the last successful metrics and geometry but display an explicit stale banner and faded amber route line.

---

## 6. Open Source Qualification

- **License:** ISC License (see [LICENSE](../LICENSE))
- **GitHub Username:** `AbhijitDoesCoding`
- **Suggested Primary Devpost Contribution:** [Valhalla #6361 — Fix valhalla_add_elevation tile validation](https://github.com/valhalla/valhalla/pull/6361). This upstream pull request was **merged on October 3, 2026** and is directly relevant to RoutePilot's Valhalla routing stack.
- **Additional External Open-Source Contributions Submitted During the Hackathon Window:**
  1. **[MapLibre Martin #3409 — Add CQL2 filtering for DuckDB sources](https://github.com/maplibre/martin/pull/3409)** — **Merged September 30, 2026.** Adds CQL2 filtering for DuckDB GeoParquet and table/view sources, with documentation and tests.
  2. **[Valhalla #6361 — Fix valhalla_add_elevation tile validation](https://github.com/valhalla/valhalla/pull/6361)** — **Merged October 3, 2026.** Fixes validation of the `tiles` argument and allows valid tile inputs to proceed.
  3. **[QubesOS/qubes-core-admin #910 — Use QubesVMInUseError for GuiVM dependencies](https://github.com/QubesOS/qubes-core-admin/pull/910)** — **Merged October 17, 2026.** Improves GuiVM dependency shutdown error handling and adds regression tests.
  4. **[QubesOS/qubes-core-admin-client #513 — Fix --wait dependency-order docs and add NetVM chain regression test](https://github.com/QubesOS/qubes-core-admin-client/pull/513)** — **Open** as of October 23, 2026. Corrects documentation and adds a unit/regression test for a multi-level NetVM dependency chain.
  5. **[Nominatim #4207 — Add place category when linking places](https://github.com/osm-search/Nominatim/pull/4207)** — **Closed, not merged** (October 13, 2026). Implements inherited place categories for linked places and adds regression tests.
  6. **[Valhalla #6390 — Fix adjacent pedestrian area routing](https://github.com/valhalla/valhalla/pull/6390)** — **Closed, not merged** (October 7, 2026). Proposes connecting adjacent pedestrian areas and adds a routing regression test.
- **Status Accuracy:** The Nominatim #4207 and Valhalla #6390 changes were submitted as upstream pull requests, even though they were not merged. They must not be described as merged. The Valhalla work is **not limited to a personal fork**: upstream PRs #6361 and #6390 exist, and #6361 was merged.
- **Project Repository Links:** [MapLibre Martin](https://github.com/maplibre/martin), [Valhalla](https://github.com/valhalla/valhalla), [Nominatim](https://github.com/osm-search/Nominatim), [QubesOS core-admin](https://github.com/QubesOS/qubes-core-admin), and [QubesOS core-admin-client](https://github.com/QubesOS/qubes-core-admin-client).
- **Devpost Entry Note:** If the mini-challenge form accepts only one contribution URL, use the merged Valhalla #6361 PR as the primary entry and include the other contribution links in the project story or supporting text where permitted.
- **Status:** Contribution URLs and current PR states verified on GitHub; ready for accurate Devpost entry.

---

## 7. Submission Quality Assurance

- [x] Zero raw secrets or personal AWS credentials committed to git
- [x] Clean `.gitignore` excluding `.env`, `dist`, `node_modules`, `playwright-report`, and `test-results`
- [x] 150 automated tests passing (`npm test`) with 0 failures
- [x] Full TypeScript compilation passes with 0 errors (`npm run build` in root and `frontend/`)
- [x] Frontend lint passes (`npm --prefix frontend run lint`)
- [x] Scripted three-turn continuity regression preserves deadline, toll/highway constraints, café stop, dwell, departure, ETA, and constraint evaluations
- [x] Failed-reroute stale-state and recovery regression passes
- [x] Bounded live Groq three-turn rehearsal passed: final plan retained the next-day deadline, toll/highway constraints, selected café, 15-minute dwell, and matching departure/ETA/duration
- [x] 93 Playwright E2E tests passing across 6 suites (`smoke`, `voice`, `localVoice`, `phase2`, `plan-update`, `browser-matrix`)
- [x] Live on-device Kokoro-82M WebGPU inference verified via `KOKORO_LIVE=1`
- [x] Safe server error responses on `/api/chat` without stack trace leakage
- [x] CORS properly configured via `CORS_ORIGIN`
- [x] Friction log documented in `docs/FRICTION_LOG.md`
- [x] Documented demonstration script in `docs/DEMO_SCRIPT.md`
