# Operations diagnosis on the agent runtime

Proposal for controller review, 2026-10-29. This is the design stage only.
[Review entry](../notes/design.md) lists decisions required before implementation;
[ops-diagnosis](../packages/contracts/ops-diagnosis.md) owns the proposed interfaces.

## Goal and baseline

An operator diagnoses a real successful or failed question from the operations
workbench, using correlated service logs, runtime messages and artifacts, and
authorized read queries. The diagnosis agent runs in the existing agent runtime;
the workbench no longer runs a diagnosis loop or exposes its filesystem/commands
to the model. Existing operations feature entries remain available in the common
conversation shell. The external operations MCP keeps its wire shape.

Inspected public baseline: `80dc66859e4d0f34285094f8a4ae6e5c7007b021`;
enterprise assembly baseline: `770f37c6666810db91b2fea4563b5e540cca73af`.
The baseline has the common shell/host contracts but **does not contain**
`packages/contracts/service-logging.md`. This proposal consumes the supplied
service-logging worktree contract, including its runtime-log proxy and independent
run/correlation/session IDs. That worktree also has uncommitted implementation
changes. Before implementation, the controller must provide the integrated logging
baseline. Neither those changes nor the logging contract are copied into this branch.

The older capability documentation describes the pre-runtime product. In this
baseline, `services/assistant/evidence.ts` already reads runtime snapshots, while
`observe/workspaces/turn-evidence-workspace.ts` still copies evidence into files.
Use the code ownership below, not the old source paths or analysis-mode taxonomy.

## Ownership and execution

| Owner | Responsibility after migration |
| --- | --- |
| Workbench | Diagnosis definition, localized prompt, standard diagnosis skill, target resolution, observe authorization, diagnosis session index/admission intent, operations pages, external MCP adapter |
| Agent runtime | One PI loop, model role resolution, compaction, messages/events, cancellation/recovery, session workspace and immutable output artifacts |
| Each service | Its log producer, PG log store, retention and single-service log query |
| Ontology service | Metadata, non-secret configuration view, service-status API, DSL semantics and user/data authorization; its own runtime evidence after retrieval moves there |
| Common Vue shell | Conversation/session UI, PI event recovery, tool rendering, Markdown and artifact rendering |

Keep one built-in diagnosis definition with a stable UUID, `modelRole: diagnosis`,
the workbench-owned `diagnosis-agent/main/system` template, and the standard
`ops-diagnosis` skill. Reuse the existing prompt overlay mechanism for enterprise
localization. Do not make diagnosis another assistant preset with unrestricted
editable skills: the operations surface has a fixed evidence capability set.
No domain/custom skills or external MCP selections are attached in this migration.

Publish the skill from
`packages/workbench-server/resources/runtime-skills/ops-diagnosis/` using the
existing provider `workbench` publication path. It is an ordinary `SKILL.md`,
scripts and references package. The same scripts run under an external harness
with documented URL/auth environment variables; no `runtime.json`, private tool
registration or second internal CLI. Existing query-flow diagnosis instructions
move into this package's references after removing obsolete raw-log, filesystem
and subagent instructions. Product knowledge remains workbench-owned and is read
through its existing bounded knowledge API, not mounted from the host.

The prompt preserves goal/expected-result clarification, first-deviation analysis,
source attribution and explicit evidence gaps. It names IDs and API commands,
not `data/traces`, backend paths or an `artifactRoot`. It recommends corrective
actions but cannot execute environment changes. It uses the shared artifact
Markdown rule for optional reports under `outputs/`. Remove the old requirement
to dispatch one diagnosis subagent per question: the single agent can inspect
related runs through the skill; no new nested-run protocol is introduced.

Browser and MCP both call one workbench diagnosis service, which admits runs via
the existing HTTP `RuntimeClient`. The shell uses the full common host proxy at
`/api/observe/agent`. Its wire types, idempotency, snapshots, stream recovery,
cancel and deletion semantics are exactly [agent-host](../packages/contracts/agent-host.md).
No diagnosis-specific PI state enum or event conversion is added.

The host persists only the session's domain/user, fixed agent ID, optional target
reference, display/list metadata and run admission identifiers/fingerprints needed
for matching retries. Messages, tool results, status and artifact bytes are read
from runtime. The existing `diagnosis_sessions` join to `harness_sessions` is
replaced, not kept as a fallback. Reuse application-neutral runtime client/admission
helpers; do not make diagnosis depend on assistant business orchestration or copy
its retrieval, QC, feedback and definition-management paths.

