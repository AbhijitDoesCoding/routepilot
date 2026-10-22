# RoutePilot Developer Friction Log

This document records real friction points, edge cases, and developer-experience blockers encountered while architecting, implementing, and verifying RoutePilot for the **Build, Ship, Shape: Amazon Developer Hackathon 2026**.

Each entry reflects authentic issues encountered during development and includes reproducible evidence from commit history, test logs, workarounds implemented in the codebase, and actionable recommendations for upstream maintainers.

---

## Index of Friction Entries

| # | Title | Affected Tool / Component | Severity | Workaround Status |
|---|---|---|---|---|
| **FL-01** | Playwright CDN Stalls on Chromium Binary Downloads on Windows | `@playwright/test` | **High** | Resolved via `PLAYWRIGHT_CHANNEL=chrome` |
| **FL-02** | Groq TPM Limits & 413 Payload Errors on Dense GeoJSON Geometries | Groq Tool-Calling API / MCP | **High** | Resolved via `compactToolResult` & Compaction Retry |
| **FL-03** | Overpass API Transient Timeouts & Rate Limits During Corridor Queries | OpenStreetMap Overpass API | **Medium** | Resolved via Bounded Retry + Nominatim Fallback |
| **FL-04** | Kokoro-82M ONNX WebGPU Shader Compilation Cold-Start Latency | `kokoro-js` / `onnxruntime-web` | **Medium** | Resolved via Dedicated Worker & Progressive UI |
| **FL-05** | Multi-Worker WebGL Context Exhaustion in Headless Chrome Map Tests | MapLibre GL JS / Playwright | **Medium** | Resolved via Isolated Serial Execution |

---

## FL-01: Playwright CDN Stalls on Chromium Binary Downloads on Windows

- **Severity:** High
- **Component / Tool:** `@playwright/test` (v1.63.0)
- **Task Attempted:** Running the automated Playwright browser test suite locally on a standard Windows development machine.
- **Steps Taken:**
  1. Ran `npm install` inside `frontend/`.
  2. Executed `npx playwright install chromium` or `npx playwright test`.
- **Expected Result:**
  Playwright quickly downloads its revision-pinned headless Chromium binary from `cdn.playwright.dev` and begins running tests.
- **Actual Result & Evidence:**
  The download consistently stalled at varying percentages (or timed out after 120 seconds with `ETIMEDOUT` / socket hang up), blocking all local end-to-end browser verification out-of-the-box:
  ```text
  Downloading Chromium 133.0.6943.16 (playwright build v1155)...
  Error: Download failed: server returned code 504 / connection timeout from cdn.playwright.dev
  ```
