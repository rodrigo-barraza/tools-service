# Tools-Service Improvement Plan

_Compiled 2026-07-13 from a four-track deep audit (schema layer, execution layer, file/search layer, orchestration layer). Every item is designed to be non-breaking: additive fields, opt-in flags, or behavior-preserving fixes. Items marked 🐛 are outright bugs. "CC:" notes the Claude Code harness pattern that inspired the item._

> **Status (2026-07-13): Phases 1 and 2 are implemented.** All of 1.1–1.8 and 2.1–2.5 landed; verified via typecheck + full Vitest suite (1803 tests) + subprocess smoke tests. Implementation notes/deviations:
> - 1.2: warn-only at boot (`validateToolRegistries()` in ToolSchemaService) + hard assertions in `src/services/__tests__/RegistryIntegrity.test.ts` (also checks locale key resolution for `en` and `caveman`).
> - 1.8: rolled out as loud warning by default; set `AGENT_WS_REQUIRE_SECRET=true` to fail closed once a secret is configured (fully failing closed by default would break agents with no secret baked).
> - 2.2: log-only threshold (`AGENTIC_RESULT_SIZE_WARN_BYTES`, 200KB) — enforcement deliberately deferred until telemetry shows offenders.
> - 2.4: handler backstop `AGENTIC_HANDLER_TIMEOUT_MS` (150s, returns 504 with `code: "TIMEOUT"`), plus `server.requestTimeout`/`headersTimeout`.
> - 2.5: allowlist is ON by default (see `AGENTIC_COMMAND_ENV_ALLOWED_NAMES/_PREFIXES`); escape hatch `AGENTIC_COMMAND_INHERIT_FULL_ENV=true`. Also applied to the Python interpreter.
> - 2.3: trace headers propagate to Prism proxy fetches (PrismService, scheduler, memory/custom-agent routes); WS RPC propagation deferred — the workspace-agent binary's RPC parser tolerance is unverified.
> Phase 3+ remains open. Prism-side note: the new `get_background_output`/`list_background_processes`/`kill_process` tools appear in schemas automatically; agents' `enabledTools` allowlists may need updating to use them.

---

## Guiding principles (borrowed from the Claude Code harness)

1. **The tool result is the product.** Everything a tool returns is context the model must pay for and reason over. Truncate predictably, prefer the tail of logs, always say *that* and *how much* you truncated.
2. **Errors are prompts.** A failed tool call should tell the model what to do next ("file has 12,400 lines, pass startLine/endLine"), never an opaque `"Internal agentic tool error"`.
3. **Safety through verified state, not trust.** Edits should require a prior read of the same content (read-before-edit + staleness check), not assume the model remembers correctly.
4. **One registry, validated at boot.** Metadata keyed by tool name in N separate maps *will* drift (it already has — see 1.1).

---

## Phase 1 — Bug fixes & zero-risk quick wins

### 1.1 🐛 Fix dead API-key gating for finance tools
`TOOL_REQUIRED_KEYS` (`ToolSchemaService.ts:909-1022`) gates tools by names that no longer exist (`get_stock_quote`, `get_macro_indicators`, etc.). The real tools `get_stock` / `get_macro` (`FinanceTools.ts`) are never gated, so they're advertised even without `FINNHUB_API_KEY`/`FRED_API_KEY` and fail at call time.
- Update the map to the current names.
- Add a **boot-time validation** (see 1.2) so this class of bug can't recur.

### 1.2 Boot-time registry validation
`TOOL_DOMAINS` (`ToolSchemaService.ts:121-507`), `TOOL_EMOJIS` (:580-892), `TOOL_REQUIRED_KEYS`, and `TOOL_REQUIRED_DATA_FILES` are all keyed by tool name with no check that keys correspond to real definitions.
- At startup (or in a Vitest test), assert every key in each map exists in `TOOL_DEFINITIONS`, and every tool has a domain + emoji. Log/throw in dev, warn in prod.
- Same for locale keys: bidirectional orphan/dangling check between `tool-definitions/*.ts` translate keys and `locales/en/tools.json` + `locales/caveman/tools.json` (the optimization prompt doc says this has bitten before).