A lost admission response is reconciled using the same persisted UUID. A runtime
outage is a dependency error, not empty history or a failed model turn. Recovery
reads authoritative snapshots and never restarts tools. Closing a tab or timing
out an MCP wait does not cancel a run. Fresh continuation credentials are supplied
per run. Legacy diagnosis history conversion is deferred; do not silently read
legacy rows as runtime sessions or delete their stored data in this migration.

## Evidence access and read-only boundary

The skill's commands are `resolve`, `logs`, `session`, `run`, `artifact`, `config`,
`health`, `metadata`, `query` and `knowledge`; the contract defines their inputs
and existing providers. Commands only read remote evidence. Writing a local
diagnosis report is a normal runtime workspace operation, not an operations API.

Use the existing sealed workbench callback credential mechanism. In-product
`ONTOMATO_TK` is scoped to `/api/observe/evidence/`, the executing run and expiry.
Only explicitly registered reads, including the read-only POST resolver/query,
exist below that prefix. Reject unknown routes, methods and request fields;
there is no caller-supplied URL, service host, file path or generic proxy. Ordinary
edition authentication and `assertObserveAccess` run after unwrapping. Do not use
the whole `/api/observe` prefix: it also contains delete, configuration, test-start
and cancellation operations. The model credential stays supervisor-only; neither
a runtime host credential nor an unrestricted user token enters the sandbox.

These narrow routes call the same service methods as the existing APIs. They do
not implement another log query, DSL validator or runtime store. They are needed
because a single restricted callback prefix cannot safely cover the old mixture
of reads and mutations. Normal external users invoke the same routes with their
own credentials. Service-log filters/response/error semantics are reused verbatim.

Three access rules remain distinct:

- Service logs are environment evidence, as specified by service logging;
  `domainId` is an optional filter. An empty page or expired retention is not
  proof that execution did not occur.
- Turn/autotest evidence is checked against its domain-owned source before any
  runtime request. Existing same-domain observer investigation of assistant turns
  remains possible; this is not unrestricted runtime session browsing.
- Diagnosis conversations need an explicit ownership decision (review D1).
  Proposed: user + domain ownership, with both checked for list/read/write/MCP;
  this corrects the current unscoped diagnosis session store and is not assumed
  to be an already implemented behavior.

For current data checks, route `query` to the existing ontology
`POST /ontology/query/execute-dsl` with `{dsl}` and the delegated user's credential.
`OntologyQueryService.execute/checkGraph` owns the read DSL validation;
`QueryAccessService` owns current user/domain/data permissions. Do not use a
retrieval-exploration grant: that path deliberately has different data permission
semantics. Preserve the current 30-second query timeout and bounded preview
(maximum 25 rows) with source truncation information; cropping is not a substitute
for authorization. Any gap found in actual DSL/action validation is fixed at the
ontology owner, not by adding a second Node keyword filter. No raw SQL, arbitrary
Python, Action, WriteTask or metric-execution tool is added to diagnosis.

This retires the high-privilege-tool confirmation part of the earlier operations
authorization work by removing those capabilities. It does not implement a new
dangerous-command approval system. Its remaining read-query obligation belongs
to the ontology execution boundary and must be verified there before closure.

Runtime still has standard PI `read/write/edit/bash`. They operate in its session
environment; the removed tools operated in the workbench process. Use the approved
runtime deployment, with no workbench data/log/config/repository mounts or Docker
socket passed to workers. Existing UID/rlimit isolation is not a filesystem or
network namespace (see [runtime design](agent-runtime-design.md)); do not claim
otherwise. Stronger generic isolation/egress remains outside this module. The
acceptance claim is removal of host tools and host-data access paths, verified in
the real deployed container arrangement, not that arbitrary shell execution has
become impossible or that a native macOS test proves Linux isolation.

## Targets, correlation and Turn workspaces

The primary new entry is a known assistant `(sessionId, runId)` from the shell's
message action. An old `turnKey` is resolved through the assistant's authoritative
turn index; an autotest `(testRunId, caseId)` through its stored result reference.
Never manufacture a request sequence from a message index or parse a runtime UUID
as a Turn key. Source ownership, run membership and time bounds come from owners.

