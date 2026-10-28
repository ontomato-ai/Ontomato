# Unified service logging

Proposal, 2026-10-28, against public baseline `ba6acd1c`; no implementation is
included. The goal is to trace one business operation across workbench, ontology
and agent runtime using the same bounded service events in stdout, files and PG.
The [contract](../packages/contracts/service-logging.md) and its JSON resource own
format, query and propagation rules. Controller review precedes implementation;
image builds and full-stack acceptance remain controller-owned.

## Ownership and implementation

| Owner | Responsibility |
| --- | --- |
| `packages/contracts` | One language-neutral format resource, common fixtures and query contract; no logger or database dependency |
| New `packages/service-logging` | Both Node services share Winston construction, AsyncLocalStorage context, normalization and PG transport; no host implementation imports |
| `data-engine-core/logging` | Log4j2 context capture and one normalization/layout adapter reading the same packaged format resource |
| Each service's infrastructure | Its table, bounded PG connection, query and cleanup lifecycle |
| Applications/deployment | Service/instance identity, log directory and transport assembly; enterprise reuses public behavior |

Node uses Winston and `winston-daily-rotate-file`; the existing `createLogger`
entry can become a thin factory, but its custom Logger class and file transport
are removed. Its configured severity order comes from the contract. Java rewrites
each Log4j2 event once into bounded fields before
fan-out; one layout serves stdout/file, and JDBC column mappings consume those
same fields. Package the contracts JSON through Maven resources, as existing
skill resources are packaged. Shared fixtures check the two language adapters;
neither service owns an independent format specification. Allow only the new
lower-level logging package in the runtime's dependency rule.

Java uses mature Console/RollingFile plus nonblocking Async/JDBC appenders.
Node's small custom transport implements only bounded asynchronous PG batching,
not logging or rotation. Normalize before either queue so a large exception
cannot occupy unbounded queue memory. SQL accepts only parameters and fixed,
service-owned table identifiers. Log-read failures never become empty evidence.

## Storage and failure behavior

Tables are `workbench_service_log` in the workbench's configured schema,
`ontology_service_log` in the ontology database's schema, and
`agent_runtime_service_log` in the runtime's configured schema. They can share a
PG server but never a writer, a cross-service DAO or a shared business schema.
Each service creates only its new table; no old log/table conversion is included.

