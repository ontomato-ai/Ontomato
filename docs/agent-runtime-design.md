# Agent runtime: batch 0 contract and batch 1 design

The runtime process and governance HTTP consumer are implemented in this branch; local-launcher and deployment distribution wiring remain pending a packaging decision. This is not a completed deployment or whole-batch acceptance. The schemas live in `packages/contracts/src/agent-runtime*.ts`; their [wire semantics](../packages/contracts/agent-runtime.md) define admission, recovery, skills and business write closure. Governance-specific shapes remain in `knowledge-governance.ts`. Batch 1 is authorized; the reviewed corrections make artifacts opaque, omit unused single calls and transmit message deltas without cumulative partials.

## Ownership and placement

- `packages/agent-runtime` owns HTTP, the PI loop fork, PostgreSQL sessions/messages/events/artifacts, compaction, model calls, workspace files and skill processes. It imports contracts and infrastructure libraries, never a host implementation. It has no business completion or authorization decisions.
- `apps/agent-runtime` assembles the public standalone Node process. Enterprise deployment uses this same application. There is no enterprise runtime application: translated governance prompts and business identity checks belong to the enterprise workbench, not the runtime. The temporary model-read service header is configuration, not a reason for a second implementation.
- The workbench owns governance permissions, definitions/prompts, business records and browser projection. It uses runtime HTTP exclusively. Browsers connect to the workbench. The ontology service owns ontology/knowledge data and its authorization.
- The public application runs as a separate Node process with its own database connection/schema. Products must supply AGENT_RUNTIME_SERVICE_TOKEN and its corresponding runtime host configuration. Local launcher, container, image-publication and deployment-tool wiring are still pending; existing deployment templates must not be presented as ready for this branch.

## PI fork and message persistence

Use exactly `@earendil-works/pi-ai@1.3.0`, without forking it. Fork the needed `pi-agent-core@1.3.0` loop source under `packages/agent-runtime/src/core/`, retaining the MIT copyright/license and a source/version/change note. The fork was extracted from the installed package's published source maps; `packages/agent-runtime/src/core/pi/UPSTREAM.md` records the source hashes and local adaptations. The full MIT license is retained there and listed in the repository NOTICE.

The fork changes are awaited journaling, event sequencing, compaction/context preparation, child-process skill execution with private bindings, artifact registration and cancellation/terminal handling. The first governance tool batch executes sequentially to preserve its existing ordered reads/writes. This is not a model-concurrency quota or a run budget. Do not migrate LangChain or old business callbacks into the new loop.

## Governance: eight workbench tools and the context skill

| Tool | Actual source / business owner |
| --- | --- |
| `search_history` | Workbench checkpointer thread listing and shared history payloads; governance's existing same-domain cross-user evidence permission |
| `read_history` | Workbench history service; records its source in the governance run |
| `read_evidence` | Workbench diagnostic manifest/file reader, with thread/workspace domain checks |
| `read_work_record` | Workbench governance run's saved work |
| `update_work_record` | Workbench governance progress/issues/sources; never production ontology/knowledge/data |
| `read_knowledge` | Workbench calls ontology `POST /admin/getBussinessKnowledge`, then registers sources and knowledge count before returning |
| `read_ontology` | Workbench calls ontology `GET /admin/getSchema`, then registers sources before returning |
| `collect_turn_artifacts` | Workbench diagnostic workspace builder; may recreate files, so an unknown result must not be replayed |

Both ontology-backed reads remain **workbench governance skills**. Ontology data ownership and authorization stay in the ontology service; source registration is a governance business fact. Fetch before taking the short business transaction, then check write ownership and persist sources/count in that request. Do not reconstruct or backfill source registration asynchronously from runtime event history. History/evidence source registration uses the same gate. Character pagination, source identities, issue upserts, reviewed-ID unions and source-reference validation retain their current semantics.

The workbench's fixed-version context entry replaces `beforeTurn`. Governance can use an empty definition base prompt and return its existing fully rendered `main/system.md` in the context section, preserving the template without duplicating its stable instructions. Before every conversational model request, including the first, it reads the saved current run work and renders the current progress using the host-selected language. The runtime replaces the named context section, then computes compaction budget including system instructions and tool definitions (retain the existing 80% window policy). It does not accumulate stale progress or understand GovernanceWork. Failure does not reuse old progress. Compaction calls use the host-rendered instructions, prepending the existing `<conversation>` and optional `<previous-summary>` blocks, and do not recursively invoke the context skill. English/Chinese template assembly remains with the public/enterprise workbench.

