# Services

- **Scope**: the browser, workbench Node service, ontology service, agent runtime, PostgreSQL, external data sources, and log evidence that diagnosis commonly depends on. This file does not describe any deployment's topology or current state.
- **Implementation source**: `packages/workbench-server/src/api/routes/ops-diagnosis.ts`, `packages/workbench-server/src/platform/diagnosis/observe/service-logs.ts`, and `packages/workbench-server/resources/runtime-skills/ops-diagnosis/SKILL.md`.

## Operating Model

- The browser talks to the workbench. The workbench owns product conversations and diagnosis evidence entry points, and starts model-tool runs in the agent runtime.
- The ontology service owns ontology metadata, business data permissions, DSL execution, retrieval orchestration, formal dataset execution, and business knowledge search. PostgreSQL stores platform and ontology facts such as `json_rule` and knowledge rows.
- External business data is read through the configured data adapter. A healthy ontology process does not prove that the configured source is reachable or that a query is legal for that source.

## On-Site Evidence

- `ops.mjs health '{}'` returns the ontology maintenance endpoint's process and host-resource view. It is not a whole-deployment health verdict and does not cover the workbench, agent runtime, PostgreSQL, browser, or external data source.
- `ops.mjs logs ...` reads service logs independently for `workbench`, `ontology`, and `agent-runtime`. PostgreSQL-backed log reading is best-effort and subject to retention; empty logs do not prove that no execution happened.
- `ops.mjs resolve`, `run`, and `artifact` establish the runtime facts of the target before selecting log windows. Tool or evidence-read failures must be distinguished from business query failures.

## Deviation Propagation and Verification

- Locate the earliest unavailable dependency instead of treating the final page wording as the root cause. Loss of log evidence only degrades diagnosis; it does not by itself prove the business link failed.
- After service recovery, rerun the minimal original action and confirm both the user-visible result and the required evidence. “Container or process is up” is not proof that the business link recovered.
