# RoutePilot — Current Implementation & Verification Report

**Audit date:** 2026-10-22  
**Repository:** https://github.com/AbhijitDoesCoding/routepilot  
**Audited branch:** `feat/alexa-agent`  
**HEAD:** `953f5a020d672e007fd758fee2edf2d5a15e9b2e` — `feat: neural TTS with mute, live map updates, and resilient routing`  
**Audit type:** Read-only technical audit. No application code, tests, or configuration were modified. This report is the only new file and is intentionally uncommitted.

**Status labels used throughout:**

- **VERIFIED** — supported by actual execution evidence (command output, live service response, or a directly exercised code path).
- **MOCK-TESTED** — verified only against mocks / scripted LLM responses.
- **IMPLEMENTED** — code exists but has not been adequately tested.
- **FAILED** — execution failed.
- **UNVERIFIED** — insufficient evidence to make a claim either way.

---

## 1. Executive Summary

RoutePilot is a real, working Node/TypeScript agent with a deterministic routing/constraint core, a genuine MCP server over Streamable HTTP, three real geospatial providers (Nominatim, Valhalla, Overpass), and a React/MapLibre frontend. The backend compiles, the frontend compiles and lints, and the current Groq API key works with a live request.

The repository is **not fully green**: `npm test` runs 105 tests with **104 passing and 1 failing**. The failure is a stale assertion in the Overpass test that was not updated when the Nominatim POI fallback was added; the provider's actual Overpass retry metadata is correct.

Live POI discovery was exercised once between Pune Railway Station and Pune Airport. **Valhalla succeeded**, **Overpass timed out after ~10 seconds**, and the **Nominatim fallback returned five real cafés** with correct route distances. So real POI discovery works today, but not through Overpass at the time of this audit. Any claim that "Overpass is working" would be unsupported.

The largest product risk is **canonical-plan continuity**: the planner rebuilds the `TravelPlan` solely from the latest `compare_routes` input. When a follow-up tool call omits the deadline or the `stops` array, the planner silently drops the deadline or the stop. This was confirmed by directly exercising the planner. The system prompt asks the model to retain them, but no deterministic code enforces it. That can produce incorrect travel advice in the exact three-turn demo the project is built around.

**Demo readiness:** conditionally ready for a **Groq-backed** live demo, provided the presenter rehearses the exact turns and the environment has working internet, a live Groq key, Valhalla, and either Overpass or Nominatim. It is **not** ready to claim a green test suite, healthy Overpass, or verified Bedrock execution. The three-turn workflow was **not** executed live during this audit.

---

## 2. Current Commit and Repository State

### 2.1 Command results

| Command | Result |
|---|---|
| `git status --short` | empty output — working tree clean |
| `git branch --show-current` | `feat/alexa-agent` |
| `git rev-parse HEAD` | `953f5a020d672e007fd758fee2edf2d5a15e9b2e` |
| Upstream | `origin/feat/alexa-agent`; branch is in sync with it |
| `git diff --stat` | empty |
| `git diff --cached --stat` | empty |
| `git diff` | empty |
| `git rev-list --left-right --count origin/main...HEAD` | `0 1` — 0 commits behind `origin/main`, 1 ahead |

The single commit ahead of `origin/main` is `953f5a0`. The local `origin/feat/alexa-agent` ref matches HEAD.

### 2.2 `git log -8 --oneline`

```
953f5a0 feat: neural TTS with mute, live map updates, and resilient routing
978f195 fix: bound tool retries and finalize Groq turns
b0838bf fix: bound Groq context and tool payloads
6e6ec24 fix: enforce current-time deadline feasibility
f964ff0 fix: restore deadline-first route rendering
19dca93 feat: render markdown in chat messages and add deadline rollover rule
8e883d6 fix: set public Valhalla endpoint and exclude maplibre-gl from optimizeDeps
767098a feat: add configurable Groq model provider
```

### 2.3 Files changed in recent commits

- `953f5a0` (8 files): neural TTS (`src/api/tts.ts`), voice hook/mute UI, `/api/plan` live-map polling, Nominatim POI fallback in `src/providers/places/overpass.ts`, small Groq changes.
- `978f195` (6 files): bounded tool retries, failed-call deduplication, finalization turn, Overpass error taxonomy, new tests.
- `b0838bf` (5 files): Groq context bounding, compact model-facing tool results, full geometry retained in `TravelPlan`, tests/docs.
- `6e6ec24` (3 files): current-time deadline feasibility in `ConstraintEngine` / `compare_routes`, tests.
- `f964ff0` (9 files): deadline-first rendering in planner and map, geometry validation, planner tests.

### 2.4 Uncommitted / staged changes

None. `.env` exists locally but is ignored by Git (`.gitignore:69`) and is not tracked. Its values were not read into this report; only key presence was checked. No secrets are reproduced here.

### 2.5 Environment key presence (values redacted)

The local `.env` contains non-empty entries for:

`PORT`, `NOMINATIM_BASE_URL`, `NOMINATIM_USER_AGENT`, `VALHALLA_BASE_URL`, `OVERPASS_BASE_URL`, `OVERPASS_USER_AGENT`, `LLM_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL_ID`, `GROQ_MAX_COMPLETION_TOKENS`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DEFAULT_TIMEZONE`, `DEFAULT_ORIGIN_QUERY`, `CORS_ORIGIN`, `LOG_LEVEL`.

The configured provider in the local `.env` is `groq`. Presence of AWS keys does not prove Bedrock works; no live Bedrock call was made.

---

## 3. Architecture and Provider Status

### 3.1 Actual architecture

```
Browser (React 19 + MapLibre GL + Web Speech + Groq Orpheus TTS)
   │  POST /api/chat, GET /api/plan, POST /api/tts
   ▼
Node HTTP server (src/index.ts, single port)
   ├── /mcp  → createMcpHandler → RoutePilot MCP server (5 tools)
   ├── /api/chat → createAgent → GroqAgent | BedrockAgent
   ├── /api/plan → in-memory SessionStore side-channel for early map updates
   └── /api/tts  → Groq Orpheus speech (client falls back to browser speech)
   ▼
MCPClientService (Streamable HTTP client to the same /mcp endpoint)
   ▼
MCP tools:
   health_check, geocode, calculate_route, compare_routes, find_places_along_route
   ▼
Providers:
   Nominatim (geocoding)
   Valhalla (routing + precision-6 polyline → GeoJSON)
   Overpass (cafe POIs along route geometry) → Nominatim fallback on failure
   ▼
ConstraintEngine (deterministic hard/soft evaluation, ranking)
   ▼
updateTravelPlanFromCompareRoutes (shared deterministic TravelPlan builder)
   ▼