Resolve returns references to the source run, related retrieval runs, artifacts
and bounded per-service log queries. It does not start a model, QC, collection or
business query. Log filters use persisted correlation/run/session IDs as exact,
independent identities. When related runs have different correlations, query each
actual correlation; never overwrite it with the diagnosis run's correlation or
guess it from a prefix. The diagnosis request keeps its own trace headers while
the target identity is a query parameter. Missing correlation is an evidence gap;
an explicit run/time or time-only query is visibly weaker evidence.

Runtime resources remain host + domain scoped. Today assistant retrieval evidence
is read under the workbench host; the parallel ontology-host migration changes
that. The proposed integration reads foreign-host resources through the owning
ontology service, which verifies the request and uses its own runtime credential.
It returns the same runtime/public projection shapes and immutable bytes. It must
not expose secrets/definition environments, give workbench the ontology host key,
or broaden `/v1/logs` access into session access. The ontology evidence facade and
same-domain observer policy need controller agreement with that module (D2).
Until available, return an explicit unavailable source, never recreate evidence
from old raw logs. This is an implementation dependency, not full acceptance.

Keep the Turn/case entry and retention controls, but turn its diagnostic workspace
into a small reference manifest: target, resolved run/artifact IDs, effective log
query windows and reference-resolution time. Existing autotest expected/actual
answer and evaluation files stay owned by autotest. No new `raw-logs/`, copied
prompts, model transcript, `errors.log` or parsed SQL/MQL tree is generated.
Refresh resolves current references; GET reads never mutate or recollect a case.
Downloads contain the reference manifest and existing case-owned results, clearly
labelled as references rather than an offline complete evidence archive.

Log query results go to the consuming tool/page; runtime may naturally retain
that tool output as conversation history. Diagnosis reports can cite service,
query window, event IDs, run/artifact IDs and observed gaps. Do not add a second
log payload database/file archive or bulk-export logs into runtime `outputs/`.
Query cursors, retention and late insertion mean references are not immutable log
snapshots. An unavailable old source remains visibly unavailable.

## Moving the page into the shell

Replace `ObserveLayout`'s private conversation/sidebar with an operations
`ShellWorkbenchDeclaration` and `AgentShell`. Reuse the host client factory and
default renderers. Keep `/observe` routing and existing deep links; the host maps
routes to feature IDs and selected objects. No observe-specific renderer, router
or permission logic enters the platform shell.

| Existing entry | Shell placement and retained behavior |
| --- | --- |
| `/observe/diagnosis` | Diagnosis agent and its sessions; common stream/composer/stop/history |
| `/observe/turn[/:turnKey]` | Feature page: target list/detail, reference view, refresh/download/delete/retention |
| `/observe/live-logs` | Existing live monitor as a feature page, using the service-logging implementation; no additional log UI/CLI (D3) |
| `/observe/test`, `/results`, `/cases`, `/autotest/runs/:runId/cases/:caseId` | Existing test configuration, case management, result/evaluation/detail pages; keep scoring and execution behavior |
| `/observe/dsl` | Existing explicit user-operated DSL page, including enterprise result tabs; not a skill available to the agent |
| `/observe/knowledge` | Existing operations knowledge reader as a feature page; not ontology knowledge governance |

Feature-specific lists remain within their pages; the shell owns the agent/session
navigation. A page's diagnose action opens a target-bound diagnosis conversation
in the same shell instead of maintaining a second `DiagnosisSidebar` chat loop.
The return route retains the selected Turn/test case. Reuse existing component
bodies and enterprise account/permission/tab assembly; change only context and
evidence presentation required by this migration.

Restore `TurnDiagnoseButton` in the business shell's `message-actions` slot using
its `(sessionId, runId, messageId)` scope. The host verifies that the source run is
stopped and accessible; the button retains the edition's existing observe gate and
new-tab behavior. Register it alongside the current conversation actions. Deep
links with `collect=1&diagnose=1` resolve references and start once using stable
admission keys; consuming the URL flags prevents reload/back-navigation from
starting another diagnosis. Merely viewing an old session never starts a run.

The current `AgentShell.vue` exposes only `reloadAgents`; external session opening
is not implemented. Add a generic controlled `sessionId` binding to the shell so
host routes/actions can select a session and observe selection/deletion changes.
The host creates the target session and admits its first message through its own
client, then selects it. No diagnosis target or new completion state enters the
shell API. Cover deep-link restoration and agent-switch ordering when adding this
binding; do not access the component's private `conversation` object.

## Whole-path deletion and retained consumers

