# Retriever migration — batch 2 design

Status: implementation contract, 2026-10-28. Worktree verification is recorded
in the batch notes; real images, model quality and full-stack acceptance remain
controller-owned. The baseline is
public `9d3aa118661ccf9278d4423b78370904bc1db102`. This batch replaces the Java
ABC programmer with a workbench-owned retriever on the existing independent
runtime. Controller decisions in the final section authorize implementation.

The wire owners are [data-retrieval.md](../packages/contracts/data-retrieval.md)
(workbench and ontology boundaries) and
[agent-runtime-code.md](../packages/contracts/agent-runtime-code.md) (generic
runtime extension). This design references them rather than defining another
set of response types. Existing [runtime design](agent-runtime-design.md) and
[runtime protocol](../packages/contracts/agent-runtime.md) still apply.

## Scope and ownership

| Owner | Owns | Does not own |
| --- | --- | --- |
| Workbench | Retriever definition/prompts, full question, knowledge/metric injection, decisions, parent linkage, final-output orchestration, result state, dataset schema/projection, QC scheduling | DSL grammar, data permissions, Python processes |
| Ontology service | Read skill package, schema/rules/examples, knowledge/metric specs, grants/authorization, final result parsing/masking, Function/MetricView execution semantics, existing Java QC | Retriever conversation, workbench decisions, runtime lifecycle |
| Runtime | PI loop, messages/events/artifacts, isolated execution, immutable execution receipts, cancellation, credential routing | Exploration/formal distinction, DSL helper semantics, question completion, metric decisions, QC |

Dependencies remain workbench → ontology/runtime and ontology → runtime. Skills
are provider-owned code executed by runtime. Ontology cannot call the workbench
to execute a Function. Runtime code must not import either host implementation.

This batch does not replace LangGraph, the static/hot/abc race, traditional ABC,
the main assistant, analysis/diagnosis agents, MetricView's GENERAL/STATIC model,
or all Java model calls. It does not add a correctness threshold, model-round
budget, anti-loop counter, automatic QC repair, or new UI layout. Existing DSL
priority and short-loop prompt guidance is migrated, not retuned as an accuracy
experiment. Business examples stop entering this retriever; deleting their
remaining traditional consumers belongs to the later cleanup batch.

## Execution flow

1. The verified workbench request creates a retrieval record/admission intent,
   parent association and runtime session/run UUIDs. Repeated external requests
   or tool calls recover those IDs. It snapshots locale, question timeout and
   class scope once. It validates every prior artifact reference against user
   and domain, rather than trusting an ID carried in question text.
2. Before admitting the agent, the workbench calls ontology overview, knowledge
   retrieval and published metric retrieval without a dialogue model. Metric
   retrieval is strictly model-free; knowledge keeps its existing Embedding
   retrieval. It injects full selected specs, source IDs/revisions, relevant
   schema/parameter context and effective prior decisions. Failures fail
   preparation, not 'no relevant knowledge'. No per-process TTL cache or raw
   Java configuration object is copied into the prompt.
3. The workbench asks Java for the exploration grant bound to that exact run.
   It sends the full definition and separate private bindings to runtime. The
   runtime session survives needs-input continuations; every new round has a
   new run ID and fresh grants. The runtime stores no credential request bodies.
4. The retriever uses ontology tools and runtime workspace/Python tools to
   investigate. It selects directly-used, derived or unused metrics with reasons.
   Before comparing figures, it checks filter, grain and time alignment. This
   remains model judgment with supplied evidence, not a proof of correctness.
5. A workbench `submit_dataset` skill reads the selected workspace file, sends
   its execution receipt and source digest to the workbench, and requests final
   output. The workbench verifies the runtime receipt under its own host scope.
   Java validates sources and reruns in a fresh runtime execution under current
   user permissions; it returns authorized rows and actual completeness. The
   callback returns a typed dataset artifact. Runtime assigns its immutable ID.