TravelPlan → frontend map/card
```

Important implementation facts:

- The server starts listening first, then the internal MCP client connects to its own `/mcp` endpoint, then the agent is created (`src/index.ts:76-90`).
- Both agents use the same `MCPClientService` and the same `updateTravelPlanFromCompareRoutes` (`src/agent/client.ts:103-111`, `src/agent/groq.ts:385-411`, `src/agent/planner.ts:16`). **VERIFIED by code inspection.**
- The canonical `TravelPlan` is built from the **uncompacted** MCP `compare_routes` result; the compact version is only for the model (`src/agent/groq.ts:405-416`). **VERIFIED by test 13 in `tests/agent/groq.test.ts` and code.**
- `compare_routes` generates up to four Valhalla candidates when constraints are present: default, no-tolls, no-highways, and combined (`src/mcp/tools/compare_routes.ts:69-107`).
- Stop dwell time is added to total duration in `compare_routes` (`src/mcp/tools/compare_routes.ts:48-66`), and all deadline math uses that total.

### 3.2 Provider status

| Provider | Selection | Implementation | Test evidence | Live evidence | Status |
|---|---|---|---|---|---|
| Groq | `LLM_PROVIDER=groq` | `src/agent/groq.ts` | 22+ mocked tests in `tests/agent/groq.test.ts` | One live completion succeeded (model `openai/gpt-oss-120b`, 473 ms) | **IMPLEMENTED + live API connectivity VERIFIED; full tool loop MOCK-TESTED** |
| Bedrock | `LLM_PROVIDER=bedrock` | `src/agent/client.ts` | 2 mocked tests in `tests/agent/loop.test.ts` | None | **IMPLEMENTED; MOCK-TESTED only; live UNVERIFIED** |

**Default selection discrepancy:** `createAgent` defaults to `bedrock` when `LLM_PROVIDER` is unset (`src/agent/factory.ts:19`), while `.env.example:9` and the README configuration snippet set `groq`. In this checkout the local `.env` explicitly sets `groq`, so the running demo uses Groq. Without `LLM_PROVIDER`, the server would try Bedrock and fail if `BEDROCK_MODEL_ID`/AWS access were unavailable.

**GROQ_API_KEY requirement:** the Groq agent constructor throws if the key is missing (`src/agent/groq.ts:209-212`).

**Bedrock requirements:** `BEDROCK_MODEL_ID` is required (`src/agent/client.ts:34-39`); region comes from `BEDROCK_REGION`, then `AWS_REGION`, then `us-east-1`; credentials use the SDK default chain. The SDK reads credentials from the process environment because the app is started with `--env-file=.env`.

**Shared deterministic layer:** both providers call the same MCP tools and the same planner. Neither performs route arithmetic itself. **VERIFIED.**

**Multi-turn context:**

- Groq: persistent history stores only clean user/assistant text, capped at 6 messages; the model receives the last 4 (`src/agent/groq.ts:220-244`, `469-474`). A deterministic `ACTIVE TRAVEL PLAN CONTEXT` summary is injected into the system prompt (`src/agent/groq.ts:21-66`, `233-237`). Covered by tests 14 and 15.
- Bedrock: `context.messages` is mutated and persisted directly, including assistant tool-use messages and full tool-result payloads (`src/agent/client.ts:51-54`, `88-89`, `113-137`, `152`). There is no compaction, no bounded history, and no finalization turn. Over multiple turns this context grows without bound.

**Error sanitization:**

- `/api/chat` returns `{"error":"Route planning is temporarily unavailable."}` for uncaught errors and logs details server-side (`src/api/chat.ts:55-59`). **VERIFIED by test.**
- Groq returns a specific sanitized message for 413/429/token-limit failures (`src/agent/groq.ts:308-322`). **VERIFIED by tests 16 and 17.**
- MCP tool error payloads (provider status, category, generic message) are sent to the model, not directly to the user. A model could echo them, but they contain no credentials. **IMPLEMENTED.**
- Bedrock send errors propagate to the generic `/api/chat` 500. **IMPLEMENTED.**
- No AWS/Groq secrets are exposed to the browser. **VERIFIED by code inspection.**

### 3.3 Documentation vs implementation discrepancies

| Documentation claim | Actual implementation |
|---|---|
| README says 60 tests (`README.md:195`); TECH_SPEC says 72 (`docs/TECH_SPEC.md:56`); HACKATHON_CHECKLIST says "60 automated tests passing ... 0 failures" (`docs/HACKATHON_CHECKLIST.md:80`) | Actual suite is 105 tests, 104 pass, 1 fail |
| Demo script describes Bedrock as the active reasoner (`docs/DEMO_SCRIPT.md:21-23`, `57-64`) | Local config and `.env.example` use Groq; Bedrock is implemented but not live-tested |
| Demo script expects a 5-minute buffer and 5:48 departure after the stop (`docs/DEMO_SCRIPT.md:44-53`) | Planner uses `requiredBuffer = 0` (`src/agent/planner.ts:117`), so the computed departure is exactly 67 minutes before 07:00 and the card shows `0 min buffer` |
| README/checklist describe browser Speech Synthesis as the voice output (`README.md:50`, `docs/HACKATHON_CHECKLIST.md:58`) | Current code calls Groq Orpheus via `/api/tts`, with browser speech only as fallback (`frontend/src/hooks/useSpeech.ts:81-160`, `src/api/tts.ts`) |
| TECH_SPEC describes POI discovery as Overpass only (`docs/TECH_SPEC.md:22`, `111`) | Overpass failures fall back to Nominatim (`src/providers/places/overpass.ts:78-101`); the fallback is undocumented |
| TECH_SPEC repo structure lists 72 tests and omits `src/api/tts.ts`, `MarkdownRenderer`, and `/api/plan` | All three exist |
| README config snippet says Valhalla defaults to `http://localhost:8002` (`README.md:114`) | `.env.example:4` points at a public Valhalla endpoint |
| README prerequisites emphasize AWS credentials (`README.md:87`) | The example/default demo path is Groq |

---

## 4. Groq Context and Tool-Loop Status

### 4.1 Checklist

