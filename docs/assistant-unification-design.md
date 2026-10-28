# Assistant unification

Approved design, 2026-10-28, based on public `ba6acd1c`. Backend A/B implementation
is authorized after the contract simplification. The frontend shell/UI
and Java traditional-ABC removal are separate parallel work; this branch owns
server changes, the [common host proxy](../packages/contracts/agent-host.md), and
[workbench actions](../packages/contracts/assistant-chat.md).

## Direction and ownership

Regular querying and analysis are workbench-owned definitions: prompt + standard
skills + model role on the same [runtime](../packages/contracts/agent-runtime.md).
Both can retrieve data and write reports. There is no alternate executor, typed
business tool registry, completion endpoint or host-created agent outcome.

Workbench owns definitions, user/domain session indexes, first-message titles,
memory/preferences, admission/gates and references to retrievals and artifacts.
Runtime owns messages, events, PI state and immutable output files. Feedback,
decisions and asynchronous QC retain their present workbench owner. Knowledge
governance and diagnosis retain their services; only their historical evidence
readers change. No old-data conversion, dual reads or legacy compatibility is added.

The frontend owns `agent-shell` contracts, `packages/agent-shell-ui`, both edition
layouts and old UI removal. Its only product dependency is contracts. It owns
code-declared workbenches/features, the two-column layout with a right-hand panel,
and default rendering with host overrides/action slots. Backend supplies the same
agent-host proxy shapes for every shell host, plus separate workbench actions; it
does not duplicate shell declarations or renderer fields. The
[artifact Markdown contract](../packages/contracts/agent-artifact-markdown.md)
remains the only presentation rule, consumed through `ARTIFACT_MARKDOWN_PROMPT`.
The frontend verifies markstream-vue incomplete nodes before adoption, stable
path keys, pagination and HTML `allow-scripts` without `allow-same-origin`.

## Conversation, retrieval and files

Every message starts an ordinary run in the same session. A question stops normally;
the next user reply is another message, with no `needs_input` state or forced answer.
A standard assistant-facing retrieval skill calls the existing
[retrieval service](../packages/contracts/data-retrieval.md), one complete question
per retriever. It supports explicit resume of that retrieval/session using its
expected run/decision revision. The assistant sees child messages and IDs and decides
whether to resume; the host does not classify natural-language questions.

The authenticated skill endpoint derives parent/user/domain from the owned run,
never arbitrary body claims. Continuation binds the new child round to the current
parent run while retaining retrieval identity. Cancellation closes those gates and
stops child work. Reuse existing admission and deadline semantics; retain
`queryTimeoutSeconds` after deleting branch-mode configuration.

Child workspace paths cannot be referenced in the parent's Markdown. The skill
downloads accepted child snapshots through the host and atomically writes their
unchanged bytes into its own `outputs/`; runtime registers them normally. Workbench
links source and parent artifact IDs and verifies the existing receipt/digest before
exposing dataset actions or QC. A modified copy is a generic file, not an accepted
dataset. Rows are not copied into business tables or token events. QC remains
asynchronous and attaches through the existing retrieval owner; it does not delay
the assistant's stop or change PI state.

History, feedback, dashboard creation, PPT export, governance and diagnosis use one
owned session/evidence reader instead of checkpoint parsing. Markdown paths resolve
at run granularity: the final file version for a stopped run, the current version
for a running run. No message projection change or per-message artifact boundary
is introduced. Deleted sessions return 404; no host deletion tombstones. Only an
active run blocks the next message (409 SESSION_BUSY), with no predecessor check.

## Editable definitions and retained scope

Both presets are ordinary editable definitions. Keep one prompt, one standard
skill list and model role, plus name/description/icon/enabled, related classNames,
graphScope and enabledMcpServiceNames. Remove execution/dimension/report/summary/
hot-report configuration. Management uses the existing analysis-agent permission.
classNames is captured on the parent run and passed to retrieval. The prior graph
scope expansion and schema reader supply initial context; graph scope does not
narrow formal retrieval beyond classNames. Existing definition columns are not read
or converted. Appearance retains brand only; qa and addAgentLabel are removed.

**External MCP is not effective yet (外部 MCP 暂未生效).** This unification preserved
editable names without passing them to runtime. On 2026-10-28 the user chose
runtime-owned configuration: hosts pass selected names, runtime owns URLs/headers,
discovery and calls. The separate [external MCP proposal](external-mcp-runtime-design.md)
replaces the earlier undecided transport options; implementation awaits that
module's controller review. General MCP services remain at this baseline.

## Confirmed simplifications

