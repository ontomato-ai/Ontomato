# Ontology AI host

Slices A and B implemented, 2026-10-29: common host, retrieval, generation file
consumption and the model-test gateway. B awaits controller integration acceptance.
[Design](../../docs/ontology-ai-runtime-design.md) owns placement and deletion.
Executable `agent-host`, runtime and artifact schemas are the shared definitions.

## Common proxy and admission

Ontology implements **all** of [agent-host](agent-host.md) at `/ontology/ai`:
agents, sessions, runs, snapshots, events, cancel, artifact resolution/metadata/
bytes. No extra common-proxy envelope. Java preserves PI messages/cursors/deltas,
uses the common error shape, and checks authenticated user/domain/resource access.
Browser requests only reach ontology; deployment API prefixes do not change owner.
`AgentHostRun.resolvedSkills` follows the parallel domain-skills schema and
projects the runtime's admitted skill metadata, not current registry contents.

Indexes retain the selected server-owned definition (prompt + skills + role);
`/agents` exposes display metadata only. Retrieval actions use
[data-retrieval](data-retrieval.md), not extra common fields. Both facades use the
same Java admission/retrieval services. Existing generation routes keep their business request/result meanings and use
this host instead of a Java chat client.

Persist host intent/open gate before admission, with stable UUIDs and the common
idempotency rules. Associate existing backend jobs/sessions with their runtime
runs for cancellation. Disconnect never cancels. Read failure does not invent
PI state; restart reconciles stored IDs rather than replaying unknown effects.

Callbacks check the current run/open gate in the mutation transaction. Cancel,
expiry and supersession close it before stopping owned work. A stopped snapshot
closes callbacks for every stopReason. Host result settlement is a separate,
once-per-run business save, guarded against cancellation/supersession. Closing
callbacks cannot authorize a cancelled save or prevent valid final-file reading.
No additional agent completion state.

## Skills and generation files (slice B)

Reuse existing ontology commands for schema, relationships, distinct values and
DSL. Missing sandbox preparation/reset, generator tests and source reads become
normal ontology HTTP operations invoked by standard scripts, with the same
business services inside/outside the product. External scripts open/close a host
work gate when required, without synthetic runtime history. Scripts read their
files and send bytes; runtime paths are never interpreted as Java local paths.

Generators write `outputs/result.json` using their existing result fields, plus
referenced source files. Java reads immutable artifacts from the originating run;
referenced source replaces embedded code in the old submission envelope, and the
result adapter constructs existing DTOs. Runtime does not recognize this JSON.

| Result | Java retains |
| --- | --- |
| Action/Function/MetricView/dashboard | Parameter/source/class/return checks, read/write mode and successful testing of the exact source bytes. Business test evidence is not a model claim or generic bash exit code. |
| Action explanation | `ActionCodeExplanationValidator`, source match and existing save/import/sync checks. |
| Knowledge, naming/instantiation, QC | Existing per-capability shapes and save rules; no second JSON-repair agent. |

An inherited output is not a new delivery. Missing/invalid files keep existing
failure/no-result behavior and do not save. PI stop alone is not business success;
error/abort/cancel cannot publish success. Delete all four submit tools and the
Java workspace submission registry with this cutover.

Prompts move with definitions, preserving English/Chinese overlays. The common
Markdown prompt has one JSON source in contracts: TS exports it as
`ARTIFACT_MARKDOWN_PROMPT`, and Maven packages the same resource for Java. Model configuration continues through the current sealed-key
Java adapter; the approved gateway model-test endpoint is defined below (design D2).

## Generation operations and delivery

The standard [`ontology-generation` skill](../../agent-skills/ontology-generation/SKILL.md)
owns command usage and per-kind result fields. Each runtime definition selects a
kind, server prompt and model role; `query` serves knowledge/description/QC and
`coding` serves the other generators. Results always use `outputs/result.json`.
`sourcePath` references Python bytes from the same run; embedded `code` is rejected
at this boundary and populated only by the Java result adapter.

Normal HTTP operations under `/ontology/ai/generation` are:

| Method/path | Body/result |
| --- | --- |
| POST `/gates` | `{kind,source?: string|null}`; returns `{sessionId,runId}` for an external business gate, with no runtime history |
| GET `/:run/source` | `{source}`; the exact original source |
| POST `/:run/test` | `{code,parameterDefs}`; existing Python result (`result`, `error`, `spendTime`, optional partial-query metadata) |
| POST `/:run/prepare` | `{objDatas,relDatas,vectorDatas?}`; `{prepared:true}` |
| POST `/:run/reset` | `{}`; `{reset:true}` |
| POST `/:run/query` | `{dsl}`; existing sandbox query result |
| POST `/:run/close` | `{}`; `{closed:true}` |

A current user can operate their own external gate. Hosted scripts use the scoped
`ontology-generation` grant and matching `X-Ontomato-Run-Id`; it only permits
callbacks under its own run path. The
normal query grant is separate. Hosted callbacks additionally check the runtime
is running; mutation and test receipts recheck the durable business gate in the
write transaction. Read generation cannot acquire an Action write sandbox.

Receipts bind operation, exact source and parameter definitions. Changing any of
these requires another successful business test. Cancellation and deadline expiry
reject further tests and settlement. A stopped `stop` run can be read after its
callback gate closes, but abort/error/cancel and inherited artifacts cannot save.

## Model connection tests

Conversation model tests and saved-key restoration belong to the runtime's
[model configuration API](agent-runtime-model-config.md). The existing workbench
page calls its own host, which authorizes management and forwards the draft.
Java retains only Embedding configuration and tests.