Paths below are relative to `packages/workbench-server/src/platform/diagnosis`
unless otherwise stated. Remove obsolete tests with their implementation; keep
tests that protect the replacement's authorization, wire and recovery contracts.
Reconcile the list with service logging first: its in-progress branch already
removes some parser/rendering files. Never restore them to ease merging.

| Remove or replace | Replacement / dependent consumer |
| --- | --- |
| `observe/agent/pi-agent.ts`, `session-runtime.ts`, `session-response.ts`, `session-history-view.ts`, `sse-bridge.ts`, `runtime-registry.ts`, diagnosis compaction implementation | HTTP runtime admission/snapshots; keep prompt text only where still consumed by runtime compaction |
| `observe/agent/tools/builtin/*`, `tools/dispatch-agent-tool.ts`, role loader/role prompts and subagent UI | Runtime session tools and one diagnosis definition; no workbench command/file bridge |
| Diagnosis `AgentTool` wrappers and local skill loader/index | One standard skill and narrow read endpoints; keep provider implementations at their existing owner |
| `/chat`, legacy `/history`, `/stream`, `/stop` handlers and diagnosis-specific session/event contracts | Common host routes; external MCP translates at its own boundary only |
| `workspace-artifact/log-collector.ts`, log-copy branch of `post-processor.ts`, `parsers/llm-log-parser.ts`, `app-log-parser.ts`, backend/session text parsers used only for harvesting | Single-service PG queries; exact stored run references |
| `agent-llm-transcript.ts`, `prompt-*` merger/catalog/writer/types, diagnostic-event/logic extraction and log-derived summary/timeline/flowchart branches | Runtime messages/tool results/artifacts; no synthetic transcript reconstructed from logs |
| Raw-log/path-based branches in `workspaces/{builder,collect,turn-evidence-workspace,turn-resolver}.ts`; obsolete log-source discovery/config/path helpers | Reference resolver/manifest; preserve target/domain and case-owned retention/file operations |
| UI `useAgentChat`, diagnosis stream projection, old `agent-chat` rendering and `DiagnosisSidebar`; raw prompt transcript previews/parsers | Common shell; reference view and ordinary runtime artifact rendering |
| Enterprise raw MQL/log processors and translated instructions that require old paths | Remove dead log-processing hooks; retain the explicit DSL page's MQL result tab and useful query guidance |

Two live non-diagnosis consumers must move in the same integration:

1. `autotest/runner/single-case.ts` invokes `buildTurnEvidenceWorkspace` and consumes
   post-processing results. Change only this evidence tail to save references;
   remove log-flush waits and raw-log counters. Keep answer execution, expected
   answers, evaluation and test result storage. `artifact-routes.ts`, retention,
   `ArtifactDetail` and file-preview callers consume the new reference shape.
2. `services/knowledge-governance/tools.ts` still calls `collectTurnArtifacts`.
   Replace that command/caller and its skill documentation with a read of owned
   Turn/run evidence, using the existing governance authorization. It must not
   call the observe-only skill credential path or materialize host files. Coordinate
   with the governance/ontology owner if already migrated; do not retain the old
   collector solely for that caller or move governance wholesale in this module.

Update both editions' assembly hooks, prompts, skill content, UI exports and
contracts together. Do not delete shared `core/agent-loop`, `harness-sessions`,
model configuration or LangChain globally while other modules still use them;
the final cleanup module owns their last-consumer removal. No legacy data
conversion, feedback/QC migration, new auto-remediation or release work is added.

## Evidence required after design approval

This Markdown commit establishes no implementation/runtime acceptance. Later,
keep focused checks for the external MCP shape, common host recovery/idempotency,
foreign target/artifact denial, restricted callback route/method access, and
ontology rejection of write-capable DSL. Do not mirror every helper with tests.

The controller owns main-checkout real-stack and image acceptance: diagnose a real
question and a real failure, join all three service logs by the recorded IDs,
read the relevant runtime sessions/artifacts (including ontology-owned retrieval
once migrated), and compare the conclusion to actual evidence. Exercise shell
deep links, follow-up, cancellation/reconnect, retained feature entries, public
and enterprise permissions and the unchanged MCP `send`/poll behavior. In the
real runtime deployment, prove that the workbench host command/file bridge and
raw-log collection path are absent. A missing log store must be reported as a gap,
not empty success. Build real images and smoke the enterprise stack in the main
checkouts; worktree static checks are not substitutes. External-harness execution
of the unchanged skill package proves portability, not production isolation.