| Requirement | Result | Evidence |
|---|---|---|
| Persistent conversational history is bounded | **PASS** | Stored `slice(-6)`, consumed `slice(-4)` (`src/agent/groq.ts:228`, `474`) |
| Completed raw tool results are not replayed indefinitely | **PASS** | Only user/assistant text is persisted (`src/agent/groq.ts:222-225`, `469-474`); test 14 |
| Current-turn tool-call IDs and results remain paired | **PASS** | Every tool call gets a `role:"tool"` message, including malformed args and blocked repeats (`src/agent/groq.ts:355-383`, `413-425`) |
| Large route geometries excluded from model-facing results | **PASS** | `compactToolResult` strips geometry/legs/maneuvers (`src/agent/groq.ts:78-124`); tests 10, 13 |
| Canonical `TravelPlan` still receives full geometry | **PASS** | Planner receives `result.data` before compaction (`src/agent/groq.ts:405-411`); test 13 asserts 266 coordinates |
| Token-budget settings configurable and validated | **PARTIAL** | `GROQ_MAX_COMPLETION_TOKENS` is configurable but parsed with `parseInt` and no validation (`src/agent/groq.ts:215`); no input-token budget or counting |
| Compaction retry cannot repeat an unchanged oversized request | **PASS** | Retry removes history once and uses `maxRetries: 0`; if it still fails, returns a sanitized message (`src/agent/groq.ts:269-323`); tests 16-17 |
| Tool-round limits enforced correctly | **PARTIAL** | Rounds are capped at `MAX_TOOL_ROUNDS` (default 5), but every tool call inside one assistant response executes; `MAX_TOOL_ROUNDS` is not validated (`src/agent/groq.ts:248-255`, `346-427`) |
| One final opportunity to summarize after final tool execution | **PASS** | If the last working message is a tool result, a final call runs with `tools: undefined` and `tool_choice:"none"` (`src/agent/groq.ts:434-463`); tests 18-19 |
| Final assistant responses preserved at max tool budget | **PASS** | Content is captured per round and finalization/fallback is used (`src/agent/groq.ts:335-337`, `465-467`); test 18 |
| Provider errors and MCP errors distinguished | **PASS** | MCP `result.isError` is logged with category/status; Groq API errors are classified separately (`src/agent/groq.ts:269-322`, `392-403`) |
| Repeated failed tools cannot create an unbounded retry loop | **PASS** | Identical failed `name+args` signatures are blocked for the rest of the turn (`src/agent/groq.ts:368-383`); test 20 |
| Deterministic text fallback when the model produces no final text | **PASS** | `buildTravelPlanFallback` constructs a summary from the plan (`src/agent/groq.ts:170-190`, `456-467`) |

### 4.2 Remaining defects and risks

1. **Stale plan after a failed `compare_routes` call — P1.** The planner runs only when `!result.isError` (`src/agent/groq.ts:406-408`). If routing fails on a follow-up turn, the previous `TravelPlan` (route, ETA, departure, distance) remains in the session and is returned to the UI. The assistant may say it could not recompute while the card and map still show the old plan as current. Requirement 6 ("No stale route metrics after a new route fails") is not met for provider failures; it is met only for a successful `compare_routes` response with `feasible:false`, which clears the metrics (`src/agent/planner.ts:55-70`).

2. **No input-token budget or validation — P2.** Only completion tokens are bounded. `parseInt` can produce `NaN`; `MAX_TOOL_ROUNDS=0` would skip the loop entirely and return the "too many tool calls" fallback. Invalid values are not rejected at startup.

3. **Tool-round cap is per assistant response, not per tool call — P2.** One response containing many tool calls executes all of them. The MCP exposes only five tools, so practical risk is low, but the budget is not call-count based.

4. **No consistency check between final text and the canonical plan — P1/P2.** The prompt forbids inventing times or claiming feasibility, and includes a deterministic plan summary, but nothing validates the assistant's natural-language response against `TravelPlan`. A model that says "you'll arrive by 7 AM" while the plan is infeasible will not be caught. The deterministic fallback is only used when the model produces no text.

5. **Completion-token budget can be consumed by reasoning — P2.** The live check with `max_completion_tokens: 8` returned `finish_reason:"length"` with zero content. At the default 1200 tokens this is unlikely, but a verbose reasoning pass can still exhaust the budget and trigger the fallback rather than a natural explanation.

6. **No retry around MCP transport calls in the agent — P2.** `executeTool` has no retry; provider-level retries exist only inside Overpass. A transient MCP/HTTP failure becomes a tool error immediately (bounded, but not resilient).

---

## 5. Overpass / Real POI Verification

### 5.1 Code answers

1. **Is the provider implemented?** Yes — `src/providers/places/overpass.ts` implements `PlacesProvider`.
2. **Does the MCP tool call the real provider?** Yes — `findPlacesAlongRouteHandler` instantiates `OverpassProvider` and calls `findPlacesAlongRoute` (`src/mcp/tools/find_places_along_route.ts:13-14`, `43-48`).
3. **Does it use calculated route geometry rather than a city search?** Yes — the tool first calls Valhalla for the requested locations, then passes `routeResult.geometry` to the POI query (`src/mcp/tools/find_places_along_route.ts:39-48`). The query is a padded bounding box around the route, and results are filtered by distance to the route polyline.
4. **Are results filtered by distance from the route?** Yes — `distanceToLineString` computes point-to-segment minimum distance, and only places `<= radiusMeters` are returned (`src/providers/places/overpass.ts:269-287`).
5. **Does it distinguish a successful empty result from a provider error?** Yes at the tool boundary — an empty array returns `{message:"No places found...", places:[]}` without `isError`; a provider failure returns `isError:true` with `category`, `status`, `retryable:false`, and an instruction not to repeat the call (`src/mcp/tools/find_places_along_route.ts:50-100`). **MOCK-TESTED** in `tests/mcp/find_places.test.ts:113-169`.
6. **Are timeouts, HTTP failures, and malformed responses handled?** Yes — 10-second abort timeout, HTTP status taxonomy (`rate_limited`, `server_error`, `client_error`), malformed-response detection, and a Nominatim fallback (`src/providers/places/overpass.ts:205-329`, `78-101`).
7. **Are retry attempts bounded?** Yes — at most two Overpass attempts, and only for HTTP 429/5xx. Timeouts and other exceptions are not retried (`src/providers/places/overpass.ts:205`, `226-252`, `289-320`).
8. **Is `distanceToRouteMeters` preserved in the model-facing result?** Yes — `compactToolResult` maps `p.distanceToRouteMeters ?? p.distanceMeters` (`src/agent/groq.ts:146-160`); test 11.
9. **Does the agent select only a real returned place?** **Prompt-enforced only.** The system prompt says to select the closest returned place and never invent one (`src/agent/prompts/routepilot.ts:41-56`), but the planner accepts any `stops` array the model supplies and does not validate it against the last `find_places_along_route` result (`src/agent/planner.ts:49-53`). No POI ID or provenance is carried into `TravelPlan`.
10. **Does the final `compare_routes` include the selected stop as an intermediate waypoint and its dwell duration?** **Prompt-enforced; not server-enforced.** The prompt instructs the model to insert the stop into `locations` and include a `stops` entry with dwell time (`src/agent/prompts/routepilot.ts:41-49`). `compare_routes` will add the dwell duration if `stops` is present (`src/mcp/tools/compare_routes.ts:48-66`), but it does not verify that a stop corresponds to a `locations` waypoint. **MOCK-TESTED** with scripted tool calls (test 22); no live agent turn was run.