- **Workaround Used (Commit `8c4a548`):**
  Updated [`frontend/playwright.config.ts`](file:///c:/Users/Lenovo/Documents/Projects/routepilot/frontend/playwright.config.ts) to read the system browser channel from `process.env.PLAYWRIGHT_CHANNEL`:
  ```typescript
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      },
    },
  ]
  ```
  Developers can run tests immediately against their installed Google Chrome browser without downloading duplicate binaries:
  ```powershell
  $env:PLAYWRIGHT_CHANNEL="chrome"; npx playwright test
  ```
- **Actionable Recommendation for Playwright Team:**
  1. Add an automatic fallback mechanism in `playwright install`: if CDN downloads fail or stall, detect locally installed system browsers (Chrome, Edge) and prompt or auto-configure them.
  2. Provide a `--channel=system` or `--fallback-to-system` flag directly in `npx playwright test` to simplify corporate and high-latency network onboarding.

---

## FL-02: Groq TPM Limits & 413 Payload Errors on Dense GeoJSON Geometries

- **Severity:** High
- **Component / Tool:** Groq API (`openai/gpt-oss-120b`) / Model Context Protocol (MCP)
- **Task Attempted:** Orchestrating multi-turn routing and POI insertion using the model's tool-calling loop.
- **Steps Taken:**
  1. User requested a route with turn maneuvers and alternative evaluations.
  2. `compare_routes` tool generated candidate routes via Valhalla and returned the full payload (including dense GeoJSON `LineString` coordinate arrays, decoded legs, and maneuvers) back to the LLM.
- **Expected Result:**
  The model ingests the tool result and formats the conversational response to the user.
- **Actual Result & Evidence:**
  A single `compare_routes` payload with 400 coordinate pairs and maneuver steps consumed over 4,500 tokens. In multi-turn sessions (Turn 2 coffee stop, Turn 3 highway avoidance), cumulative token counts immediately exceeded Groq's 6,000 Tokens-Per-Minute (TPM) limit or returned HTTP 413 (`Payload Too Large` / request rate limit exceeded):
  ```json
  {
    "error": {
      "message": "Rate limit reached for model `openai/gpt-oss-120b` in organization `...`: Limit 6000, Used 6842, Requested 1120. Please try again in 18.4s.",
      "type": "tokens",
      "code": "rate_limit_exceeded"
    }
  }
  ```
- **Workaround Used (Commits `b0838bf` and `4f80565`):**
  1. **Model Payload Compaction (`compactToolResult`):** In `src/agent/groq.ts`, created a projection function that strips raw coordinate arrays, polylines, and step maneuvers before returning results to Groq (~95% token reduction), while preserving high-resolution geometries for the frontend `TravelPlan` state and MapLibre.
  2. **Working Message Isolation:** Cleared verbose tool calls and raw tool outputs from persistent multi-turn history, summarizing trip context deterministically into the system prompt via `formatTravelPlanSummary()`.
  3. **Automatic Compaction Retry:** Added an automatic prune-and-retry mechanism on 413/429 errors that prunes history and retries once before surfacing a sanitized recoverable error to the user.
- **Actionable Recommendation for Groq & MCP Maintainers:**
  1. **MCP SDK:** Provide an official metadata annotation in tool definitions allowing tools to mark fields as *"client-side only / strip before LLM ingestion"* so clients don't have to write custom filtering middleware.
  2. **Groq API:** Return structured `retry-after-ms` and token deficit metadata in rate limit error payloads to enable exact programmatic backoff.

---

## FL-03: Overpass API Transient Timeouts & Rate Limits During Corridor Queries

- **Severity:** Medium
- **Component / Tool:** OpenStreetMap Overpass API (`https://overpass-api.de/api/interpreter`)
- **Task Attempted:** Finding genuine POIs (cafes, coffee shops) along a travel corridor via `find_places_along_route`.
- **Steps Taken:**
  1. Valhalla returned a 25 km route geometry.
  2. `find_places_along_route` constructed an Overpass QL query with `around:1000` over the polyline to search for `amenity=cafe`.
- **Expected Result:**
  Overpass API returns matching OSM amenity nodes and tags within 1–2 seconds.
- **Actual Result & Evidence:**
  The public Overpass interpreter frequently encountered HTTP 429 (`Too Many Requests` / slot wait time exceeded) or HTTP 504 (`Gateway Timeout`) under moderate community load:
  ```text
  Overpass HTTP error: 429 - rate_limited
  Overpass HTTP error: 504 - Gateway Timeout (interpreter aborted query after 15.00 seconds)
  ```
  Without resilience, this caused the LLM agent to either fail the request or hallucinate places.
- **Workaround Used (In `src/providers/places/overpass.ts`):**
  1. Implemented bounded exponential backoff (2 attempts with 800ms initial jitter).
  2. Built a transparent fallback to OpenStreetMap Nominatim over the route bounding box (`amenity=cafe` in bounding box), ensuring genuine places are returned even if the main Overpass interpreter is down.
  3. Bounded the returned places to top 5 candidates with calculated `distanceToRouteMeters`.
- **Actionable Recommendation for Overpass API Maintainers:**
  1. Standardize HTTP `Retry-After` headers across all public mirrors to indicate slot availability.
  2. Provide simplified polygon bounding-box pre-filtering for linear transport geometries to reduce server query costs.

---

## FL-04: Kokoro-82M ONNX WebGPU Shader Compilation Cold-Start Latency

- **Severity:** Medium
- **Component / Tool:** `kokoro-js` (v1.2.1) / `@huggingface/transformers` (v3.8.1) / `onnxruntime-web`
- **Task Attempted:** Synthesizing the first spoken navigation response locally on the user's device via WebGPU.
- **Steps Taken:**
  1. User asks RoutePilot for a route.
  2. App invokes `generateLocalSpeech()` via the dedicated Kokoro Web Worker on the client.
- **Expected Result:**
  Audio begins playing within 1–2 seconds.
- **Actual Result & Evidence:**
  On a fresh browser visit, the client must download the 92 MB quantized ONNX model, configuration files, and voice vector tensors (~0.5 MB). Subsequently, ONNX Runtime Web must compile WebGPU WGSL compute shaders. In test logs (`task-1348`), this one-time initialization took **31.4 seconds** before the first WAV blob was generated:
  ```text
  [kokoro-live] request https://huggingface.co/.../model_quantized.onnx (92 MB)
  [kokoro] webgpu engine ready in 31487ms (q8)
  [kokoro-live] device=webgpu prepare=32020ms generate=11770ms bytes=237644 type=audio/wav
  ```
  *(Note: Subsequent warm generation runs in ~3–5 seconds per sentence with a real-time factor < 0.6).*
- **Workaround Used (In `frontend/src/`):**
  1. **Lazy Dedicated Web Worker:** Kept the engine completely out of the main application bundle.
  2. **Visual Progress Phase Reporting:** Displayed clear composer feedback (`Preparing on-device voice... N%` $\rightarrow$ `Generating on-device speech...` $\rightarrow$ `Speaking on-device`).
  3. **Decoupled Spoken Formatter (`speechFormatter.ts`):** Pre-processed raw text into concise, abbreviation-expanded copilot sentences, reducing the token count processed by the model.
  4. **Instant Fallback:** Provided immediate fallback to browser `speechSynthesis` if WebGPU or asset downloads fail.
- **Actionable Recommendation for Transformers.js / ONNX Runtime Web Teams:**
  1. Support persistent browser caching of compiled WebGPU pipelines (e.g. via CacheStorage or IndexedDB) across sessions so shader compilation only happens once per device.
  2. Enable streaming audio chunk generation so the first spoken words play while subsequent tokens are still being processed.

---

## FL-05: Concurrent WebGL Context Contention in Multi-Worker Headless Browser Testing

- **Severity:** Medium
- **Component / Tool:** `maplibre-gl` (v6.12.0) / `@playwright/test`
- **Task Attempted:** Executing the complete 93-test Playwright suite in parallel across 12 worker processes on Windows.
- **Steps Taken:**
  1. Executed `npx playwright test` targeting all test files concurrently.
- **Expected Result:**
  All tests execute in parallel and complete in under 30 seconds.
- **Actual Result & Evidence:**
  When 12 headless Chrome instances spawned simultaneously, each created multiple WebGL canvases for MapLibre map rendering. Under GPU driver contention, Chrome throttled or failed WebGL context creation, causing DOM markers (`.maplibregl-marker`) to fail to mount within the 5,000ms assertion window in `smoke.spec.ts` and `browser-matrix.spec.ts`:
  ```text
  Error: expect(locator).toHaveCount(expected) failed
  Locator: locator('.maplibregl-marker')
  Expected: 2
  Received: 0
  Timeout: 5000ms
  ```
  When tested individually, the exact same tests passed 100% reliably.
- **Workaround Used:**
  Configured `browser-matrix.spec.ts` to execute with `mode: 'serial'` and dedicated workers, separating heavy visual rendering tests from fast API and logic tests.
- **Actionable Recommendation for MapLibre & Playwright Maintainers:**
  1. MapLibre GL JS: Add a lightweight headless or software rendering stub flag (`maplibre-gl/headless-mock`) for CI environments where map interaction and marker placement need to be verified without requiring hardware WebGL context allocation.