6. The workbench `finish_retrieval` skill accepts one of the three declared
   outcomes. It checks submitted dataset references and unresolved questions;
   plain assistant text cannot complete a retrieval. The prompt then ends the
   runtime run. After runtime settlement the workbench reconciles the artifact
   IDs, closes the round, revokes its exploration grant and exposes the business
   result. Runtime failure overrides a proposed completed outcome; already
   accepted datasets remain partial deliverables.
7. On completed retrieval, workbench schedules the existing Java quality check.
   It returns the answer without waiting for QC, and later attaches check facts
   to that retrieval/round/dataset set. The checker does not change the answer.

The model never selects credentials. `submit_dataset` always means the workbench
will obtain final execution from Java, even if exploration had no apparent row
restriction. This deliberately removes `outputCode`'s source-list-based test
reuse optimization and follows the new 'always rerun' completion requirement.
Final execution receives source and declared parameters, not exploration output
files. Hardcoded answers remain a model-quality risk; neither this design nor
the former output source declaration proves arbitrary Python lineage.

The accepted metric tiers are preserved across batch boundaries. An exact,
zero-parameter fixed metric is the main assistant's permitted direct-execution
exception, implemented when that assistant replaces the race. A dynamic match
comes to this retriever with full specification and parameter/schema context;
any modification is declared derived. With no suitable metric the retriever
explores from the ontology. This batch does not silently replace static/hot race
semantics to install that future fast path. Usage is derived from accepted
dataset/round `metricUses` identities, not incremented on every retry or tool
preview; no second independent usage counter is required.

## Definition and submission tools

The English definition moves from
`packages/data-engine-core/conf-defaults/abc_programmer.md` to workbench prompt
templates under `data-retrieval/`; enterprise provides the Chinese template at
the same relative path through the existing prompt overlay. Both use model role
`coding`, current compaction templates, and the same typed tool names.
The runtime has no Chinese/business prompt copy. The old Java programmer prompt
and assembly branch are deleted after both editions use the workbench definition.

Preserve ABC reasoning, distinct-value probing, class-specific syntax/examples,
single-grain tables, stable pagination and source declarations. Change the old
'choose the most reasonable interpretation' instruction to the approved
needs-input protocol. Replace `outputMessage` with ordinary progress text,
`test` with `python_execute`, and `outputCode` with `submit_dataset`. Use existing
workspace tools; add a generic exact-once `workspace_edit` if needed to preserve
local file edits. Do not add programmer-specific `runAfter` dispatch to runtime.
Do not copy `userId/domainId`, localhost URLs or the test-result reuse rule into
the new prompt.

The workbench skill package has two tools, no exploration credential:

| Tool | Model input | Host-owned checks/result |
| --- | --- | --- |
| `submit_dataset` | `{path,executionId,title,question,outKeyRefs,assumptions,metricUses,selfCheck,decisionIds}` for Python; an explicitly tagged DSL/metric recipe for direct execution | Read exact file bytes in skill; verify run ownership/receipt/hash; obtain Java final execution; return summary plus `workbench.dataset.v1` artifact |
| `finish_retrieval` | `{status,submissionIds,summary,questions? ,error?}` | Validate discriminated shape, open run and submission ownership; register business outcome. Completed requires accepted datasets and no unanswered material questions |

Invocation identity comes from runtime private environment, not arguments. Each
submission is keyed by `(retrievalId,runtimeRunId,toolCallId)`; same identity and
same bytes reuses the receipt, changed bytes conflicts. Workbench records the
submission and final-execution ID before calling Java. It neither calls itself
over HTTP for internal abc use nor gives the callback a runtime service token.

The submitted business fact and runtime artifact commit cannot be one database
transaction. A submission initially stores the toolCallId and final receipt;
only the runtime's committed tool result/artifact proves publication. Recovery
resolves that exact tuple from the runtime snapshot. A callback succeeded but
the runtime process/result was lost is not published as a new dataset and is not
automatically replayed. This preserves batch 1's unknown-side-effect rule.