### 5.2 Controlled live verification

**Method:** one invocation of `findPlacesAlongRouteHandler` with the real configured Valhalla and POI endpoints, route Pune Railway Station `(18.5280, 73.8740)` → Pune Airport `(18.5793, 73.9089)`, mode `auto`, category `cafe`, radius `1000 m`, limit `5`. This is one route calculation and one POI query, with the implementation's own bounded retry/fallback behavior.

**Result: SUCCESS via Nominatim fallback.**

| Check | Result |
|---|---|
| Valhalla route | **Succeeded** (the tool proceeded to the POI phase and returned route-derived places; a Valhalla failure would have produced `isError` before POI discovery). Route metrics were not surfaced by the tool. |
| Overpass | **FAILED** — `AbortError`, mapped to `timeout`, attempt 1, duration `10,008 ms`. No HTTP status (client-side abort). |
| Nominatim fallback | **Succeeded** — 5 places returned; log: `Overpass unavailable; using Nominatim fallback`, count 5 |
| Tool `isError` | `false` — the turn is treated as a successful POI result |
| Total tool latency | `13,404 ms` |

Returned places (real OSM/Nominatim data, all category `cafe`):

| Name | Coordinates | Distance to route |
|---|---|---|
| Vohuman Cafe | 18.5324382, 73.8768496 | 36.67 m |
| Vohuman Café | 18.5325235, 73.876734 | 51.95 m |
| Durga cafe | 18.534984, 73.8805839 | 73.32 m |
| Durga Cafe | 18.5349834, 73.8806036 | 75.08 m |
| Kalpana Tea Center | 18.5273227, 73.8729906 | 85.69 m |

**Interpretation:**

- Real POI discovery **works today** through the Nominatim fallback, with genuine names, coordinates, and route distances.
- **Overpass did not return a valid response during this audit.** It timed out. The implementation handled the failure gracefully and the tool still returned real data, but the README's Overpass-centric claim is not currently live-verified.
- The fallback result contains near-duplicates (`Vohuman Cafe` / `Vohuman Café`, `Durga cafe` / `Durga Cafe`). This wastes result slots and can make the model pick a duplicate; it is not a correctness failure.
- The 13.4-second POI call is noticeable in an interactive turn. Combined with several LLM rounds, a demo turn can be slow, though it remains under the frontend's 120-second timeout.
- The empty-vs-error distinction is implemented and mock-tested, but the live run did not produce an empty result or a terminal provider error; it produced a fallback success.

### 5.3 Test-quality note

- `tests/mcp/find_places.test.ts:15-55` is named "should return structured places when found", but it only asserts `!result.isError`; it does not assert that any place was returned. The mocked Valhalla polyline decodes to coordinates far from the mocked POI, so the POI is actually filtered out and the test passes on an empty result. This test does **not** prove structured place return.
- The live check above is stronger evidence than that test.

---

## 6. Routing and Deadline Correctness

### 6.1 Control flow

`compare_routes` → Valhalla candidates → `ConstraintEngine.evaluate` per candidate → `ConstraintEngine.rank` → JSON result → planner → `TravelPlan` → frontend.

### 6.2 Verified behavior

| Behavior | Result | Evidence |
|---|---|---|
| Deadline-first planning when no departure is supplied | **IMPLEMENTED + MOCK-TESTED** | `arrivalConstraint` with no `departure_time` computes `calculateLatestDeparture` (`src/agent/planner.ts:114-121`); planner tests 1-2 |
| Departure-first planning with explicit departure | **IMPLEMENTED + MOCK-TESTED** | `input.departure_time` preserves departure and computes ETA/buffer (`src/agent/planner.ts:102-113`); planner test 3 |
| Current-time feasibility | **IMPLEMENTED + MOCK-TESTED** | Deadline-first compares required departure to `currentTimeIso` and marks the constraint violated if in the past (`src/domain/constraints.ts:124-143`); tests in `constraints.test.ts` and `integration.test.ts` |
| Deadline rollover ("7 AM" after it has passed → next occurrence) | **PROMPT-ONLY** | `src/agent/prompts/routepilot.ts:32-37`; no deterministic date parser |
| Stop dwell included in total journey time | **VERIFIED by unit tests** | `compare_routes` sums dwell and adds it to duration (`src/mcp/tools/compare_routes.ts:48-66`); planner/stop tests |
| Constraint status accuracy | **IMPLEMENTED + MOCK-TESTED** | Hard violations invalidate; hard `not_evaluable` invalidates; soft violations penalize (`src/domain/constraints.ts:153-169`) |
| All candidates violate hard constraints | **IMPLEMENTED + MOCK-TESTED** | `rank` returns `feasible:false` with the best invalid candidate and reason (`src/domain/constraints.ts:213-220`); planner clears route geometry/metrics (`src/agent/planner.ts:55-70`) |
| Consistent ETA, departure, buffer, total duration | **PASS for correct inputs** | Planner uses total duration for both deadline-first and departure-first; planner tests 1-3 |
| No stale metrics after a new route fails | **PARTIAL / FAILED for tool errors** | Infeasible success clears metrics; a thrown/`isError` `compare_routes` leaves the previous plan untouched (see §4.2) |
| No false claim that an infeasible route succeeded | **PROMPT-GUARDED, NOT VERIFIED** | Planner clears the route and sets warnings; prompt forbids claiming success (`src/agent/prompts/routepilot.ts:16`); no post-hoc text/plan reconciliation |

### 6.3 Confirmed correctness issue: plan continuity is not deterministic (P0)

The planner rebuilds timing and stops from the **latest** tool input:

- `stops` is set to `input.stops` if present, otherwise explicitly cleared (`src/agent/planner.ts:49-53`).
- `arrivalDeadline`/`departureTime`/`actualEta`/`bufferMinutes` are derived only from `input.constraints` and `input.departure_time` (`src/agent/planner.ts:100-127`).
- `constraints` is overwritten whenever `input.constraints` is present (`src/agent/planner.ts:38-40`).

The system prompt asks the model to preserve context (`src/agent/prompts/routepilot.ts:14`, `41-49`), but nothing enforces it.

I exercised the real planner with three scenarios:

1. **Turn 3 recomputes with the stop but omits the deadline constraint.** Result: `arrivalDeadline`, `departureTime`, `actualEta`, and `bufferMinutes` all become `undefined`; `constraints` becomes only `avoid_highways`; the stop remains. The plan card would show a route with no departure/ETA and no deadline badge, while the conversation still says "by 7 AM."
2. **Turn 3 includes the deadline but omits the `stops` array.** Result: `stops` becomes `undefined`; the stop marker disappears and the planner does not add dwell (in a real call, `compare_routes` would also compute zero stop duration because `stops` is absent). The route may still pass through the stop coordinates if the model included them in `locations`, but the canonical plan no longer records the stop.
3. **A stop-containing turn returns `feasible:false`.** Result: route geometry and metrics are cleared, warnings are set, but `stops` remains populated and origin/destination remain. The card title can still read `Origin → Stop → Destination` for an infeasible plan, and `/api/plan` returns `null` because `distanceKm` is undefined.

