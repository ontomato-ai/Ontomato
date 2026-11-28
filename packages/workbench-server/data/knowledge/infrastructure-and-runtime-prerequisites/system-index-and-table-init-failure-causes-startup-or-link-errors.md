# System Index and Table Initialization Failure Causes Startup or Link Anomalies

- **Scope**: ontology service startup, PostgreSQL initialization, and the metadata tables required by query and knowledge links.
- **Mechanism source**: DAO startup initialization such as `packages/data-engine-core/src/main/java/io/ontomato/dataengine/dao/JSONRuleDao.java` and `dao/KnowledgeDao.java`.

## Symptoms

- The ontology service fails during startup or exits before it can serve requests.
- The service starts, but metadata reads, query execution, or business knowledge operations fail because required rows or tables are absent.

## Possible Causes

- PostgreSQL is unreachable or the schema/database is wrong while DAO startup initialization is creating required tables. Several DAOs execute `CREATE TABLE IF NOT EXISTS` in `@PostConstruct`; an uncaught failure prevents the Spring bean from starting.
- `json_rule` exists but has no usable content for the domain. Query metadata, permission visibility, DSL validation, and retrieval scope all depend on it.
- The pgvector extension creation failure is handled as a warning in `KnowledgeDao`; do not treat that warning alone as proof of startup failure. Confirm the actual first exception.

## Verification and Localization

1. Read ontology startup logs and identify the first initialization exception, not the last downstream error.
2. After startup, read current metadata with `ops.mjs metadata '{"format":"json"}'` and confirm whether the domain has a non-empty `classDef` and the expected relationship definitions.
3. `ops.mjs health '{}'` can only report a process that is already running; absence of health evidence is not proof of which initialization step failed.
4. Manual DDL or data repair is a privileged recovery action, not a diagnostic conclusion. Confirm the root cause and obtain authorization before any mutation.

## When to Exclude

- The service is healthy and only one class, field, or relationship is missing — use the metadata entries instead.
- Workbench, agent runtime, or browser failure while ontology startup logs are clean — use [Services](services.md).
