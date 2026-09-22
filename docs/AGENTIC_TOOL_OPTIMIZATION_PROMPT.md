# Prompt: Deep-dive and optimize a tool for agentic harness use

Copy everything below the line, prefix it with the project and tool, e.g.:
> "Do this in tools-service for the `control_browser` tool: ..."

---

Investigate this tool end to end — its definition, its implementation, and its real production usage — then plan and implement improvements so LLM agents of every intelligence tier (small local models through frontier models) can use it at its best. Do not stop at the investigation: implement the fixes and pin them with tests. Reference precedent: the `generate_audio` overhaul (tracker-only workflow, duration coercion, honest progress) in tools-service — read `git log` for those commits if helpful.

## Phase 1 — Understand the tool as built

Locate all of it: the tool definition (parameter schema + `translate()` description keys), the locale files (`src/locales/en/tools.json` AND `src/locales/caveman/tools.json`), the route handler behind its endpoint, and every service file the handler calls. Read the full request path: param extraction, validation, defaults, state/session management, and response construction.

Hunt specifically for these classes of defect — they are the ones that hurt agents most and never show up as errors:

1. **Silent coercion holes.** Any place user input is passed to `Number()`, `Math.round()`, `parseInt`, `parseFloat`, or used in arithmetic without validating type/range first. Trace what happens when a model sends a string where a number is expected, a beat-fraction/percentage/human-ish value ("1/4", "50%", "fast"), null, or a negative. NaN flowing through `Math.min/max` clamps is a classic: the input silently becomes a degenerate value and the tool "succeeds" with wrong output.
2. **Advertised-but-inert parameters.** For every schema parameter, confirm the implementation actually consumes it — grep where it lands. Watch for config fields set on an object the downstream renderer/engine never reads (e.g. a preset applied only in a code path this workflow never hits).
3. **Fallback defaults that mask errors.** A parse failure that returns a default (440 Hz, index 0, empty string) instead of erroring means a model's mistake produces confidently wrong output. Every fallback should be justified or converted into a clear error.
4. **Responses that mislead the model.** Progress/status numbers derived from post-processed output rather than authored input (inflation), missing state echo (does every response repeat sessionId/handle/ids the model must pass back?), success messages that claim more than what happened.
5. **Enum/name validation gaps.** Names accepted without checking against the real registry (instrument/voice/preset/selector names) — models invent plausible values constantly; check what happens when they do.
6. **Multi-call workflow friction.** Count the minimum round trips for the common use case. Each call is a full LLM round trip with full context. Look for call pairs that could be optionally fused (create+configure, add+write) without losing incremental-preview UX.
7. **Schema token cost.** Estimate serialized schema size (description + all param descriptions + structural overhead, chars/4). Note which portions serve rarely-used modes — the schema is a prompt paid in every conversation where the tool is enabled.
8. **Stateful session hygiene.** TTLs, in-memory vs persistent state (restart/multi-replica breaks in-memory sessions), cross-conversation/user scoping, cleanup.

Also check `ToolSchemaService` complexity scoring / `intelligenceTier` — note the tool's tier before and after your changes.

## Phase 2 — Mine real production usage

The agentic harness (prism-service) persists conversations in MongoDB. Environment facts as of 2026-07 — verify each, they may drift:

- Mongo URI is in `/home/rodrigo/development/vault-service/projects.json` at `config.MONGO_URI` (nested under the top-level `config` key — `require(...).MONGO_URI` is undefined, and passing the resulting literal string "undefined" to mongosh silently connects to an empty localhost instance); `mongosh` is installed.
- Database `prism`, collection `agent_conversations` (~15k docs).
- `createdAt` is an **ISO string, not a Date** — filter with string comparison (`{createdAt: {$gte: "2026-07-06"}}`).
- Tool calls live on assistant messages: `messages[].toolCalls[]` with `.name`, `.args`, `.id`.
- **Recent** tool results are NOT on `toolCalls[].result` (it's null) — they are separate `role: "tool"` messages matched by `tool_call_id` (or `toolCallId`). Older docs have inline `.result`. Handle both.
- Large payloads (audio/images) in stored results are already replaced with `minio://` refs; strip refs before printing.
- Write analysis scripts to the scratchpad and run with `mongosh --quiet --file`; never dump raw documents (they can be huge).

Focus on a recent window (past 1–2 weeks); widen only if the tool is rarely used. Aggregate:

- Calls and error rates by action/mode and by model (small local models reveal ergonomic problems frontier models paper over).
- Error messages, grouped and counted — each distinct message is a candidate for a better self-describing version.
- Parameters models actually send vs the schema surface (unused surface = removal candidates), and parameters models **invent** — hallucinated or legacy params are a signal of what the intuitive interface shape is; consider accepting them.
- Calls per conversation (round-trip cost) and how many multi-step workflows reach completion vs stall.
- **User follow-up messages after tool use — the highest-signal data there is.** Complaints ("it's only 4 seconds", "that's not what I asked for", "keep going") point directly at the defects that matter.

Then walk 2–3 complete conversations end to end (calls + results + user reactions), comparing what the model *believed* from tool responses vs what actually happened. For every suspected root cause, **confirm it in the code** (reproduce the math, run a snippet if needed). Never ship a fix for a guessed cause.

## Phase 3 — Plan the improvements

Rank findings and state evidence for each (call counts, conversation IDs, code line references):

- **P0 — correctness:** anything producing silently wrong output.
- **P1 — agent ergonomics:** errors that don't teach recovery, missing state echo, misleading progress, excessive round trips.
- **P2 — token cost:** schema surface unused or confusing in practice; consider splitting expert modes out or removing them if the engine capability can stay internal.
- **P3 — robustness:** session/tenancy/restart concerns; note-only is acceptable.

Design principles:

- **Accept what models keep sending; never silently mangle.** If models repeatedly pass an intuitive format, coerce it correctly. If input is uninterpretable, return a specific error with valid examples — never a default.
- **Every stateful response echoes its state keys** (sessionId, handles, current step) — weak models lose context and interruptions strip it.
- **Errors must teach recovery:** what was wrong, what's valid, which action to call next. Reject literal `"null"`/`"undefined"` strings for id params with pointed guidance.
- **Progress numbers reflect authored reality**, not derived/inflated output. Tell the model exactly how much more it needs to do, in its own units.
- **Exact semantics beat "at least" semantics** for user-facing quantities (duration, count, size). Users say "10 seconds" and mean it.
- **Fewer round trips where it doesn't hurt UX:** optional inline params that fuse common call pairs; keep step-by-step available.
- **Prefer narrowing the route/schema surface over deleting engine code** — internal capability is cheap to keep and reversible.

If the plan includes removing a whole capability or user-visible mode, state the usage evidence and proceed if the data is unambiguous (e.g. zero legitimate uses in the window); ask only if genuinely ambiguous.

## Phase 4 — Implement and verify

- Update the route, services, tool schema, and **both** locale files. The locale JSON is grouped by tool, **not** globally sorted — preserve key order; insert new keys adjacent to their group (script it; don't hand-edit 1,500-key files, and don't rewrite with `sort_keys`).
- Cross-check `translate()` references vs locale keys **both directions** after schema edits: no dangling refs, no newly-orphaned keys (clean up pre-existing orphans for this tool while there).
- If tests compare `src/locales` to `dist/locales`, sync the dist copies (`build` does `cp -r`, but the parity test reads dist directly).
- Tests:
  - Rewrite tests that pin deliberately-changed behavior — call out that the change is intentional, don't contort the fix to keep old tests green.
  - Add a unit test for **each fixed bug that reproduces the production failure pattern** (the exact bad input real models sent).
  - Add endpoint tests for the full happy-path workflow plus each new validation error.
- Verify: `npx tsc --noEmit` clean and `npx vitest run` fully green (run the complete suite, not just touched files — schema changes ripple into complexity-scoring and locale-parity tests). `npm run lint` (oxlint) must be clean too.
- Do **not** commit unless asked. Note in the summary that the service needs a redeploy before agents see the new schema.

## Report

End with: root causes found (each backed by real-conversation evidence and code references), what changed and why, schema token delta, verification results, and anything deliberately not done (with reasoning). Lead with the outcome, not the process.