**Impact:** the exact three-turn demo can lose the 07:00 deadline or the 15-minute stop without any error. That is incorrect travel advice and violates the project's "deterministic, never loses constraints" claim.

### 6.4 Other routing/deadline risks

- **Stop corridor uses an unconstrained baseline route.** `find_places_along_route` calls Valhalla without `avoidTolls`/`avoidHighways` (`src/mcp/tools/find_places_along_route.ts:40`). If the active plan avoids tolls/highways, the POI corridor can be based on a different route, so a place reported as "on the way" may not be on the final constrained route. The final `compare_routes` route is authoritative, but the POI distance is measured against the baseline.
- **Buffer is always 0 for deadline-first.** `requiredBuffer = 0` (`src/agent/planner.ts:117`). This is internally consistent (depart exactly at the latest departure), but the demo script's 5-minute buffer and 5:48 departure do not match the implementation's 0-minute buffer and 5:53 departure for a 67-minute journey to 07:00.
- **Timezone resolution is prompt-only.** The system prompt supplies a UTC ISO current time plus the IANA timezone name (`src/agent/groq.ts:231`, `src/agent/prompts/routepilot.ts:18-20`). The model must convert local time and decide "today vs tomorrow." No deterministic parser or timezone-aware date construction exists. A model error here produces a 5.5-hour error for Asia/Kolkata.
- **Frontend formats timestamps in the browser's local timezone, not the plan timezone.** `TravelPlanCard` calls `new Date(iso).toLocaleTimeString(...)` (`frontend/src/components/TravelPlanCard.tsx:15-18`). If the browser is not in `DEFAULT_TIMEZONE`, the displayed leave/arrive times do not match the requested local time.
- **`current_time` is client-supplied and optional.** The tool accepts it and uses the server's `new Date()` when absent (`src/mcp/tools/compare_routes.ts:131-137`). The prompt does not instruct the model to pass it. A stale model-supplied value could bypass the current-time feasibility check.
- **Departure-first past departure is not rejected.** With `departure_time` in the past, the engine evaluates arrival relative to the deadline but does not compare the departure to current time. The prompt tells the model to roll it forward, but there is no deterministic guard.

---

## 7. Frontend and Map Status

### 7.1 Checklist

| Area | Status | Evidence |
|---|---|---|
| GeoJSON LineString validation | **PASS** | Type, ≥2 coordinates, numeric/finite, lon/lat ranges (`frontend/src/components/RouteMap.tsx:10-29`); unit test copies the same logic |
| Route source and layer lifecycle | **PASS** | Source created once; layer added if missing; `setData()` used for updates (`RouteMap.tsx:74-124`) |
| Route geometry updates | **PASS** | `source.setData(plan.routeGeometry)`; invalid/absent geometry clears the source to an empty FeatureCollection |
| Origin/destination/stop markers | **PASS** | Green origin, red destination, amber stops; old markers removed each update (`RouteMap.tsx:126-161`) |
| Map bounds and visibility | **PASS** | `fitBounds` on route coordinates, fallback to origin/destination; `maxZoom: 15` (`RouteMap.tsx:163-177`) |
| Map loading and cleanup | **PASS** | Waits for `isStyleLoaded()`; removes markers and map on unmount (`RouteMap.tsx:37-58`, `66-71`) |
| Plan card timing/constraint values | **PARTIAL** | Leave/arrive/travel/distance/driving/stop/buffer and badges render (`TravelPlanCard.tsx`); no date/timezone display; violated constraints are labeled "unavailable" |
| Markdown rendering and sanitization | **PASS** | `marked` + `DOMPurify.sanitize` before `dangerouslySetInnerHTML` (`MarkdownRenderer.tsx:16-35`) |
| Retry behavior | **PASS** | Failed message stored, retry replays exact text (`useRoutePilot.ts:19-20`, `61-78`) |
| Loading/error presentation | **PASS** | Loading pill, red error box with Retry (`App.tsx:172-177`, `222-237`) |
| Voice input/output fallback | **PASS** | Web Speech input; Groq TTS with browser speech fallback; mute state and stale-response guard (`useSpeech.ts:114-162`); unsupported input hides mic |
| Live map update polling | **PASS with side effects** | `/api/plan` polled every 1.5 s while loading (`useRoutePilot.ts:82-96`) |

### 7.2 Should it render a valid route and a real POI correctly?

**Code-level: yes.** The planner stores full Valhalla geometry; `RouteMap` validates it, sets the source, draws the line, and adds a marker for each `plan.stops` entry with a valid latitude/longitude. `TravelPlanCard` displays the stop and dwell when `stopDurationMinutes > 0`.

**Visual verification: not performed.** The existing Playwright suite could not launch because the Chromium binary is missing (§8). No screenshot or manual browser check was made, so this is **IMPLEMENTED / code-verified, not visually VERIFIED**.

### 7.3 Frontend issues

1. **Map re-fits on every poll — P2.** `/api/plan` returns a new object every 1.5 s; `setCurrentPlan` replaces state; the `RouteMap` effect depends on `plan` and reruns, removing/re-adding markers and calling `fitBounds` repeatedly. If the user pans or zooms during a long turn, the map snaps back. It also causes unnecessary work.
2. **Stale plan remains visible on failed turns — P1 (shared with backend).** `hasPlanContent` only replaces the plan when the response has content; a failed `compare_routes` returns the previous plan unchanged. The map/card can show an old route while the assistant reports a failure.
3. **`/api/plan` hides infeasible plans — P2.** The endpoint returns `null` unless `plan.distanceKm !== undefined` (`src/index.ts:58`). During an infeasible turn, polling cannot update the UI; the final chat response is required to show the warning state.
4. **Violated constraints are labeled "unavailable" — P2.** `TravelPlanCard.tsx:45` appends "unavailable" for any violated constraint, which is misleading (e.g., "avoid tolls unavailable" instead of "avoid tolls violated").
5. **No date or timezone on times — P2.** "Leave 05:53 AM" does not indicate which day or timezone. For a "tomorrow 7 AM" request this is ambiguous.
6. **Browser-local timezone — P1/P2.** See §6.4. On a machine outside Asia/Kolkata, the card can display times that contradict the requested local time.
7. **Polling and chat can race — P2.** The final chat response overwrites the polled plan; that is intended, but a failed chat leaves the last polled plan in place.
8. **Retry can duplicate a completed turn — P2.** If the 120-second client timeout fires after the server completed, Retry sends the same message again, potentially adding a duplicate stop or recomputing the turn. The session is not idempotent.

