# Execution engine capabilities

An execution engine is the layer that runs the model-and-tool loop and keeps the model's own context:
PI today, Codex next, Claude Code possibly later. This table is how a new engine is written, reviewed and
accepted. The interface it implements is `contract.ts` beside this file; the runtime's own event
contract for hosts is `packages/contracts/agent-runtime.md` and stays unchanged for them.

Read this table with `contract.ts` open. Every row names what the plugin must do, and what the runtime
does so the plugin does not have to.

## How a plugin fills the table

1. Copy this file into `adapters/<engine>/CAPABILITIES.md`, keep the row ids and order, and fill the state
   column for that engine: `supported`, `limited` (with the restriction in one sentence), `unsupported`
   (with the reason), or `unverified` (with what would settle it).
2. Keep the plugin's exported `capabilities` in step with the file. `HarnessRegistry` refuses a plugin
   that leaves any row unanswered, so an unimplemented capability has to be declared, not omitted.
3. Answer the `native` column with the evidence: the method or notification that carries it, and the
   program version it was read from. A capability claimed without that basis is not `supported`.
4. Acceptance is layered, and a passing conversation does not stand in for the other layers:
   - recorded native lines for each contract difference, replayed in a unit test;
   - the real program inside the session sandbox, against the real gateway and platform tools;
   - the user-facing scenarios in the requirement (`A1`–`A10`), on both editions.

Required levels: `mandatory` rows must be `supported` before the plugin is delivered. `native` rows must be
`supported` when the engine has such an event; an engine without one declares `unsupported`. `optional`
rows add detail and may be `unsupported`. Order narrows the work: first conversation, stop and resume;
then the remaining scenarios. Both stages must pass.

## Table

| Id | Capability | Level | Order | What the plugin must guarantee | What the runtime owns |
| --- | --- | --- | --- | --- | --- |
| `open` | Open and resume the native session | mandatory | first | `open` creates the engine's own session in `directories.state` and returns its id; with an `engineRef` it resumes exactly that session, and a refused or missing one is an error, never a new session. It declares the platform tools it was given when the session is created. Given a `previousContext`, it writes that context into the new native session before returning, so the session continues from it. The model is reached only through `model.baseUrl` with `model.token`. | Session row, workspace, sandbox and the model lease; the persisted `engineRef`; deciding which session may run |
| `startTurn` | Run one turn | mandatory | first | One turn at a time per session. `startTurn` reports events in order through `host.emit` and returns a `HarnessTurnResult` naming one stop reason. A failure the engine could not recover from is `error` with a readable message, not a thrown exception. | Admission, the run row, the event log, artifact collection, the answer message |
| `messages` | Messages, tool calls and their order | mandatory | first | Every assistant message has a `nativeId` and exactly one `message_start`, any number of `message_update` and exactly one `message_end`; a settled message is never reopened. Every tool call has exactly one `tool_execution_start` and exactly one `tool_execution_end` with the same `toolCallId`, joined to its tool result message. Results carry `content`, an `outcome`, and `data` when a consumer needs structure. | Platform message ids, sequence numbers, the cursor, snapshots, tool-execution projection, artifact registration |
| `interrupt` | Stop, and settle what is in flight | mandatory | first | `interrupt` stops the engine's own commands and background work and returns only when the turn is no longer working. Calls that got no result are returned in `unsettledToolCalls`; they are not reported as failed, and their external effect is not inferred. | Aborted stop reason, the run's single settlement, the `unknown` tool outcome and the notice the user sees |
| `stopReason` | Map the native end to a platform stop reason | mandatory | first | `stop` only when the answer completed with the turn's tools settled; `length` only on an explicit truncation report; `toolUse` when the engine stopped to call tools; `aborted` when interrupted; `error` for failure or unrecoverable loss. Strings in a message are never read as a reason. | Whether the run has a final answer (`answerMessageId`) |
| `close` | Close and recover | mandatory | first | `close` releases the process and communication resources and leaves persisted native state in place. Opening again with the same `engineRef` continues the same native session, with no replay of past items or tools. | Idle release, restart, and deleting the session's native directory |
| `steer` | Insert an input into a running turn | mandatory | second | `steer` returns whether the engine accepted the input. Acceptance is not consumption. `host.consumed(inputId)` is sent only when the input actually enters the model context, and the runtime then advances the platform's consumption order to that position. An input that is not accepted stays queued for the runtime. An input carrying changed host context gets that context ahead of its message. | Receipt, input records and their order, `input_received` and the consumption sequence |
| `platformTools` | Platform tools through the runtime | mandatory | second | Tools come from the runtime as declarations once, at `open`, and the engine keeps them with its native session so a resumed session has the same list; they are executed only by `host.invokeTool`, which returns content, an outcome and optional data. The engine does not authorize, does not add its own tools beyond its own file and command tools, and does not open a token for platform services. | Tool list per session and per surface, permissions checked at call time, delegation, presentation, product tools, external MCP, progress and cancellation |
| `gatewayModel` | Models only through the gateway | mandatory | first | Every model request, including the engine's own compaction or summarization calls, goes to `model.baseUrl` with `model.token`, names `model.model`, and passes `model.contextWindow` as the real context length. The engine never reads an upstream address or key and never calls a provider directly. | Domain model settings, the gateway, lease issue and revoke |
| `skills` | Selected skills, read-only | mandatory | second | Skills are read from `directories.skills` (or through the engine's own discovery of exactly those directories). Only the selected versions are visible; the engine does not read a skill library of its own, does not enable its own built-in skills and does not install plugins. | Skill resolution and its authorization, the read-only mount, the catalog text in the prompt |
| `usage` | Usage | native | second | When the engine reports usage, it sends `usage_updated` with the last call's counts and, when it has one, its own total, associated with the native turn and one message id when that is known. A repeat replaces an earlier report. It never sums or spreads counts across engines. | Storing the report, showing it, and pricing the call in the gateway |
| `optionalDetails` | Detail beyond messages and tools | native | second | Whatever the engine can tell about its own work that the user should see — a changed file, a context compaction, a warning, a hook, a review, a moderation hold, an accepted-model change — is sent as `run_detail` with a stable `key` per entry and the fields of its category. `key` replaces the previous entry with the same key and never accumulates duplicates; raw native payloads are not forwarded. | Validation of the category, persistence, projection into the snapshot and the shell's process region |

## What no plugin may do

These are the boundaries of the runtime's control, so they are refusals rather than capabilities:

- Emit platform events that belong to the runtime: `input_received`, `artifact_registered`,
  `pending_questions_changed`, `agent_start`, `agent_end`, `turn_start`, `turn_end`. The runtime derives the
  logical steps and the run's end itself.
- Decide authorization, execution identity, data scope or which session or run it is working for.
- Keep selling facts on the platform's behalf: the tool-result `outcome=unknown` is the plugin's report of
  its own missing result, not a conclusion about whether an effect happened.
- Turn a rejected or unaccepted input into a consumed one, and never report consumption by matching text.
- Retry a call whose outcome is unknown, and never replay past items or tool calls on resume.
- Ask the user for approval or permission. The platform has none for engines, and the engine's own approval
  path is configured off.
- Read platform facts from anywhere but its own session's directories and the host callbacks, or reach the
  runtime from inside the sandbox other than through the program's stdio, its private channel and the sandbox callback.