Callback write ownership follows the already accepted governance pattern:
per-round record and open gate, close before cancel or opening another round,
check gate and revision inside the write transaction. Fetching Java/runtime
data happens outside short transactions. No late callback may mutate the next
round. The guarantee starts when the workbench closes the gate; accepted reads
or writes before closure are not undone. Runtime terminal observation closes
before exposing terminal state to clients.

## Continuation, cancellation and existing consumers

The workbench stores the pending questions and decisions, not runtime message
history. A reply is matched to question IDs and expected decision revision,
then becomes input to a new run on the same runtime session. Rehydrate needed
source files from immutable prior receipts/accepted recipes into the new run's
workspace. Do not share mutable scratch between runs or inherit an expired grant.
A changed answer invalidates superseded decisions and recomputes affected data;
old artifacts remain historical facts.

Without a reply, no agent or Python process is left running just to wait. In
non-interactive mode return needs_input and available datasets; do not invent
acceptance of a recommendation. `ask` supports creation, retrieval and explicit
answer/resume using the returned retrieval ID. A later main-assistant skill will
consume the same API; no separate retriever protocol is reserved for it.

The abc adapter calls the service with the race's AbortSignal and its existing
parent query identity. It maps authorized artifacts into current Dataset,
abcCodes/abcDsls/outKeyRefs and thinking events using one projection. It reports
runtime locations as runtime references, not fake Java `sessionId/nodeId` pairs.
Add a distinct runtime reference to query records and automatic-test evidence;
keep existing Java references for static/hot/traditional paths. Diagnostics and
history must follow the actual reference kind.

Completed outcomes compete normally. A needs_input outcome is not a successful
empty answer and cannot win on partial data. The adapter preserves its retrieval
reference/questions with the abc fallback and a specific pending-input reason;
another complete hot/static result can still win. Full conversational routing of
answers to the retriever belongs to the main-assistant batch. In this batch the
public API/ask continuation is complete, but the unchanged LangGraph planner
does not automatically route the next chat message to it. This limitation needs
controller acceptance; otherwise it requires an explicit scope adjustment.

On race loss, explicit cancel, parent cancel or query deadline, close the
retrieval gate first; cancel its agent run and all pending Java final executions,
and revoke grants. Cancelled output cannot become a later winner. A lost cancel
response is reconciled by ID, not by reopening the gate. Client disconnect only
ends observation for public retrievals. Workbench restart reconciles durable
admission/round mappings from runtime snapshots; runtime restart leaves running
executions interrupted and never restarts code automatically. New work after an
expired/lost credential requires fresh caller authentication.

## Python callers and packaging

The generic runtime code API replaces Java process spawning throughout the live
call graph. Java retains business interpretation and file-tool state for its
agents that have not migrated. Its Python service becomes a narrow runtime HTTP
client with caller-supplied, server-derived authorization; it is not a second
executor or a fallback. Use a separate runtime `ontology` host credential;
workbench and ontology must not share the same host identity. Registration
authority lets Java publish the ontology skill, while workbench can consume it.
Secrets are generated through the existing deployment credential owner and
injected into their owning service only.

| Existing producer | Necessary migration in this batch |
| --- | --- |
| `ABCProgramServiceImpl` program/dashboard/read Function execution | Source + structured parameter file → runtime HTTP; retain result/source/column handling in Java |
| `ABCProgramServiceImpl` write Function execution | Runtime HTTP with ontology-owned write/sandbox grant; retain Action/WriteTask semantics and authorization |
| `ReadFunctionMakerSkillTools`, `ABCProgramDashboardMakerSkillTools` | Keep Java agents; replace `admin` arguments with issuer-controlled test grant and new helper/parameter protocol |
| `WriteFunctionMakerSkillTools` | Keep Java generator; transfer code/parameters and sandbox binding, no host file path in runtime request |
| `AfterCalculatorSkillTools`, `PythonCalculatorServiceImpl` | Preserve traditional flow and input/result semantics; explicitly transfer required cached inputs into execution files, or expose existing inputs through scoped ontology read routes; no shared Java directory mount |
| `SkillTools.executePythonFile` | Remove its direct ProcessBuilder too; resolve approved configured script within its package, transfer required package files/arguments through the same executor; unsupported external dependencies fail explicitly |
| `DslToPythonCodeUtil` and remaining generator prompts in both editions | Emit the one ontology helper protocol; no request-body identity or local engine port |

