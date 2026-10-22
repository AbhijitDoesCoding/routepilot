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
- **Qualifying External Open-Source Contribution:**
  - **Contribution URL:** [QubesOS/qubes-core-admin-client #513](https://github.com/QubesOS/qubes-core-admin-client/pull/513)
  - **Project Repository:** [https://github.com/QubesOS/qubes-core-admin-client](https://github.com/QubesOS/qubes-core-admin-client)
  - **GitHub Username:** `AbhijitDoesCoding`
  - **Date Submitted:** October 14, 2026 (during the hackathon submission window)
  - **Description:** Documentation correction and regression-test contribution for a NetVM dependency chain (`qvm-shutdown: fix --wait dependency-order docs and add NetVM chain regression test`). Corrects inaccurate docs on `--wait` dependency ordering and adds unit/regression tests for shutdown chains.
  - **Upstream PR Clarification:** Valhalla routing fixes (`AbhijitDoesCoding/valhalla` branch `investigate/6386-area-route-skips-area`) were implemented on a personal fork and are not claimed as an upstream pull request.
- **Status:** Verified and ready for Devpost entry.

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
