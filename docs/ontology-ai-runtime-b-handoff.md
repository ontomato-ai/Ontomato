# Ontology AI runtime slice B handoff

2026-10-29. Based on accepted slice A, public `f9877897` and enterprise `1dcfa49`.
Implementation is in the paired `feature/ontology-ai-runtime` worktrees. No push,
main-checkout change, image build or live-model acceptance was performed.

## Delivered

- Runtime definitions for Action generation/explanation (including existing
  save/import/re-explanation checks), Function generation/naming, MetricView
  generation/instantiation, business knowledge, program dashboards and QC v2.
- A standard `ontology-generation` skill and authenticated ontology operations
  for exact-source tests, source reads and Action sandbox fixtures/reset/query.
  Files replace Java submission tools. Receipts bind source, parameters and kind;
  settlement rejects cancelled, expired, failed or inherited deliveries.
- QC and Function candidates retain their existing business rules and records.
  The existing query job owns the background operation and guards saves against
  cancellation. Model work is performed by ontology runtime definitions.
- Runtime `/v1/models/test` contract and Java delegation, with shared provider
  parameter/header mapping, one request, no stored draft/run and no retries.
- Java chat interfaces/client/memory/listener, JSON repair, old submission tools,
  agent workspace and skill-copy startup paths removed. Driver error formatting
  and output-key Markdown formatting now have independent owners.
- English and Chinese ontology prompts moved to their resource owner; both image
  context manifests include the shared skill source.

Per controller decision, Java Embedding and general enterprise MCP keep their
existing LangChain dependencies. There is no remaining direct Java chat-model
call. Historical backend model-log readers remain to read existing log files.

## Verification

All listed checks passed. The database suites used disposable local databases or
schemas; no customer or remote environment was used. Runtime/model tests use a
local provider fixture, not a real model.

| Working directory | Command | Result |
| --- | --- | --- |
| public | `pnpm typecheck:workbench` | pass |
| public | `pnpm typecheck:runtime` | pass |
| public | `pnpm lint:workbench` | pass |
| public | `pnpm lint:scripts` | pass |
| public | `pnpm exec eslint packages/agent-runtime` | pass |
| enterprise | `pnpm typecheck` | pass |
| enterprise | `pnpm lint` | pass |
| public | `mvn -q -DskipTests compile` | pass |
| enterprise | `mvn -q -DskipTests compile` | pass |
| public | `node --test scripts/ontology-generation.node-test.mjs` | 3 pass |
| public | `pnpm --filter @ontomato/agent-runtime exec vitest run src/__tests__/model.test.ts` | 8 pass |
| public | `mvn -q -pl packages/data-engine-core -am -Dtest=OntologyGenerationContractTest,OntologyRetrievalContractTest,QueryRuntimeBoundaryTest,BusinessConfigControllerModelKeyWriteOnlyTest -Dsurefire.failIfNoSpecifiedTests=false test` | 24 pass, none skipped |
| public | `mvn -q -Dtest=OssStartupAssemblyTest -Dsurefire.failIfNoSpecifiedTests=false test` | 3 pass, including isolated full Spring context |
| enterprise | `mvn -q -Dtest=EnterpriseStartupAssemblyTest,SystemConfigAccessGuardTest -Dsurefire.failIfNoSpecifiedTests=false test` | 12 pass, including isolated full Spring context |

Database contract suites require `RUNTIME_TEST_DATABASE_URL`; startup suites
require `STARTUP_TEST_DATABASE_URL` pointing at a disposable local pgvector
PostgreSQL server. Surefire XML reports are under each tested module's
`target/surefire-reports`. The startup probes supply fake local runtime/MCP
endpoints and are component assembly evidence only.

No new product decision is pending. The controller still owns main-directory
real-model checks for every Manager entry, cancellation, retrieval continuation,
image builds and enterprise stack acceptance. Model-configuration ownership and
knowledge governance remain separate work.