The former `/writeFunctionOperation/*` trusted body domain/sandbox, so merely
restricting network to the Java host is insufficient. The query grant filter rejects read/exploration grants on those paths; runtime write consumers require a dedicated
credential-checking boundary deriving sandbox/domain from the authorized task.
No broad write authority is issued by the retrieval grant endpoint. Legacy
direct HTTP write callers must be enumerated and changed at the same boundary;
do not preserve a body-controlled path for new Python to fall back to.

The runtime image gains the existing pinned CPython 3.10 computation dependency
set (requests/numpy/pandas/sympy and its required closure), with one authoritative
requirements file moved to the runtime packaging owner. Do not upgrade Python
or packages incidentally. Verify interpreter/Node/system library compatibility
in the actual final image; copying a venv between incompatible Debian bases is
not a supported shortcut. Use build stages, remove pip/build tools from the final
runtime, and retain package metadata/license files needed for notices.

`scripts/third_party_notices.py` already supports combined npm/Python notices.
Run it against the **installed production closures** and retain the batch 1 fix
that mounts npm license source paths from the dependency stage. Include Python
interpreter notices and sandbox/system package notices. Package license strings
are inventory, not a claim that license obligations were fully reviewed. No
new dependency license or size is asserted without the actual artifact.

The first runtime image was reported as about 101 MB before Python. This batch
has no measured new size. Controller acceptance must record architecture,
source SHA, image digest, `docker image inspect` uncompressed size and comparable
registry/compressed size if measured, plus the Python/dependency/sandbox layers.
No guessed size target is added. Verify imports and actual code execution inside
the built image, then both editions' full stack. Worktree Dockerfile parsing is
only syntax evidence and cannot satisfy this check.

The existing data-engine image also runs `mcp/mcpserver.py` and uses Python for
startup synchronization. Traditional ABC and Java MCP are expressly deferred.
Consequently, deleting the Java executor does **not** by itself remove Python
from that image. The single-environment requirement conflicts with deferring
this process; see decision R2 below. Do not silently leave two environments and
report the requirement complete.

## Removal inventory

All paths below are public repository relative unless otherwise stated. Remove
old callers when replacing their owner; do not add an old-route forwarding shim.

| Delete or replace | Preserve for named remaining consumer |
| --- | --- |
| `ChatController./abcHarness`; `ABCHarnessService`/`ABCHarnessServiceImpl`; `ABCHarnessTaskService`/`ABCHarnessTaskServiceImpl`; task/message beans | ChatController traditional split/chat routes and their BackendSessionEntrance lifecycle |
| `ABCProgrammerSkillTools`; Java `ABC_PROGRAMMER` agent interface/registration and prompt assembly; programmer-only workspace dispatch | `DslRuleUtil` and shared schema/DSL execution implementations, exposed through the ontology facade |
| Java `PythonExecuteServiceImpl` process creation/wait/kill/temp-output logic and old `resources/python/query_runtime.py` launcher | Business result parsing/column handling and a thin HTTP execution client for all remaining Java callers |
| `SkillTools.executePythonFile` local ProcessBuilder | Existing Java skill selection until later agent migration, calling the runtime executor |
| `/dsl/execute`, `executeForABCProgrammer(userId,domainId)`, request-body `admin` shortcut; template/helper/proxy/permit-list references | Existing credential-authenticated executeV0/V1 routes for their unmigrated callers |
| Public `abc_programmer.md` and enterprise `abc_programmer.zh.md`; retired programmer-only example injection | Other generator prompts updated for the common Python protocol, without migrating those agents |
| `services/data-query/branches/abc-harness-{branch,stream,answer,diagnostics,markdown,payload,dataset}.ts`; exclusive imports/tests/polishing prompt/logging identifiers | Traditional `abc-tool`, static/hot branches, common SSE transport and common data projection utilities still consumed elsewhere |
| `harness` quality-check read through `/check/queryBySessionId-v2`, including its now-unused route after all v2 consumers switch | Traditional `/check/queryBySessionId`; V2 business QC logic and candidate-generation rules via the new trigger/read contract |
| Old external ask `/abcHarness` transport in public and enterprise skill distributions | Workbench-owned ask entry; ontology runtime manifest includes read tools only |