---

## 8. Automated Tests and Builds

### 8.1 Backend tests — `npm test`

- **Ran:** yes.
- **Exit status:** **1 (failure)**.
- **Counts:** tests 105, suites 15, pass 104, fail 1, cancelled 0, skipped 0, todo 0; duration ~2.9 s.

Failing test:

```
tests/providers/places/overpass.test.ts:104
two failed bounded attempts produce OverpassError with attempts=2
AssertionError: Expected values to be strictly equal: 3 !== 2
at tests/providers/places/overpass.test.ts:125
```

Cause: the test counts every `fetch` call. With the Nominatim fallback added in `953f5a0`, a 429/5xx sequence produces **two Overpass attempts plus one Nominatim attempt** = 3 fetches. The assertions on the `OverpassError` (`attempts === 2`, `status === 429`, `category === "rate_limited"`) pass; only the global `callCount === 2` assertion fails. This is a stale test, not an Overpass retry-policy regression, but the suite is still red.

### 8.2 Backend build — `npm run build`

- **Ran:** yes.
- **Exit status:** 0.
- **Output:** `tsc` completed with no errors.

### 8.3 Frontend build — `cd frontend && npm run build`

- **Ran:** yes.
- **Exit status:** 0.
- **Output:** `tsc -b && vite build`; 1,907 modules transformed; built in 657 ms.
- **Warning:** main JS chunk 1,369.90 kB (384.82 kB gzip), above Vite's 500 kB warning threshold. No build failure.

### 8.4 Frontend lint — `cd frontend && npm run lint`

- **Ran:** yes.
- **Exit status:** 0.
- **Output:** `oxlint` clean.

### 8.5 Playwright — `cd frontend && npx playwright test`

- **Ran:** yes, but **no test scenario executed**.
- **Exit status:** 1.
- **Result:** 6 failed, all with `browserType.launch: Executable doesn't exist at ...\ms-playwright\chromium_headless_shell-1243\chrome-headless-shell.exe`.
- **Environmental limitation:** Playwright and `@playwright/test` are installed, but Chromium is not. The command's failure is a missing-browser error, not an assertion failure. No visual or E2E behavior was verified.
- **To run later:** `npx playwright install chromium` (a large download), then re-run. No config change is required.

### 8.6 Live checks

| Check | Result |
|---|---|
| Groq API connectivity | **VERIFIED** — one minimal completion succeeded; model `openai/gpt-oss-120b`; 473 ms; `finish_reason:"length"` because the probe capped completion at 8 tokens |
| Live Valhalla + POI tool | **PARTIAL** — Valhalla succeeded; Overpass timed out after 10,008 ms; Nominatim fallback returned 5 real cafés; tool `isError:false`; 13,404 ms |
| Live Bedrock | **NOT RUN** |
| Live three-turn agent workflow | **NOT RUN** |

No tests were deleted, weakened, or added by this audit.

---

## 9. Live Three-Turn Workflow Results

**Important:** the three-turn workflow was **not executed live during this audit**. The only live evidence is the single POI tool check in §5.2 and the single Groq connectivity check in §8.6. The table below separates what the code/tests establish from what remains unverified.

### Turn 1 — "I need to reach Pune Airport by 7 AM tomorrow and avoid tolls."

| Question | Assessment |
|---|---|
| Request processed successfully | **UNVERIFIED live.** The path is implemented: prompt → geocode destination/origin → `compare_routes` with `arrival_deadline` + `avoid_tolls` → planner. |
| MCP tools actually executed | Expected: `geocode` (Pune Airport, optionally `DEFAULT_ORIGIN_QUERY`), `compare_routes`. No live log available. |
| Tool errors | Expected none; Valhalla is reachable (live route succeeded). Geocoding is **MOCK-TESTED**, not live-tested in this audit. |
| Final response produced | Implemented; **UNVERIFIED**. |
| Canonical `TravelPlan` updated | Implemented; planner tests 1 and 4 cover feasible/infeasible. |
| Geometry/distance/duration/departure/ETA/constraints correct | Deterministic when the model supplies the correct deadline. **Risk:** "7 AM tomorrow" requires the model to resolve the local date and offset; no deterministic parser. |
| Response agrees with plan | Prompt-guarded, not verified. |
| Key risk | If the demo runs close to 07:00 local time and the user says "by 7 AM" without "tomorrow," the engine can correctly mark the deadline infeasible (latest departure already passed). That is honest but may surprise a presenter expecting a feasible card. |

### Turn 2 — "Also find a coffee shop on the way, with a 15-minute stop."

| Question | Assessment |
|---|---|
| Request processed successfully | **PARTIAL LIVE EVIDENCE.** The actual `find_places_along_route` tool succeeded through the Nominatim fallback and returned 5 real cafés. The full agent turn (selection + second `compare_routes`) was not run live. |
| MCP tools actually executed | Live: Valhalla route + POI discovery inside `find_places_along_route`. Expected in the agent: `find_places_along_route`, then `compare_routes` with the stop as an intermediate location and `stops:[{durationMinutes:15}]`. |
| Tool errors | Overpass itself timed out; the fallback masked it as a successful result. The agent did not surface a provider error because the tool returned places. |
| Final response produced | **UNVERIFIED.** |
| Canonical plan updated | Implemented; planner test 2 and Groq test 22 cover a scripted stop flow. |
| Real stop found and retained | Real places **VERIFIED** via fallback. Retention depends on the model including `stops`; the planner clears `stops` if the model omits the array (§6.3). |
| Geometry/distance/duration/departure/ETA correct | Deterministic **if** the model includes the deadline and the stop array. **Risk:** the POI corridor is computed on an unconstrained baseline route, so the stop may not be on the final toll/highway-avoiding route. |
| Response agrees with plan | Prompt-guarded, not verified. |

### Turn 3 — "Avoid highways too."

| Question | Assessment |
|---|---|
| Request processed successfully | **UNVERIFIED live.** |
| MCP tools actually executed | Expected: `compare_routes` with both `avoid_tolls` and `avoid_highways`, the same origin/destination/stop waypoints, the deadline constraint, and the stop dwell. |
| Tool errors | Unknown; Valhalla live reachable, public endpoint load unknown. |
| Final response produced | **UNVERIFIED.** |
| Canonical plan updated | Planner test coverage exists for combined constraints, but not for the full multi-turn merge. |
| Geometry/distance/duration/departure/ETA/constraints correct | Correct **only if** the model resends all prior state. **Confirmed risk:** if it omits the deadline, the planner drops the deadline, departure, ETA, and buffer (scenario 1); if it omits `stops`, the stop marker and dwell are lost (scenario 2). |
| Real stop retained | Not guaranteed by code; prompt-only. |
| Response agrees with plan | Not guaranteed; no reconciliation. |

