# Configuration

- **Scope**: the current effective non-secret configuration exposed to operations diagnosis, and the configuration-owned dependencies that can explain a failure stage. No environment's current values are stored here.
- **Implementation source**: `packages/workbench-server/src/api/routes/ops-diagnosis.ts`, `packages/data-engine-core/src/main/java/io/ontomato/dataengine/controller/BusinessConfigController.java`, `service/impl/BusinessConfigServiceImpl.java`, and `config/BusinessConfig.java`.

## Role and Dependencies

- `ops.mjs config '{}'` reads the ontology service's `/businessConfig/getConfigAndDesc`. `data.config` is the diagnostic non-secret view; `data.desc` is the backend's own description of how configuration is read and takes effect.
- This view intentionally omits keys, passwords, raw headers, and model connection parameters. Model selection and embedding execution belong to the agent runtime; absence from this view is not evidence that a model is unconfigured.
- Domain business configuration owns the selected data adapter, its saved connection facts, optional multi-source routing, business-language settings, and query/knowledge parameters. The diagnostic view exposes only named non-secret fields, so connection correctness still needs an authorized connection test or a concrete query error.

## On-Site Evidence

- Treat the returned configuration as the effective fact of this read, not as a copy of a deployment template or another environment.
- Distinguish three states: configuration read failed, a needed value is not configured, and configuration was read but the dependent call failed. Record which stage produced the error.
- A suspicious value is only a candidate cause. Confirm it with the failing call, service logs, or an authorized management-page test.

## Deviation Propagation and Verification

- Configuration deviation can surface as adapter creation failure, data-source connection failure, business knowledge embedding failure, or query execution failure. Do not expand the cause beyond the stage evidenced.
- After an authorized change, first confirm that the effective value changed, then retest the original failing action. A successful connection test only proves that dependency can be reached; the original business link still needs separate verification.