Do **not** delete `AgentWorkspaceServiceImpl` or `ABCHarnessFileTools` wholesale:
`MultiThreadAIChatService` still injects them into DSL, after-calculator, read/write
Function, MetricView, Action and dashboard generators. Remove their programmer
registrations/dispatch and rename the shared file tool to `AgentWorkspaceFileTools`
with all imports updated, so the surviving name describes its actual owner.
Their remaining Java workspace/test bookkeeping disappears when those consumers
migrate. Do not copy it into a second helper to make the old name disappear.

Likewise, program/source/description/check beans under `bean/abcHarness` are
shared by Functions, dashboards and QC. Remove task/message-only beans; retain
or move shared DTOs as one definition with every import updated. Removing an
entire package because of its historical name would delete retained behavior.

The enterprise implementation must update its authorization filters, query API
permissions, default permit-all entries and both language skill/prompt overlays.
A new grant-aware guard applies regardless of generic permit-all settings and
does not redirect code clients to a login page. Test the packaged configuration,
not just a developer `permit-all: /**`. Leave SecretCipher and unrelated identity
issues with their owners.

## Proof plan tied to completion conditions

The first segment was approved in 85a7296. Implementation validation uses
filtered Java tests, temporary PostgreSQL, local runtime/workbench processes and
a stock Linux Python container. The matrix distinguishes these checks from
controller-owned real image/full-stack acceptance; exact logs are in the batch
worktree notes. No static Dockerfile check substitutes for a build.

| Requirement / concrete failure | Evidence in the allowed implementation worktree | Controller acceptance |
| --- | --- | --- |
| Only one owner of wire shape; null-filled real config/specs rejected accidentally | Contract typecheck/lint; shared JSON fixtures with nullable description/sample/value/classNames, empty result, missing required keys, malformed envelopes and partial zero rows | Real Java metric/knowledge/spec response through the full stack |
| Credentials can be overridden or escape to ordinary tools | Java boundary tests with actual HTTP guards; forged/expired/revoked/cross-domain/run/purpose grants; body IDs rejected; ordinary external/API key cannot issue E; sibling process/env/file negative cases | Same probes in the actual runtime image and enterprise configured filter chain |
| Formal results reuse unauthorized exploration rows | Real process: exploration sees a superset; fresh final workspace/query sees user rows, masks columns; changed permissions affect final run; missing sources and changed code receipt rejected | Restricted user plus Python post-calculation question |
| Read binding can reach write or raw-query actions | Read/explore credentials rejected at every write/action/grant path; read facade rejects unsupported DSL constructs before execution | Actual configured network and endpoint policy, no localhost/bypass route |
| Whole-process cancellation and isolation | Real Python descendant, CPU/memory/output/time pressure; private-file boundary probes; kill supervisor then restart; assert no live orphan and no replay. Non-Linux missing isolation must fail closed | Linux image UID/rlimit/process-tree proof; native developer path selected in R1 |
| Partial status lost in a row-only helper | Real helper call with complete, partial, empty-partial and error responses; independent next run; final status taken only from final run | A real adapter partial result retained through history/download |
| Retry repeats admission/output/QC side effects | PostgreSQL plus local model/Java fixtures; drop real HTTP responses after acceptance, recover identical IDs; changed payload conflicts; unknown outcome does not replay | Real stack interruption/restart and recovered query facts |
| Needs-input loses identity or assumes an answer | API roundtrip for reply/change/no reply/non-interactive, same session/new run, stale revision rejection, preserved partial artifacts | Public ask continuation; chat routing boundary per R4 |
| Dataset live/history/download disagree | One typed projection tested from an actual committed runtime artifact, including null/false/zero and partial markers | Browser table/history/download, no model-regenerated rows |
| Java Python callers stranded | Each row in caller table reaches runtime HTTP; no Java ProcessBuilder for Python; Function read/write + parameters, traditional cached-input after-calculation and skill-package invocation | Main-directory complete stack including traditional mode and retained MCP |
| QC blocks completion or duplicates candidate generation | Hold fake checker; answer settles first; duplicate trigger returns same job; late result attaches only to original dataset IDs; cancellation/restart unknown stays non-replayed | Real Java descriptions/score/fitted question/candidate semantics |
| Packaging contains unresolved dependencies or notices | Build-script/dependency/notice-generation checks, without claiming an image exists | Actual runtime image build/import/execute; four-image stack smoke; measured size/licenses |