The approved write boundary is **workbench gate closure**: new-round opening closes the preceding gate atomically; cancel closes before calling the runtime; observing a terminal closes before publishing a business terminal. Every write checks run ownership and the open gate in its commit transaction. Late writes after runtime termination but before host closure may still commit to that run alone. There is no host settlement handshake. The precise shapes and ordering are in the wire contract.

## PostgreSQL facts

Use the runtime's own connection/schema and migrations; no workbench JOINs or foreign keys across service-owned tables. Session/run data PKs/FKs and uniqueness include host/domain scope. Skill versions instead use their explicit namespace scope: provider packages are shared with authorized hosts, domain packages are limited to their domain, and only the configured publisher can register them. Use short transactions with no HTTP/model/tool work while holding a lock. A single runtime instance owns recovery in this first batch.

| Table | Facts / constraints |
| --- | --- |
| `admissions` | creation key, operation/target, non-secret fingerprint, resource reference, deletion tombstone; unique key per scope |
| `sessions` | ID, active/latest run IDs, next message sequence, timestamps; lock for admission/journaling/termination |
| `runs` | ID, session, full definition and exact immutable skill references, status, event-sequence reservation, correlation/language, timestamps, safe failure; at most one running run per session |
| `messages` | session message sequence, stable ID, run ID, PI JSON; append-only |
| `events` | run event sequence, timestamp, event JSON; durable lifecycle and tool states, no text/progress deltas |
| `compactions` | session/run, summary, covered-through message sequence, time; raw messages unchanged |
| `artifacts` | ID, run/tool call/output index, content, creation time; unique output position and immutable payload |
| `skill_versions` | namespace/name/version, publisher, digest, files/manifest; immutable content per version |
| `model_calls` | run, call index/purpose (conversation or compaction), API/provider/model, duration, token usage, correlation ID, result/error; no keys or full result logs |

Workbench-owned additions are the runtime session reference, writeRunId, and per-run governance work rows. They do not copy runtime execution status or message history. Model configuration remains **temporarily Java-owned**: the runtime reads `/businessConfig/getModelSettings` using the existing Node protocol, including the configured enterprise runtime-read header when needed. This is the explicit temporary exception to upward model-configuration access and ordinary credential-only-to-skills use. Do not import workbench-server to obtain it. Java stays the sole read/write source; no migration or dual write here. Missing role configuration fails with `RUNTIME_MODEL_NOT_CONFIGURED`, preserving the host's distinct localized explanation; it never falls back to another role. Remove this adapter when the model-key change is integrated and the later model-configuration ownership migration is approved. Workbench query mode/timeouts and ontology Embedding are not moved. Model retries include 429 and use the resolved configuration; conversation and compaction calls have separate records; transport retries are currently handled by pi-ai within a recorded call. No run budget or model-concurrency control is added.

## Replacement and proof boundaries

Batch 1 removes governance's direct `runAgentLoop`, `createHarnessRun`, local execution registry and `beforeTurn`; its Harness JOIN/lock/message access; and the `createGovernanceTools` in-process AgentTool path. Material/business services remain with their owner and are exposed through the governance skill HTTP callbacks. Diagnostic collection uses the diagnostic service rather than importing its legacy AgentTool wrapper. The governing HTTP client and projection replace the old governance path completely, including user-deletion cleanup and stream recovery.

Do not delete all of `core/agent-loop`, `harness-sessions`, the old skill executor or repository-wide LangChain in this batch: analysis/diagnosis and other deferred consumers still use them. They remain only for those consumers, with no governance fallback. The new runtime and migrated governance execution do not depend on LangChain. Old stored sessions require the later release migration; this batch does not silently dual-read old Harness storage.

The real-process integration suites use isolated PostgreSQL and a local HTTP model. They cover all eight tools, source/work persistence, context refresh and actual compaction; host restart while a model request is held; runtime restart; dropped admission responses; snapshot/tail loss; process-tree cancellation; closed/old gate rejection; unknown-side-effect non-replay; host/domain rejection; immutable skill versions; and live/history artifact identity. Governance Vue component tests cover reconnect snapshot replacement and preserved chat/report controls. These are mechanical proofs with fixture data, not live-model business quality or a deployed browser acceptance. Startup/deployment distribution and final whole-batch review remain open. No product image was built or deployed from the worktree.
