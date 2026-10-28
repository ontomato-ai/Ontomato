# Ontology AI runtime migration

Review proposal, 2026-10-28, based on public `cc5ac842` and enterprise `8e125bc`.
This submission changes documentation only. Wire boundaries belong to
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

## Remaining Java consumers

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

## Replace and delete together

| Remove | Retain or relocate |
| --- | --- |
| Workbench retrieval route/service/store, schema initialization, `data-retrieval`/`assistant-retrieval` runtime skills and retrieval prompts | Java retrieval owner; one analyst `ask`; assistant association/evidence only. See [retrieval design](data-retrieval-design.md). |
| `MultiThreadAIChatService`, `ChatAgent`, `ChatBaseAgent`, `NormalAgent`, `PythonAgent`, `ToolAgent`; `ChatConfiguration`, `ToolCallTokenCountEstimator`, `OntomatoHttpClientBuilder`, `AgentLlmCallListener` | PI execution/memory/transport. Preserve dependencies still needed by Embedding or general MCP. |
| Remaining 13 `@Tool` classes: schema, detector, DSL, sandbox, explanation, three program testers, workspace files and four submitters | Existing query APIs and scripts for missing business operations; runtime owns workspace files. No replacement submit protocol. |
| `AgentWorkspaceService`/implementation, Java agent/explanation files, dead skill-loading remnants, `JSONCorrector`/implementation, `UserMessageUtil`, `DASHBOARD_RENAMER` and retired prompts | Owned definitions/context builders. Move live `getOutputKeyDescriptionMDTable` to the output-format owner; keep DSL grammar/examples. |
| `MultiThreadAIChatService.rawErrorText` references | General error utility; update DSL, MySQL, PG, DuckDB, ES, Neo4j, SQL Server and enterprise M3. |
| Agent-specific context in `DiagnosticEventLogger` | Coordinate with the logging module; retain general diagnostics. Remove obsolete tests with deleted paths. |

The baseline has 13 tool classes, not the earlier 19. Traditional ABC/QC v1,
examples, calculator and startup Python are already removed. General Java MCP
management/calls stay. No old-data converter, dual reads, knowledge-governance
migration, runtime annotations or model-configuration ownership change.

## Sequence and review decisions

1. **Host foundation + retrieval:** client/proxy/gates, Java retrieval/resources,
   shared analyst CLI, assistant HTTP integration, and complete removal of old
   workbench retrieval. QC keeps its current Java implementation until slice 2.
2. **Remaining ontology AI:** migrate the consumer table, remove Java chat/tool
   machinery and update both editions. Stop for controller integration acceptance.

**D1: direct ask and parent cancellation.** Review the proposed
[caller scope](../packages/contracts/data-retrieval.md#assistant-caller-scope-proposed):
the same skill calls Java directly, while Java rejects admission after parent
closure. Recording children only after ask returns loses the admission race.

**D2: unsaved model testing.** `/businessConfig/testModel` tests request-supplied
configuration; runtime `StartRun` selects a stored role. Propose a request-scoped
model override on an ordinary test run, using the same runtime adapter and no
script environment change. Testing must not save configuration or change role
bindings. Review the wire addition before changing `agent-runtime`; no Java chat
fallback remains.

The same adapter must preserve surviving configured request/header behavior;
the baseline Java builder accepts more fields than runtime `model.ts` currently
projects (for example organization/project and custom headers). Account for these
at the model boundary, without moving configuration storage or retaining Java
transport. This is part of behavior preservation, not a new configuration system.

**D3: standalone deadline.** Propose the existing 600-second default for Java
retrieval; workbench retains its configured parent deadline and passes it through
the caller scope. Standalone ask will no longer read workbench configuration.
This behavior boundary needs review; no second configuration store is proposed.

After approval: relevant TS typecheck/lint, both Maven compiles, and focused
contracts for proxy shapes, closed gates/late admission, dataset provenance and
generation validation. Controller owns live Manager generation, internal/external
ask with continuation/cancel, main-directory runtime/data-engine images and
enterprise stack smoke. This documentation submission claims none of those checks.