**Bottom line for §9:** no turn was demonstrated end-to-end live in this audit. The deterministic components are well unit-tested, and the POI provider path is live-proven via fallback, but the multi-turn agent behavior that the demo depends on is **MOCK-TESTED / IMPLEMENTED, not live-VERIFIED**.

---

## 10. Prioritized Findings

| Priority | Finding | Evidence / file reference | User-visible impact | Recommended action | Blocking demo? |
|---|---|---|---|---|---|
| **P0** | Canonical plan loses the deadline and/or stop when a follow-up `compare_routes` call omits them; continuity is prompt-only | `src/agent/planner.ts:38-53`, `100-127`; `src/agent/prompts/routepilot.ts:41-49`; planner scenario 1/2 confirmed | Turn 3 can silently drop the 07:00 deadline or the 15-minute stop; card shows no ETA/departure or no stop while chat may still mention them. Incorrect travel advice. | Merge prior hard constraints, deadline, departure mode, and stops into every `compare_routes` update unless the user explicitly removes them; add a removal/merge policy and tests. | **Yes** (core integrity) |
| **P1** | Failed `compare_routes` leaves stale route/metrics in the plan | `src/agent/groq.ts:406-408`; planner only clears on non-error `feasible:false` | After a failed recompute, the map/card can show an old route as if current; contradicts the assistant. | On tool error, mark the plan stale or clear metrics/geometry; surface a warning in the card. | **Yes** (trust/accuracy) |
| **P1** | Backend test suite is red; docs claim green | `tests/providers/places/overpass.test.ts:104-126`; `npm test` 104/105; `docs/HACKATHON_CHECKLIST.md:80` | Submission quality claim is false; CI would fail. | Update the call-count assertion to count only Overpass fetches or expect 3; re-run. | **Yes** for submission/CI claims |
| **P1** | Overpass live endpoint timed out; fallback masked it | Live check: `timeout`, 10,008 ms, attempt 1; Nominatim fallback count 5; `src/providers/places/overpass.ts:78-101` | POI discovery works only because of the fallback; Overpass-centric claims are not currently live-verified. Turn latency ~13 s for POI alone. | Document the fallback; monitor endpoint health; consider a longer timeout or alternate Overpass instance; keep fallback. | No (fallback works), but demo risk |
| **P1** | POI corridor uses an unconstrained baseline route | `src/mcp/tools/find_places_along_route.ts:40` (no `avoidTolls`/`avoidHighways`) | A café reported "on the way" may not lie on the final toll/highway-avoiding route. | Pass active avoid flags to the corridor route, or revalidate the selected stop against the final route geometry. | No, but correctness |
| **P1** | No server-side validation that a stop is a real returned POI | Planner trusts `input.stops` (`src/agent/planner.ts:49-53`); prompt only (`routepilot.ts:41-56`) | The "never invent places" guarantee is model-enforced, not deterministic. | Carry POI IDs/provenance from `find_places_along_route`; validate stop name/coords against that result before accepting. | No, but core claim |
| **P1** | Timezone/deadline rollover is prompt-only; frontend formats in browser timezone | `src/agent/groq.ts:231`; `src/agent/prompts/routepilot.ts:18-20`, `32-37`; `TravelPlanCard.tsx:15-18` | A model timezone error creates a 5.5-hour mistake; a browser outside IST displays wrong times. | Add deterministic timezone-aware date parsing/local-time context; format card times in `DEFAULT_TIMEZONE`. | Environment-dependent |
| **P1** | Bedrock path lacks compaction, bounded history, finalization, and has partial-session persistence on error | `src/agent/client.ts:51-54`, `88-89`, `113-137`, `152`; no `compactToolResult` | Context grows with full geometry; degraded/costly turns; an error mid-turn leaves dangling user/tool messages for the next turn. | Align Bedrock with Groq's bounded working context/finalization; mutate a local copy until success. | Only if Bedrock is demoed |
| **P1** | Playwright E2E could not run; no visual verification | `npx playwright test` → 6 launch failures, Chromium missing | The map/plan/stop rendering claims are code-level, not visually verified. | Run `npx playwright install chromium` and the suite in a prepared environment; record results. | Verification gap |
| **P2** | Demo script timing/buffer does not match code | `docs/DEMO_SCRIPT.md:44-53` says 5-min buffer/5:48; planner uses 0/5:53 | Presenter narration contradicts the card. | Rehearse live and update the script with actual computed values. | No, but demo credibility |
| **P2** | `/api/plan` hides infeasible plans | `src/index.ts:58` requires `distanceKm` | Live polling cannot show the infeasible state until the chat response arrives. | Return the plan when it has origin/destination/warnings, not only distance. | No |
| **P2** | Map re-fits and rebuilds markers on every 1.5 s poll | `useRoutePilot.ts:82-96`; `RouteMap.tsx:61-181` | Map snaps back if the user pans during planning; unnecessary work. | Compare plan identity/geometry before updating; only fit bounds when the route changes. | No |
| **P2** | Violated constraints labeled "unavailable" | `TravelPlanCard.tsx:45` | Misleading badge text. | Use "violated" for `violated`; reserve "unavailable" for `not_evaluable`. | No |
| **P2** | Near-duplicate POIs returned | Live POI result: Vohuman Cafe/Café, Durga cafe/Cafe | Wasted slots; model may pick a duplicate. | Deduplicate by normalized name + proximity. | No |
| **P2** | `GROQ_MAX_COMPLETION_TOKENS` / `MAX_TOOL_ROUNDS` not validated | `src/agent/groq.ts:215`, `248` | Invalid env values become `NaN`; behavior degrades silently. | Validate positive integers at startup with clear errors. | No |
| **P2** | TTS endpoint has no request-body size cap | `src/api/tts.ts:28-41` | Local memory/DoS risk; text is sliced to 4000 only after parsing. | Cap body size like `/api/chat` (100 kB). | No |
| **P2** | Stale docs: test counts, provider, TTS, fallback, frontend components | `README.md:195`; `docs/TECH_SPEC.md:56`; `docs/HACKATHON_CHECKLIST.md:80`; `docs/DEMO_SCRIPT.md` | Reviewers see false claims. | Update docs after the milestone; make counts generated or accurate. | No, but submission quality |
| **P2** | Weak/misleading tests: structured-place test lacks assertions; geometry test duplicates component logic | `tests/mcp/find_places.test.ts:15-55`; `tests/domain/route_geometry.test.ts:4-24` | Passing tests overstate coverage. | Assert returned place count/name; import/share the validator or test the component behavior. | No |
| **P2** | Bundle size warning | `frontend` build: 1,369.90 kB JS | Slower cold load; warning only. | Code-split MapLibre/route map if load time matters. | No |
| **P2** | No auth/rate limiting on `/mcp`, `/api/plan`, `/api/tts`; in-memory sessions | `src/index.ts:24-71`; `src/agent/session.ts` | Acceptable for a local demo; unsafe if deployed. | Add auth/session isolation before any public deployment. | No (localhost demo) |

