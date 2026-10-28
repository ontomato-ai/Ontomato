# Standalone code execution contract

Implemented contract, 2026-10-28. This supersedes the former Python built-in
binding contract; schemas and Java consumers use this shape together.
[Runtime contract](agent-runtime.md) owns authentication, admission, file storage
and agent state. This endpoint remains for published Functions and authorized
formal-output reruns. An agent uses PI bash to run Python; it does not call this
endpoint as a special model tool.

## HTTP shape

All operations require runtime host/domain/correlation headers. A UUID
Idempotency-Key is also execution ID. Same semantic input replays that execution;
changed input conflicts; an intent tombstone rejects late admission. Cross-host
or cross-domain access returns 404. The ontology host retains its own principal.

```ts
type ExecuteCode = {
  language: "python"; locale?: string; // defaults to en
  files: {path:string; content:string}[];
  entry: string; arguments: string[]; outputPaths: string[];
  libraries: {skill: SkillRef; path:string}[];
  environment: {values:Record<string,string>; secrets:Record<string,string>};
  limits: CodeLimits;
};
type Execution = {
  id: UUID; status: "running" | "stopped";
  entry: string; sourceSha256: string;
  createdAt: string; finishedAt: string | null;
  exitCode: number | null; errorMessage: string | null;
  outputs: {name:string; sha256:string; size:number; mediaType:string}[];
};
```

| Route | Result |
| --- | --- |
| POST /v1/code-executions | 202 `{execution,replayed}` |
| GET /v1/code-executions/:id | Execution metadata |
| GET /v1/code-executions/:id/outputs/:name | Raw authorized stdout, stderr or requested file bytes |
| POST /v1/code-executions/:id/cancel | Execution after process-tree termination |
| POST /v1/code-execution-intents/:id/cancel | 204 even before admission |

A standalone process has no PI assistant message, so it has no invented
stopReason. running/stopped is process lifecycle; exitCode + errorMessage records
its actual result. Successful execution requires stopped, exitCode 0, no execution
error and successfully collected outputs. Java retains its business rule that
nonempty stderr rejects a program result. Cancellation, startup recovery, timeout
or collection failure set errorMessage; when no exit was observed exitCode is
null. None re-executes a previous request. Delete the agent-only
`GET /v1/runs/:id/code-executions`, python_execute and Python receipt requirement:
bash is the agent's execution path, with file snapshots as its evidence.

## Files and process ownership

Admission persists before spawning. Each standalone execution gets a temporary
workspace and a distinct UID; it never borrows an agent session's UID/workspace.
Resolve provider library names to immutable digests at admission, then copy them
read-only. Reject path traversal/links and missing files. The environment follows
the run contract and documents the same helper variables used in external agents.
The generic runtime does not interpret grants, source metadata or business JSON.

Collect source, stdout, stderr and requested output bytes through the runtime's
ArtifactFiles interface into content-addressed blobs. PG stores source/output
references, digests, sizes and execution metadata, not file contents. Keep raw
output GET behavior for Java while changing its storage underneath. Complete
collection before committing stopped, and remove scratch only after persistence.
History reads do not rerun a program. A lost response reconciles the original ID.

Retain the existing worker-launch.py privilege drop, rlimits, lifetime pipe and
process-tree termination. Production requires Linux/root supervision and a
non-root worker UID; otherwise fail closed. Kill escaped descendants by owned UID
as well as process group. UID allocations survive restart and are not recycled
in this batch. Native developer mode explicitly skips UID isolation and logs that
fact; Darwin/Windows retain their existing reduced resource-limit behavior.
No namespace/cgroup/egress implementation is introduced. Unix-readable OS files
and container-reachable network remain accessible under the approved boundary.

Limits retain per-process CPU/address space, per-UID process count, per-file
size, wall time and output collection size. They are not aggregate memory/CPU or
total workspace quotas. Network reachability is deployment-owned. Production
image proof and native developer proof must be reported separately.

## Ontology helper and retained consumers

`agent-skills/ontomato-analyst/python/query_runtime.py` remains the single
ontology HTTP helper source. Both bash exploration and Java code execution load
that same file; packaging copies it without changing behavior. It reads
`ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_QUERY_TK` (falling back to `ONTOMATO_TK`),
`ONTOMATO_RUN_ID`, `ONTOMATO_CORRELATION_ID`, `ONTOMATO_LANGUAGE`;
`ONTOMATO_QUERY_RUN_ID` optionally carries an existing parent query grant binding
for nested metric executions (the runtime execution ID itself is unchanged); sends the token
as `tk` and the run header; and retains parameters.json and query-status.json.
Java's grant parser must accept the documented tk header for its existing signed
grants and verify the same claims. Ordinary tk authorization remains unchanged.

```python
# ontomato-python:2
import json
from query_runtime import execute_dsl, parameters
rows = execute_dsl({"problem": "...", "answer": {"steps": []}})
print(json.dumps({"answer": rows}, ensure_ascii=False))
```

Final execution starts with a fresh query-status marker and authorized queries;
it does not inherit exploration outputs/completeness. Preserve zero-row partial
results, null/false/zero and parameters. Write Functions keep their separately
authorized sandbox-write grants and current handlers; retrieval cannot grant
itself write permission. Protocol-2 generators, published Functions, dashboards,
traditional after-calculation and Java skill Python callers all continue through
this endpoint. Their adapters change wire shape together. The traditional MCP
calculator/startup Python exception remains until its own cleanup batch.
Old saved Function protocols still require the release migration; no fallback
executor or guessed source conversion is added.