### 1.3 Expose background-process tools to the LLM
The endpoints already exist (`GET /agentic/command/background/:pid`, `/background/list`, `POST /agentic/command/kill` — `AgenticRoutes.ts:628-657`) but **no tool definitions reference them**. The model can start a background process (`run_in_background`) and receives a `pid` it cannot act on.
- Add `get_background_output`, `list_background_processes`, `kill_process` tool definitions in `CoreWorkspaceTools.ts`.
- CC: `BashOutput` / `KillShell` companion tools to `run_in_background`.

### 1.4 Tail-preferred output truncation for shell/command/interpreters
All four executors (`ShellExecutorService.ts:221-226`, `AgenticCommandService.ts`, both interpreters) keep the **first** 512KB and drop the rest — for build/test logs the errors at the end are exactly what gets lost.
- Switch to head+tail retention (e.g. first 10% + last 90% of budget) with a marker like `... [truncated 1.2MB, 8,340 lines omitted] ...` including byte/line counts.
- Fix the off-by-one-chunk overshoot while there (`length < MAX` checked before append).
- CC: Bash results keep the tail; truncation notices state counts.

### 1.5 Process-group kill on foreground timeout/abort
Foreground timeout/abort in `AgenticCommandService.ts:232,427` calls `child.kill()` only — grandchildren (`npm`→`node`, dev servers) survive as orphans. `killProcessTree` (:516) already does group kill but is only used by the registry path.
- Spawn with `detached: true` and signal `-pid` (SIGTERM → 3s grace → SIGKILL) on the foreground path too.

### 1.6 `realpath` in `validatePath`
`AgenticFileService.ts:199-217` uses `path.resolve` + `startsWith(root)`; a symlink inside an allowed root can point outside and pass. Resolve with `fs.realpathSync` (falling back gracefully for not-yet-existing write targets: realpath the parent dir).

### 1.7 Cache `intelligenceTier`/`complexityScore`
Recomputed for ~274 tools on every `/admin/tool-schemas*` request (`ToolSchemaService.ts:1351,1377`). Compute once alongside the per-locale definition cache.

### 1.8 Fail closed on missing WS agent secret
`resolveAgentSecret` returning undefined currently disables auth on the workspace-agent WebSocket upgrade (`AgentConnectionManager.ts:195-232`). Refuse upgrades when no secret is configured (or auto-generate one at first boot and store it in Mongo).

---

## Phase 2 — Contract quality: errors, sizes, tracing

### 2.1 Stop swallowing errors in `agenticHandler`
`utilities.ts:266-269` replaces any thrown error with static `{ error: "Internal agentic tool error" }` — the model gets zero signal (RPC timeouts, agent disconnects, parse failures all look identical).
- Return the sanitized `error.message` (no stack) and keep logging server-side.
- Add an optional taxonomy, additively: `{ error: string, code?: "TIMEOUT" | "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "AGENT_DISCONNECTED" | "INTERNAL", retryable?: boolean }`. Existing consumers reading only `error` are unaffected.
- CC: errors are actionable prompts; a denied/failed call should steer the next attempt.

### 2.2 Central tool-result size governance
There is **no cap on outbound result size** to the LLM (`server.ts` only caps *input* at 50mb); per-fetcher truncation is ad-hoc (Reddit, PyPI, patents each roll their own).
- Add a response-boundary middleware (or a wrapper in `agenticHandler` + `fieldProjectionMiddleware` sibling) that measures serialized size and, above a configurable cap (start generous, e.g. 200KB), truncates arrays/strings with a uniform envelope: `{ ...result, _truncated: true, _originalBytes, _hint: "narrow with fields=/limit=" }`.
- Roll out log-only first (record offenders in `tool_calls` telemetry), then enforce. The Prism cost data (requests collection) can tell you which tools blow context today.
- CC: all tool results pass through a single truncation gate with an explicit marker.

### 2.3 Propagate trace headers across hops
`x-request-id`/`x-conversation-id`/`x-iteration` are logged to Mongo but **not forwarded** to Prism proxy calls or WS RPC (`HeaderPropagationMiddleware.ts`, `AgentConnectionManager.ts:629-681`), so traces break at every hop.
- Thread them through `PrismService` fetches and as a field in the JSON-RPC params. Include the request id in error responses so a bad tool call can be correlated from the Prism side.

