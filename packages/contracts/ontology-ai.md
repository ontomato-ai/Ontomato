# Ontology AI host

Slice A implemented, 2026-10-29: the common host and retrieval. Generation file
consumption below is the approved slice B design and is not implemented yet.
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
same Java admission/retrieval services. Slice B will keep existing generation routes' business request/result meanings
and replace their Java model calls with this host.

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
Java adapter; the approved gateway model-test endpoint will be implemented in B (design D2).