Common shape (expanded under the owner's qualified table name):

```sql
id uuid PRIMARY KEY,
time timestamptz NOT NULL,
level varchar(5) NOT NULL,
module text NOT NULL,
instance_id text,
correlation_id text,
domain_id text,
user_id text,
run_id text,
session_id text,
line text NOT NULL
```

Add B-tree indexes on `(time,id)`, `(correlation_id,time,id)`,
`(run_id,time,id)`, `(session_id,time,id)` and `(level,time,id)`; identity indexes
may omit nulls. Filtering fields are projections of the canonical event, not a
second unbounded message store. Persist milliseconds and enforce the contract's
line bound. No foreign keys tie retention to runs or audit records.

Use the service's existing database configuration through its infrastructure,
with one dedicated, lifecycle-managed logging connection so a slow sink cannot
consume the business pool. Bound acquisition and statement execution (proposed
1 s / 2 s). Node flushes up to 100 records at 1 s or batch-full; Java JDBC uses
100-record batches and Async's end-of-batch flush at low traffic. Each queue has
512 records, one batch in flight; Java Async is `blocking=false`. PG failure
drops the failed batch, full queues drop the incoming PG copy, and retries resume
after 5 s. No disk spool, replay or durable delivery promise. Rate-limit a
`logging` WARN with dropped counts to stdout/file only; do not feed sink failures
back into that sink. Shutdown drains for at most 2 s. Log-table creation and
cleanup failures disable only that sink; existing business DB startup requirements
are unchanged.

## Defaults proposed for controller decision

Values live in the shared JSON's `proposedDefaults`, pending review:

1. **Retention/capacity:** UTC daily rollover plus 50 MiB; 20 files including the
   active file per service/instance, about 1 GiB plus rollover/one-record overhead,
   uncompressed. Winston uses a stable audit file and `maxFiles: 20`; Log4j2 keeps
   19 archives globally, not 19 per date, through its Delete action. File retention
   is count-bounded, not a promised number of days: Winston's mature transport
   supports a file count **or** days, not both. Keep existing Compose
   `json-file`, `50m`, `5` (about 250 MiB/container). PG keeps 7 days of event time;
   hourly owner-local cleanup deletes expired rows in batches of 10,000, under a
   per-table advisory lock and short transactions. Continue batches until caught
   up; failures/timeouts resume on the next tick. This is a time policy, not a physical PG disk quota; ordinary
   autovacuum reuses deleted space. No partition manager or new scheduler.
2. **Audit:** keep Java `audit_log`, domain filtering, writers, failure semantics
   and current retention unchanged. It already belongs to ontology; renaming it
   or adding audit writers elsewhere is not needed for service logs. Operational
   seven-day cleanup must never touch it or runtime model/message tables.
3. **Correlation:** retain `X-Correlation-Id`; complete entry/async/outbound
   propagation rather than adding tracing infrastructure. Workbench currently
   generates a local request ID and some RuntimeClients generate fresh unrelated
   correlations. Java has no generic MDC ingress; `RuntimeCodeClient` sometimes
   substitutes session/execution IDs. Runtime already persists correlations and
   exports them to workers, but lacks service logging and initiating-user
   attribution. Add the contract's optional session/user headers, snapshot trusted
   attribution, capture Java executor context, and update retained skill clients.
   Never replace a grant's bound run ID with a logging ID.

## Replacement and acceptance

Remove Node `llm-logger`, `llm-log-serializer`, custom `log-file-transport`, model
factory/agent-loop logging wrappers and their dead tests. Remove diagnostic LLM
parsers/transcript builders and LLM-only routes/source choices. Remove Java
`AgentLlmCallListener`, dedicated agent/user-message/chat-error appenders and
`DiagnosticEventLogger`'s second JSONL channel; retained lifecycle events become
ordinary service logs. Remove full-result output in `HttpRequestUtil` and
`LogHelper`; surviving callers produce safe summaries. All Java levels and the
enterprise license logger use the common service outputs, without duplicate
per-level files. Runtime model-call/message persistence stays intact.

Retire `AgentCallContext`'s logging-only usage after moving surviving caller
context to the common mechanism. Remove `UserMessageUtil`'s payload logging, not
its still-used prompt/data-description functions; their business migration is
separate.

Replace the current application's JSONL parser and backend file-log query path
with service queries. Retained live-log UI adapts the common line once; no old/new
format guessing. Update existing diagnostic callers/consumers together, including
an observe-authorized runtime proxy, without moving the diagnostic agent in this
module. Preserve session-registry cancellation semantics. Full diagnostic
workspace/agent migration belongs to its separate module; do not add a new
archive reader or copy model transcripts to keep the old path alive. Existing
ops MCP shapes stay at their consumer boundary, adapted from the new queries.

Keep only regression contracts for shared line/UTF-8 truncation and correlation
across async boundaries; run affected typechecks and lint. Controller acceptance
runs one real query across three services and all three outputs, a large-result
query with no result rows in logs, a necessary oversized diagnostic text showing
head/tail and omitted bytes, plus a short PG-sink outage/recovery check. Acceptance
also covers existing live-log reading and enterprise image/stack assembly. Local
contract checks do not establish those runtime results.

Component references: [Winston](https://github.com/winstonjs/winston),
[DailyRotateFile](https://github.com/winstonjs/winston-daily-rotate-file),
[Log4j2 rotation](https://logging.apache.org/log4j/2.x/manual/appenders/rolling-file.html),
[Async](https://logging.apache.org/log4j/2.x/manual/appenders/delegating.html),
[JDBC](https://logging.apache.org/log4j/2.x/manual/appenders/database.html),
[Docker json-file](https://docs.docker.com/engine/logging/drivers/json-file/).