Reports are files, normally `outputs/reports/<name>/report.md`, referenced with a
Markdown link. The report skill guides writing; no section/publish tools, delivery
check, report-required switch or automatic rerun remains. A missing file stays
unavailable. PDF/PPT delivery reads the selected immutable file and its authorized
sources, without another stored report body.

Titles are the exact first user message, truncated only for display. Remove model
title generation and follow-up suggestions. Delete `analysis-agent/follow-up.ts`;
asking about a report is the next message in the same conversation.

**Approved:** retain these functions and move their surviving model calls
to ordinary runs (`skills:[]`, existing model role/prompt), rather than retain direct
model invocation. No new runtime endpoint is needed:

| Consumer | Treatment |
| --- | --- |
| `analysis-agent/delivery/ppt-summarizer.ts` | Ordinary run per existing summary step; keep source limitations and outline validation |
| `dashboard/planning/core/chart-recommender.ts` | Ordinary run for create/append/field planning; keep business parsers and chart definitions |
| `diagnosis/autotest/evaluation/answer-evaluator.ts` | Ordinary scoring run; autotest question execution calls the new assistant service |

These use separately owned auxiliary runtime sessions so their instructions/results
do not enter user conversations; preserve their references for existing evidence
and user cleanup. Do not sweep unrelated diagnosis or Java model calls into this batch.

The four external analysis MCP tools keep names, arguments and response fields:
`list_analysis_agents`, `run_analysis`, `get_analysis_task`, `get_analysis_report_pdf`.
Only that boundary projects old status vocabulary: accepted pending, active running,
stopped/stop completed, aborted cancelled, other stopped reasons failed. Completed
means execution stopped normally, including a clarification question; no delivery
check is implied. `finalAnswer/resultSummary` read final text; `resultReport` and
PDF read the report file, if any; `reportDeliverableEnabled` reflects file presence.
Task IDs reference accepted runs; optional external thread aliases are user/domain
scoped. No internal copy of that legacy state machine or report body is stored.

## Replacement and deletion ownership

Paths below are relative to `packages/workbench-server/src` unless qualified.

| Work | Delete / replace; retained boundary |
| --- | --- |
| Backend A | `services/chat/graph/**`, graph planner/nodes/render snapshots, old chat/thread streaming and `api/utils/title.ts`; replace with assistant session/admission/history/file services |
| Backend A | `data-query/base-query-executor`, `branches/**`, `abc-tool`, `hot-data/**`, hot/static judgment models and traditional Node `/streamSplitQuestion`/`/streamchatV1` clients; remove `abcQuestionMode` from server/contracts; retain retrieval, dataset completeness, formal outputs and timeout policy |
| Backend A/B | Replace all checkpointer/BaseStore users: chat/history, dashboard mutations/create-from-analysis, conversation PPT, admin history/cleanup, governance materials/tools, diagnosis observe workspaces/routes, memories/preferences, analysis routes/task service; remove initialization from `infrastructure/connection.ts` and `http/create-app.ts`, then saver/store packages with no imports |
| Backend B | `analysis-agent/loop/**`, `dimension/**`, `runtime/deep-analysis-tool.ts`, `follow-up.ts`, in-process report/chapter tools, old task runner and duplicate report/message stores; keep useful export utilities and MCP boundary adapters |
| Backend B | Stop scheduler startup/recovery/polling and disable schedule create/update/trigger paths; retain stored tasks/rules untouched. Remove analysis-plan-reuse execution links, retain its data. Frontend declares scheduling “Temporarily unavailable” |
| Contracts | Remove obsolete chat planner/race/ABC events, internal execution-mode/dimension/analysis payloads with their last consumers; keep query completeness, exports, diagnosis and narrow external MCP shapes |
| Frontend line | Shell contracts, old chat/analysis UI/streams, three-column layout, mode settings and both edition page assembly; backend does not edit these |
| Java line (C) | Traditional routes, split/DSL/post-calculation, QC v1, business examples, exclusive MCP calculator and startup Python; recheck callers after Node cutover. Preserve Functions/MetricView/dashboard, QC v2, runtime code execution and grammar examples |

Java startup still calls `sync-product-files.py`; C must replace that resource-sync
dependency before removing startup Python and resolve enterprise prebuilt `sys.html`
ownership. Shared diagnostic loop/LangChain code is not removed merely by name.
Old WIP is a source reference only; no old runtime manifests, JSON artifact tools,
completion API or private skill protocol is transplanted.

## Delivery boundary

After design approval, implement backend A/B and stop for controller integration;
there is no C phase on this branch. Run relevant typecheck/lint and only durable
contract checks. Delete obsolete tests rather than recreate retired fixtures. No
worktree build, deployment, database migration or exception matrix. Frontend/Java
integration, main-directory build and main-path smoke belong to the controller.