### 2.4 Per-tool timeout budget + server request timeout
Command/RPC paths have timeouts, but local file/grep/git/LSP/PDF-parse calls have none — a slow op hangs the request indefinitely.
- Set `server.requestTimeout` / `headersTimeout` on the HTTP server, and wrap `agenticHandler` service calls in a default `Promise.race` timeout (e.g. 60s) returning a structured `TIMEOUT` error (see 2.1).

### 2.5 Environment hygiene for spawned commands
`execute_command` inherits full `process.env` — every secret in the service's environment is handed to arbitrary commands (`AgenticCommandService.ts:156-161`).
- Build the child env from an allowlist (PATH, HOME, LANG, TERM, CI, language toolchain vars) plus explicitly configured passthroughs. Opt-out flag for compatibility during rollout.

---

## Phase 3 — Harness alignment (the Claude Code-shaped changes)

### 3.1 Read-before-edit + staleness detection
No edit path requires a prior read, and `agenticWriteFile` silently overwrites (`AgenticFileService.ts:354-402`). You already have the session key to fix this: `x-agent-session-id`.
- Keep a per-session in-memory map `{ sessionId → { filePath → { mtimeMs, hash } } }` recorded on every successful `agenticReadFile`.
- On `write`/`string_replace`/`block_replace`/`multi_replace`: if the file exists and was never read this session → error `"Read the file before editing it"`; if read but mtime/hash changed since → error `"File changed since your last read (was X, now Y) — re-read it"`.
- Roll out in three steps: (1) log-only, mine `tool_calls` for how often it would fire; (2) warning field in the result; (3) enforce, with a per-agent config escape hatch.
- CC: Edit/Write refuse without a prior Read in the conversation; this is the single highest-leverage correctness guard in the harness.

