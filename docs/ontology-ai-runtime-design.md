# Ontology AI runtime migration

Slice A implemented, 2026-10-29, following controller review of the 2026-10-28
design (public baseline `cc5ac842`, enterprise `8e125bc`). Slice B remains pending
until the controller accepts and merges A. Wire boundaries belong to
[ontology AI](../packages/contracts/ontology-ai.md) and
[retrieval](../packages/contracts/data-retrieval.md).

Run ontology-owned AI on the standard harness, with retrieval as its first
consumer, while preserving generation, authorization and saving behavior.
Workbench ceases owning retrieval; ontology never calls workbench to do its work.

## Ownership and placement

| Owner | Change |
| --- | --- |
| Java runtime client | Extract transport/configuration from `RuntimeCodeClient` into one `AgentRuntimeClient`. Add sessions/runs, SSE, immutable files and skill publication; standalone code execution uses the same transport. Reuse `AGENT_RUNTIME_ONTOLOGY_TOKEN`. |
| Java ontology AI host | Own authenticated user/domain session indexes, definitions, admission intents, business write gates and result references. Implement `agent-host` at `/ontology/ai`; no second transcript, event journal or file body. |
| Java retrieval service/DAO | First host consumer: replace workbench orchestration/store; own input, continuation decisions, rounds, deadlines, receipts and dataset references. Call existing query/grant/formal-output/QC services locally. |
| Existing Java business services | Keep Action, Function, MetricView, knowledge and QC rules; request ordinary runs and consume their files. Keep Embedding and model configuration storage. |
| Workbench assistant | Keep parent association, assistant evidence and copied-file provenance. Read/cancel retrieval through ontology HTTP, never its tables or runtime service key. |
| Manager/shared shell | Preserve generation controls/result forms. The proxy supports `agent-shell-ui` directly; no Manager shell redesign in this module. |

Host indexes use runtime UUIDs; business operations reference them. Shared Java
admission/observation serves retrieval and generators, without another agent loop.
Definitions/prompts belong to ontology resources: public English and enterprise
Chinese overlays. Standard skill sources are also distributed externally; resource
packaging copies them instead of maintaining another script implementation.

The parallel domain-skills change adds `AgentHostRun.resolvedSkills` as
`RuntimeRegisteredSkill[]`. Project the runtime's admitted namespace/name/digest/
description unchanged. Integrate the authoritative shared schema when merged;
do not create a Java-specific substitute or read the current publication instead.

## Remaining Java consumers (slice B)

| Consumer | Destination; retained behavior |
| --- | --- |
| Action generation/explanation | `coding` definitions; sandbox tests, parameter/class checks, explanation-to-code matching, import/sync requirements and persistence flags. |
| Function generation/static naming; MetricView generation/instantiation | `coding` definitions; read/write distinction, source fields, bindings, candidate/publication rules and current execution. No MetricView remodel. |
| Knowledge generation | `query` definition; validated file feeds existing nonempty candidate replacement and Embedding. |
| QC v2 description/scoring and Function candidates | Definitions with current roles; preserve asynchronous QC storage, score/candidate rules and cancellation. |
| Program-to-dashboard | `coding` definition; existing program tests/result assembly. |
| Unsaved model test | Runtime model adapter; request-scoped model selection needs D2 below. Embedding tests remain in Java. |

Read/test operations become standard ontology skill commands. Files replace
submission-tool side effects; Java validates exact output bytes before its
existing save. Common Markdown instructions come from contracts, including Java
resource generation from that same source.

## Replacement inventory

| Remove | Retain or relocate |
| --- | --- |
| Workbench retrieval route/service/store, schema initialization, `data-retrieval`/`assistant-retrieval` runtime skills and retrieval prompts | Java retrieval owner; one analyst `ask`; assistant association/evidence only. See [retrieval design](data-retrieval-design.md). |
| `MultiThreadAIChatService`, `ChatAgent`, `ChatBaseAgent`, `NormalAgent`, `PythonAgent`, `ToolAgent`; `ChatConfiguration`, `ToolCallTokenCountEstimator`, `OntomatoHttpClientBuilder`, `AgentLlmCallListener` | PI execution/memory/transport. Preserve dependencies still needed by Embedding or general MCP. |
| Remaining 13 `@Tool` classes: schema, detector, DSL, sandbox, explanation, three program testers, workspace files and four submitters | Existing query APIs and scripts for missing business operations; runtime owns workspace files. No replacement submit protocol. |
| `AgentWorkspaceService`/implementation, Java agent/explanation files, dead skill-loading remnants, `JSONCorrector`/implementation, `UserMessageUtil`, `DASHBOARD_RENAMER` and retired prompts | Owned definitions/context builders. Move live `getOutputKeyDescriptionMDTable` to the output-format owner; keep DSL grammar/examples. |
| `MultiThreadAIChatService.rawErrorText` references | General error utility; update DSL, MySQL, PG, DuckDB, ES, Neo4j, SQL Server and enterprise M3. |
| Agent-specific context in `DiagnosticEventLogger` | Coordinate with the logging module; retain general diagnostics. Remove obsolete tests with deleted paths. |

Slice A removes the workbench retrieval row above. The Java generator/tool rows
remain for slice B. The baseline has 13 tool classes, not the earlier 19. Traditional ABC/QC v1,
examples, calculator and startup Python are already removed. General Java MCP
management/calls stay. No old-data converter, dual reads, knowledge-governance
migration, runtime annotations or model-configuration ownership change.

## Sequence and review decisions

1. **Host foundation + retrieval:** client/proxy/gates, Java retrieval/resources,
   shared analyst CLI, assistant HTTP integration, and complete removal of old
   workbench retrieval. QC keeps its current Java implementation until slice 2.
2. **Remaining ontology AI:** migrate the consumer table, remove Java chat/tool
   machinery and update both editions. Stop for controller integration acceptance.

**Approved D1:** the [caller scope](../packages/contracts/data-retrieval.md#assistant-caller-scope)
is implemented. Workbench stores only its parent-run/scope association; the shared
skill calls Java directly and Java rejects late admission after scope closure.
`ONTOMATO_TK` remains the current user credential.

**Approved D2 (slice B):** unsaved model testing is a runtime model-gateway API:
receive the candidate configuration, make one minimal request through pi-ai and
save nothing. Java's model-test endpoint will delegate to it. This is not an agent
run or a model override on StartRun; the same API remains when model configuration
moves to runtime. Preserve surviving configured request/header behavior in that
adapter without retaining Java chat transport.

**Approved D3:** Java owns the independent retrieval default and maximum of 600
seconds. Requests can shorten it; workbench supplies its remaining parent deadline.
Standalone ask never reads workbench domain configuration.

A verification covers TS typecheck/lint, both Maven compiles and focused contracts
for Java/common host projection, concurrent matching admission, closed gates,
continuation, immutable dataset provenance and shared analyst scripts. Main-directory
live-model assistant/external ask, continuation/cancel, runtime/data-engine images
and enterprise stack/registry smoke remain controller-owned. A is handed over
before starting the remaining Java AI consumers in B.