---

## 11. Recommended Next Milestone

### Deterministic Plan Continuity and Failure-State Integrity

**Objective:** Make the canonical `TravelPlan` — not the LLM — the authoritative carrier of the user's active hard constraints, deadline, departure mode, and selected stops across turns. Guarantee that a follow-up route recalculation cannot silently discard them, and that a failed recalculation cannot leave stale metrics presented as current.

**Why this is the priority:** It is the only finding that directly produces incorrect travel advice in the exact three-turn demo. It was confirmed by executing the real planner, not inferred from a commit message. Every other P1 is either environmental (Overpass), verification-oriented (Playwright), or limited to the non-default Bedrock path. Fixing continuity protects the product's core claim: deterministic constraint handling outside the LLM.

**Scope:**

1. Add a deterministic merge layer before/inside `updateTravelPlanFromCompareRoutes`:
   - Carry forward prior hard constraints and `arrival_deadline` when the new tool input omits them.
   - Carry forward the existing `stops` and dwell time when the new input omits `stops`, but only if the corresponding waypoint is still present in `locations`.
   - Define and implement explicit removal semantics (e.g., a user request to remove a stop or drop a constraint) so carry-forward does not become "cannot ever change the plan."
   - Keep `departure_time` vs deadline-first mode consistent with the carried-forward deadline.
2. Validate stop provenance:
   - Record the most recent `find_places_along_route` result per session.
   - Accept a `stops` entry only if it matches a returned POI within a small coordinate tolerance (or is an explicit user-supplied waypoint with a clear provenance flag).
   - Reject or strip invented stops before they reach the canonical plan.
3. Failure-state handling:
   - When `compare_routes` returns `isError` or throws, mark the plan `stale: true` (or equivalent) and add a warning; do not silently return old metrics as current.
   - Update the frontend card to render the stale state distinctly; do not fit bounds or present the old route as newly computed.
4. Make the POI corridor consistent with the active plan:
   - Pass active `avoidTolls`/`avoidHighways` (or the active constraints) into the baseline route used by `find_places_along_route`, or revalidate the chosen stop against the final constrained route geometry.
5. Tests:
   - Planner matrix for constraints × stops × departure/deadline presence.
   - Failed-tool stale-state test.
   - Provenance rejection test.
   - Update the stale Overpass call-count assertion so the suite is green.
6. Documentation:
   - Update the demo script's buffer/departure numbers and the test counts only after the implementation and tests are final.

**Explicit non-goals:**

- No new LLM provider, routing provider, or POI category.
- No Bedrock parity work (can follow in a separate milestone).
- No UI redesign, new map features, or voice changes.
- No live traffic integration.
- No authentication/rate-limiting work for the local demo.
- No new feature work until the three-turn flow is deterministic and the suite is green.

**Acceptance criteria:**

- A follow-up `compare_routes` call that omits `arrival_deadline` still produces a plan with the prior `arrivalDeadline`, `departureTime`, `actualEta`, and `bufferMinutes` (or an explicit infeasible warning that explains the removal).
- A follow-up call that omits `stops` but retains the stop waypoint still preserves the stop and its dwell time; a call that explicitly removes the stop clears it.
- A stop that was not returned by `find_places_along_route` (and is not an explicit user waypoint) is rejected before it reaches `TravelPlan`.
- A failed `compare_routes` marks the plan stale and the UI does not present the old route as newly computed.
- The selected stop's distance is measured against the final constrained route, not only the unconstrained baseline.
- `npm test` is green (105+ tests), `npm run build` and `frontend npm run build`/`lint` pass.
- A scripted three-turn integration test asserts: deadline retained, stop retained, both constraint badges present, total duration includes 15 minutes, and departure/ETA agree with the deadline.
- One bounded live three-turn run (Groq) completes without a plan/text contradiction; Playwright Scenario C/D/I passes after Chromium is installed.

**Test plan:**

1. **Unit:** planner merge matrix; constraint carry-forward; stop carry-forward/removal; stale flag on error; provenance validation.
2. **Integration:** mock MCP tools and a scripted LLM for turns 1-3, including a deliberately incomplete turn 3 tool call; assert canonical plan invariants.
3. **Provider:** keep the Overpass retry/fallback tests; fix the call-count assertion; add a test that the POI route request carries active avoid flags.
4. **Live:** one bounded three-turn run against Groq and the configured geospatial services; capture tool calls, plan JSON, and assistant text; verify agreement.
5. **Frontend:** install Chromium; run Scenario C/D/I and assert the stop marker, 15-minute dwell, deadline, and both constraints survive turn 3.
6. **Regression:** full backend suite, backend build, frontend build/lint, and a manual demo rehearsal with the corrected script.

---

## 12. Known Limitations and Unverified Claims

- **No live three-turn workflow was executed.** Section 9 is an implementation/test assessment, not a record of a successful demo. Do not cite it as a live success.
- **No live Bedrock call was made.** Bedrock is implemented and mock-tested only. Presence of AWS keys in `.env` does not establish working model access, region/model availability, or quota.
- **Groq was live-tested for connectivity only.** One minimal completion succeeded. The full Groq tool loop was exercised with mocks, not against the live API.
- **Overpass did not respond during the audit.** The live POI success came from the Nominatim fallback. The Overpass query itself may be valid; it timed out before returning. Do not claim Overpass is healthy.
- **No visual/browser verification was performed.** Playwright could not launch because Chromium is not installed. The map/route/POI rendering is code-verified only.
- **No prior server logs were available.** All claims about previous live runs are excluded; only this audit's executions and the repository's tests/code are used.
- **`.env` values were not read or reproduced.** Only key presence and non-emptiness were checked. No credentials are in this report.
- **The test suite is not green at HEAD.** The failing assertion is stale relative to the new POI fallback, but it is still a failure.
- **Documentation contains stale claims.** Test counts (60/72 vs 105), provider emphasis (Bedrock vs current Groq), buffer math (5 vs 0), TTS mechanism, and the Overpass-only POI description do not match the code.
- **The audit did not modify application code, tests, or configuration.** This report is the only new file and remains uncommitted.
- **Environment-dependent behavior remains unverified:** judge machine timezone, internet access to OpenFreeMap tiles, public Valhalla load, Nominatim rate limits, and Groq quota/terms acceptance for Orpheus TTS.

---

*End of report.*