### 3.2 Consolidate the four edit primitives
`string_replace`, `patch_file`, `block_replace`, `multi_replace` push edit-strategy choice onto the model and quadruple schema surface.
- Make **`string_replace` the canonical edit**: enforce uniqueness by default, rename `allowMultiple` → `replaceAll` semantics (keep the old param as an alias), and improve the multi-match error to include the match locations so the model can add context.
- Hide `patch_file` and `block_replace` from `getToolSchemasForAI` (keep the HTTP endpoints — nothing breaks; MCP/admin can still see them). Keep `multi_replace` for batch edits (CC's MultiEdit analog).
- CC: one Edit tool, exact-string, unique-match-or-fail, `replace_all` opt-in.

### 3.3 Read/grep/glob ergonomics
- **Read**: pad line numbers (`cat -n` style, right-aligned + tab) — models are heavily trained on this format. For >1MB files, return the first 800-line window with a note instead of hard-rejecting (`AgenticFileService.ts:258-349`).
- **Grep** (`:741`): add `-A/-B/-C` context params, a `count` mode, real glob support in `includes` (reuse `globToRegex`), raise the 50-result cap for files-with-matches mode, and honor `.gitignore` (currently only `node_modules`/`.git` are skipped). Consider shelling out to ripgrep when available — it's likely already on the box — with the JS walker as fallback.
- **Glob** (`:901`): sort by mtime (newest first) like CC's Glob; add `{a,b}` brace expansion.

### 3.4 Server-side deferred tool loading
Today `getToolSchemasForAI` always serves all ~274 schemas; deferral lives entirely in the Prism harness via `x-enabled-tools`, and `search_tools` merely annotates `isEnabled`.
- Add a `?tools=` / `?mode=deferred` variant: return full schemas for an agent's enabled set and **name+description-only stubs** for the rest, plus a `get_tool_schemas`-style fetch (or extend `search_tools` to return full schemas for its hits, which it can already do server-side).
- This shrinks the system-prompt token bill on the Prism side without any Prism changes beyond opting into the query param.
- CC: deferred tools are listed by name only; ToolSearch returns callable schemas on demand.

### 3.5 Enforce `x-enabled-tools` at execution (opt-in)
Currently an agent's allowlist is a telemetry hint; any caller can POST `/agentic/command/run` regardless (`AgenticRoutes.ts:1452-1461`). Add an optional enforcement mode (per-agent config flag): resolve tool name from the route (the `ToolCallLoggerMiddleware` path-map already does this) and 403 with a structured error when the tool isn't enabled.

### 3.6 Auth on the tool surface
**Done 2026-10-06** (`prism-login-guard`, with Prism's login): every route that runs code or commands, touches workspaces or files, changes configuration, or acts on the owner's accounts, devices or money — `/mcp` included — answers only `x-api-secret: TOOLS_SERVICE_API_SECRET`, and refuses everyone while it is unset (`GATED_ROUTES` in `src/middleware/ToolsSecretMiddleware.ts`; README "Authentication"). Read-only data stays open: other fleet apps read it, and browsers and Discord load the embeds. Still open:
- CORS reflects any origin with credentials (`server.ts`). Harmless to the gated routes, which a browser cannot hold the secret for; tighten it to the known origins if browsers ever call this service directly again.

### 3.7 MCP consumer coherence
`search_tools`' description tells the model to call `enable_tools`, which doesn't exist for MCP consumers (LM Studio) — an instruction they can't fulfill. Either strip/replace that sentence when serving via `McpAdapter`, or implement session-scoped enablement in the adapter. Also lift the hardcoded `sun-tools`/`1.0.0` server identity into config.

---

## Phase 4 — Bigger bets (worth a design doc each)

### 4.1 Real interpreter sandboxing
`node:vm` is not a security boundary (privileged tier is full host access *by design*; sandboxed tier is escapable; vm timeout doesn't cover async). Python's socket-block is bypassable and env/filesystem are unconfined. If untrusted/semi-trusted code matters: move both interpreters into short-lived containers or `isolated-vm`/WASM (JS) and nsjail/bubblewrap (Python). If the Docker host boundary is deemed sufficient, document that explicitly in the tool descriptions instead.

### 4.2 Background-exit notification
The registry only supports polling (`BackgroundProcessRegistry.ts:110-125`). CC's harness re-invokes the agent when a background task exits. Cheapest Prism-compatible version: have the loop include a one-line background-status digest (from `/background/list`) in the system reminder each iteration; fancier version: WS push from tools-service to prism-service on `close`.

### 4.3 Idempotency keys for side-effectful tools
Retried `file/write`, `command/run`, task-create re-execute today. Accept an `Idempotency-Key` header (Prism sends `x-request-id` + iteration already — could derive one), cache result for a short TTL.

### 4.4 Tool/catalog versioning
Add optional `version`, `deprecated`, `replacedBy` fields to `ToolDefinition` (`types/tools.ts:88`), surface them in schemas, and have `search_tools` de-rank deprecated tools. Enables safe renames (the Phase 1.1 bug was a rename with no deprecation path).

### 4.5 Single tool registry
Longer-term refactor of 1.2: collocate `domain`, `emoji`, `requiredKeys`, `requiredDataFiles`, `display` on the `ToolDefinition` itself (additive fields; keep the old maps as generated views during migration). One new tool = one file edit + locale strings.

### 4.6 Replace hand-rolled htmlToMarkdown
`AgenticWebService.ts:717-883` flattens nested lists/inline formatting inside `li`/headings. Swap in Readability + Turndown (or keep the cheerio walker as fallback) and add a short-TTL fetch cache (CC: WebFetch has a 15-min cache).

---

## Suggested sequencing

| Order | Items | Effort | Risk |
|---|---|---|---|
| Week 1 | 1.1–1.8 (bugs + quick wins) | Small, mostly local | ~zero |
| Week 2 | 2.1–2.5 (contract quality) | Medium | Low (additive fields, log-first rollouts) |
| Week 3–4 | 3.1–3.3 (edit safety + ergonomics), then 3.4–3.7 | Medium-large | Low-medium (staged: log → warn → enforce) |
| Later | 4.x | Large | Design-doc first |

**Verification strategy for every phase:** the existing `AgenticToolTestService` smoke harness + `tool_calls` Mongo telemetry are the safety net — run `testAllTools` before/after, and for behavior-gated changes (3.1, 2.2, 3.5) ship in log-only mode and mine telemetry for a few days before enforcing. The `AGENTIC_TOOL_OPTIMIZATION_PROMPT.md` workflow (mining `agent_conversations` for real usage) applies directly to validating 3.2's schema hiding and 3.4's deferred set.