Main-directory builds, full-stack live-model questions, runtime restart/browser
checks and the authorized remote benchmark belong to the controller. This worker
does not run them here. No remote baseline is refreshed in this segment and no
35-question score threshold is invented. The known baseline Java SecretCipher
startup defect must be reported if it blocks tests; this batch does not fix it.

## Controller decisions (2026-10-28)

R1 accepted: use the explicit first-release UID/rlimit boundary
in the code contract. No bubblewrap/cgroups or silent production fallback.
Native developer mode is deliberately weaker and emits a startup warning.

R2 accepted exception: all business program execution moves to runtime; the
traditional MCP calculator and startup Python remain until traditional ABC/MCP
cleanup. The package does not yet contain just one Python installation.

R3 accepted: all current generators adopt the new protocol; published Functions
using it must work. Old-protocol stored programs fail with a readable migration
error. Stored Function/dashboard conversion belongs to the pre-release data
migration. No loopback proxy, monkey patch or guessed program rewrite.

R4 accepted: public API/ask support same-session replies. The abc branch preserves
a structured needs-input outcome and reference; automatic routing of the next
chat message belongs to batch 3.

Shared Java file tools are renamed accurately and retained for the unmigrated
consumers, without copying their implementation. SecretCipher remains outside
this batch. Main-directory image/full-stack and remote acceptance remain with
the controller.


Network clarification: code provides no network isolation. Preserve connections
to PostgreSQL, workbench callbacks, ontology, model providers and configured
external MCP. Python/skills can reach container-reachable addresses. This batch
adds no egress proxy/firewall; deployment network policy owns site allowlists.
Namespaces, process-level egress and aggregate resource limits remain follow-up
work. Darwin/Windows development mode has the limits stated in the code contract.

The retriever retains the previous programmer's `coding` model role. Knowledge
retrieval can use Embedding; metric catalogue lookup is bounded SQL over published
read Functions, with nullable source fields preserved. Callback credentials are
short-lived encrypted delegations scoped to a route and run; the workbench
recovers the original user credential using its service key, then the normal
identity provider verifies it. The runtime supervisor is trusted and already
holds that shared host key; workers receive neither the key nor a plaintext
user credential. The runtime treats the delegation as opaque bytes.

Parent cancellation closes a workbench admission gate and runtime run creation
intent; Java output/QC cancellation also closes not-yet-admitted jobs. No late
response is replayed into a second execution. Same-session continuation injects
effective decisions, prior authorized artifact references and prior successful
source files, with fresh credentials and a new execution workspace.
