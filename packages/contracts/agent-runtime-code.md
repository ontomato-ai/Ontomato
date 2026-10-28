# Runtime code execution contract

This extends [agent-runtime.md](agent-runtime.md). Executable schemas live in
`src/agent-runtime-code.ts`. The runtime executes code and stores execution facts;
it has no ontology, metric, final-output, quality-check or parent-agent concepts.

## Private bindings

Each `privateContext.skillBindings[]` has its own opaque `credential`; there is
no global credential fallback. Governance uses the same binding contract.
`privateContext.modelCredential` remains only for the temporary Java-owned model
configuration adapter described in the runtime design. It never reaches workers.
A Python binding is required when `definition.builtinTools.python` is enabled.

```ts
type PythonBinding = {
  targetUrl: string | null;
  credential: RuntimeOpaqueCredential; // none, token, api_key or bearer
  context: JsonObject;
  libraries: {skill: RuntimeSkillRef; path: string}[];
  limits: {wallTimeMs: number; cpuSeconds: number; memoryBytes: number;
           processCount: number; fileBytes: number; outputBytes: number};
};
```

Only the trusted host sets this binding. `targetUrl` configures provider helpers;
it is **not** a network allowlist. A null target means no configured callback,
not absence of network. Libraries reference immutable registered package files;
no arbitrary host directory, URL or symlink is accepted. Each worker receives a
private read-only copy outside its writable workspace. Registry files remain
private to the runtime supervisor.

Credentials are excluded from fingerprints, PostgreSQL, messages and logs.
Non-secret bindings and source bytes participate in the canonical fingerprint.
A replay does not rotate an admitted execution's credentials. Exact secret echoes
in process output are rejected; this is not a defense against arbitrary encoding
or deliberate exfiltration by generated code.

## HTTP and built-in execution

Requests use runtime host/domain/correlation headers. Creation's UUID
`Idempotency-Key` is the execution ID. Admission keys are shared with session/run
admission and have the same scope, fingerprint, conflict and tombstone rules.
Workbench cannot read ontology-host executions, even in the same domain.

| Route | Result |
| --- | --- |
| `POST /v1/code-executions` | 202 `{execution,replayed}`; input `{language:"python",files:[{path,content}],entry,arguments:string[],outputPaths:string[],binding:PythonBinding}` |
| `GET /v1/code-executions/:id` | `{id,runId,entry,source,sourceSha256,status,createdAt,finishedAt,exitCode,outputs,error}` |
| `GET /v1/code-executions/:id/outputs/:name` | Raw UTF-8 stdout/stderr or requested file, scoped by host/domain |
| `POST /v1/code-executions/:id/cancel` | Terminal execution after process-tree termination; missing/foreign ID is 404 |
| `POST /v1/code-execution-intents/:id/cancel` | 204; closes this host/domain's creation intent, including before admission or after a lost response; a closed-before-admission key returns 410 on creation |
| `GET /v1/runs/:id/code-executions` | `{executions:[...]}` for the owned run, used to resume source work |

States are running → completed/failed/cancelled/interrupted. Exit 0 plus collected
outputs means completed, not valid business JSON. Resource limits, timeout,
nonzero exit and invalid paths fail explicitly. Java retains its business rule
that nonempty stderr rejects a program result.

`python_execute({path,arguments?:string[],outputPaths?:string[]})` snapshots the
run workspace into a fresh execution workspace and uses the same executor.
Its model arguments cannot select credentials, URLs, limits or host paths. The
result includes an execution ID, source digest, status and stdout preview; full
outputs are available through the HTTP API. Oversize transport output fails.
Workbench validates the same-run successful receipt and source digest before
accepting a Python submission. Changed code needs a new receipt.

`initialFiles` on run admission seeds workspace files for continuation; it is
part of the host request/fingerprint. The runtime does not interpret why those
files were selected. Standalone code execution needs no model session. Built-in
execution stores the owning run ID, so run cancellation also stops its code.

Admission is persisted before spawning. Terminal facts and output bytes are
stored together in PostgreSQL; scratch directories and private library copies
are removed after collection. History reads never execute code. Restart marks
unfinished work interrupted and does not replay it. A lifetime pipe kills POSIX
workers on supervisor death; production cancellation also kills descendants by
assigned UID, including descendants that left the original process group.
Disconnecting GET does not cancel. Intent closure prevents late admission after
an uncertain response. It cannot undo already accepted external actions.

## Approved first-release process boundary

Controller decisions, 2026-10-28: no bubblewrap, namespaces or cgroups. The Linux
production supervisor runs as root and assigns a distinct non-root UID/GID to
each worker. UID allocation is persisted in the runtime data root. Workspaces are
private; provider files are read-only to that worker. The launcher starts with
`-I -S`, installs rlimits before dropping groups/UID/GID, and disables privilege
escalation. Python and credential-bearing skills use this same launcher.
Production without Linux/root/UID switching fails closed with
`CODE_ISOLATION_UNAVAILABLE`; there is no silent fallback.

Limits cover per-process CPU/address space, per-UID process count, per-file size,
wall time and collected output bytes. They do not bound total workspace bytes
or aggregate descendant memory/CPU. The worker can read OS files allowed by Unix
permissions: this is not filesystem namespace isolation.

**Code provides no network isolation.** Python and skill processes can reach all
addresses reachable from the runtime container. Required connections include
PostgreSQL, workbench skill callbacks, ontology, model providers and configured
external MCP servers. This batch adds no egress proxy or host firewall. Site
allowlists are enforced by deployment network policies. Per-process network and
stronger filesystem/resource isolation remain follow-up work.

Native macOS/Windows uses the same execution path in explicit development mode
and logs its weaker isolation. UID switching is skipped; Darwin address-space
and shared-UID process limits are skipped, and Windows has no POSIX rlimits.
Wall timeout/output limits still apply. Windows uses a parent process handle and
taskkill for lifetime/tree termination; native Windows validation remains a
separate acceptance item. Development tests do not prove production isolation.

## Provider-owned Python helper

`agent-skills/ontomato-analyst/python/query_runtime.py` owns ontology HTTP and
partial-query metadata. Java publishes it as a provider library. Runtime code
imports no ontology implementation. Generated programs use:

```python
# ontomato-python:2
import json
from query_runtime import execute_dsl, parameters

rows = execute_dsl({"problem": "...", "answer": {"steps": []}})
print(json.dumps({"answer": rows}, ensure_ascii=False))
```

The helper sends `{dsl}` and its injected grant directly to the ontology facade.
Parameters come from `parameters.json`; user/domain are not command arguments.
`query-status.json` records partial inputs even after empty/aggregated results.
Each final execution creates its own marker; exploration metadata is not reused.
The helper is not a sandbox or proof of arbitrary program lineage.

Write Functions receive separately authorized sandbox-write grants. Their
handlers derive domain/sandbox from verified claims. Retrieval/user-read grants
cannot call those handlers. Old saved Function/dashboard protocols fail with a
readable conversion error; pre-release data conversion is outside this batch.
All current generators emit protocol 2. The traditional MCP calculator and its
startup Python environment remain until the traditional ABC cleanup batch; all
business program execution uses this runtime environment.
