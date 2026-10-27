# Runtime code execution contract — batch 2 review draft

This adds a generic execution capability to [the runtime contract](agent-runtime.md).
It does not add model calls without an agent, ontology semantics, formal-output
flags, parent agents or dataset parsing. The isolation deployment decision is
still subject to the review in [the design](../../docs/data-retrieval-design.md).

## Private bindings

Replace the single shared `privateContext.credential` with a required opaque
credential on each `skillBindings[]` entry. Migrate governance's sole binding in
the same change; do not keep a global fallback. Introduce a Python binding only
when `definition.builtinTools.python` is enabled. The credential union gains an
opaque bearer variant; the runtime never parses its claims.

```ts
type PythonBinding = {
  targetId: string | null;
  credential: RuntimeOpaqueCredential;
  context: JsonObject;
  libraries: {skill: RuntimeSkillRef; path: string}[];
  limits: {wallTimeMs: number; cpuSeconds: number; memoryBytes: number;
           processCount: number; workspaceBytes: number; outputBytes: number};
};
```

`targetId` names a runtime-configured HTTP egress target authorized for the
authenticated host; the model cannot supply a URL or proxy address. It includes
an origin and allowed methods/paths. Only the host selects the binding. A null
target gives no network, for pure calculations. Libraries reference immutable
registered package bytes under approved paths; arbitrary host directories,
URLs and symlinks are not accepted. This permits an ontology-owned Python helper
without importing ontology code into `packages/agent-runtime`.

Per-binding credentials are absent from admission fingerprints, PostgreSQL,
messages, events and logs, as in batch 1. Non-secret limits, targets, library
digests and binding context remain in fingerprints. A replay never changes an
admitted execution's credentials. Missing credentials after restart cannot be
invented or restored from a persisted request body.

## HTTP and built-in execution

Code execution has real callers in this batch: ontology-owned read/write Function
execution and the remaining Java Python calculation consumers. It is distinct
from the rejected unused single-model-call API in batch 1.

All routes use existing runtime host/domain/correlation headers. A creation
`Idempotency-Key` UUID is the execution ID. The same scope, tombstone, 404,
fingerprint and unknown-outcome rules used by run admission apply. A runtime
host may only read/cancel its own executions; workbench cannot look up ontology's
executions even in the same domain.

| Route | Contract |
| --- | --- |
| `POST /v1/code-executions` | 202 `{execution,replayed}`; input `{language:"python",files:[{path,content}],entry,arguments:string[],outputPaths:string[],binding:PythonBinding}` |
| `GET /v1/code-executions/:id` | Execution snapshot with source/file digests, state, exit code, timestamps and immutable output references |
| `GET /v1/code-executions/:id/outputs/:name` | Raw UTF-8 stdout/stderr or explicitly requested output file; no host filesystem path |
| `POST /v1/code-executions/:id/cancel` | Terminal snapshot after the owned process tree is stopped |

States: running → completed/failed/cancelled/interrupted. Nonzero process exit,
deadline, resource limit, invalid output path or unsupported isolation fails
execution with a stable code. `completed` means exit 0 and collected outputs;
it does not mean valid business JSON. stderr is an output stream: Java preserves
its current rule that nonempty stderr rejects a program result.

The model-visible built-in is `python_execute({path,arguments?:string[],
outputPaths?:string[]})`. It snapshots that run's source files using the existing
workspace path resolver and invokes the same executor. It has no credentials,
host paths, target, permission mode or resource-limit arguments. Its receipt has
`executionId`, source SHA-256, exit outcome and bounded stdout/stderr views with
full output references. The runtime stores full output once, outside messages;
oversize output is an explicit execution failure. Workbench submission verifies
the receipt belongs to this run, succeeded, and has the same source digest. A
DSL test cannot satisfy a Python test receipt. A file change invalidates its
prior receipt; no mutable 'last test passed' value supplied by the model.

Standalone HTTP code executions have no model session or fabricated tool call.
Built-in executions have the owning run ID in runtime storage, so run cancellation
and restart cleanup include them. The workbench separately tracks ontology
output submissions and cancels their executions through Java. No cross-host
foreign key or runtime business callback is needed.

Admission persists non-secret execution facts before spawning. Terminal state
and output metadata are committed before publication. Output bytes are immutable,
scoped to the execution and stored under its runtime-owned directory; process
scratch is removed after collection. Reading history never executes code. A
runtime restart marks unfinished executions interrupted, kills/reaps remaining
owned workers before admitting new executions, and does not replay them.
Cancellation terminates the isolation supervisor/container and descendants,
closes egress, escalates to KILL, then settles. Disconnecting GET does not cancel.

## Required process boundary

Changing cwd or filtering Python imports is not isolation. Before executing
untrusted code, the runtime must establish all of the following, or return
`CODE_ISOLATION_UNAVAILABLE`:

- An OS user different from the runtime service, no privilege escalation,
  separate process visibility, and no inherited host/service/model credentials.
- A private filesystem root: only this execution's workspace is writable;
  the interpreter, standard library and approved package/helper files are
  mounted read-only. Minimal runtime device/proc facilities do not expose the
  supervisor or sibling tasks. No application config, database, home, Docker
  socket or other run's files are mounted. Reject symlink/path races at snapshot
  and output collection boundaries, and never reuse exploration scratch for
  final execution.
- No direct network. An execution-local relay is the only egress and forwards
  to the configured target's allowed paths. No CONNECT, arbitrary Host,
  absolute-URL forwarding or redirect escape. The relay injects the binding's
  credential and correlation/run headers, replacing caller versions. The code
  can only hold a short-lived execution-scoped relay capability; it cannot
  recover the original user ticket or select another binding.
- Enforced wall, CPU, aggregate memory/process, workspace and output limits.
  Host defaults are operational execution limits, not new agent-turn or model
  budgets. The retrieval uses the remaining existing query deadline; Java
  callers preserve their existing timeout settings. The code cannot raise limits.

Credential-bearing skill processes also need isolation from the service and
each other; otherwise a same-UID `/proc` read defeats per-binding environment
separation. Use one process-launch boundary for `.mjs` skill entries and Python,
mounting only their fixed package/runtime dependencies and assigned workspace.
Do not expose a general privileged launcher as a model tool. Existing trusted
governance file collection remains a callback to its host, not a host filesystem
mount inside a skill. This is necessary to make 'ordinary skills do not receive
exploration authority' a process property, not just an environment convention.

The proposed Linux implementation uses a fixed bubblewrap policy with user,
mount, PID and network namespaces, a dedicated worker UID, constrained launcher,
seccomp and delegated cgroup limits. It is a proposal, not demonstrated support
for the current Docker or native developer setup. Native macOS/Windows cannot
silently run an unisolated Python fallback. Deployment prerequisites and whether
to use a local Linux runtime for those systems require controller decision before
implementation. A package install or Dockerfile parse does not verify this boundary.

## Ontology helper is supplied content

Split the old Java `resources/python/query_runtime.py`: generic launching/output
collection belongs to the runtime; DSL HTTP, response validation and partial-query
tracking belong to `agent-skills/ontomato-analyst/python/query_runtime.py`, published
and mounted as an ontology library. There is no `/dsl/execute` string, ontology
import or data-permission branch in runtime implementation.

The new program form is:

```python
import json
from query_runtime import execute_dsl, parameters

rows = execute_dsl({"problem": "...", "answer": {"steps": []}})
print(json.dumps({"answer": rows}, ensure_ascii=False))
```

`execute_dsl` sends `{dsl}` over the private relay to the ontology facade and
validates data/error/partial metadata before returning rows. Parameters are
read from a supplied workspace JSON file; user/domain are not Python arguments.
The helper owns its documented metadata output file. The runtime merely collects
the requested file bytes; Java reads the partial-query metadata and applies the
existing conservative propagation rule. Each execution has a new metadata file.
The helper is not a sandbox and cannot prove arbitrary Python data lineage or
prevent deliberate fabrication. For the supported generated-program protocol,
query failure must not become a valid empty/partial result.

The ontology service supplies the same helper to its code-execution requests.
Write Functions use a separate ontology-issued sandbox/write-operation binding
and operation-limited relay target after their existing authorization. Retrieval
E/U bindings cannot reach write operations. Those HTTP handlers must derive
domain/sandbox from the credential instead of trusting submitted IDs when used
from runtime; no generic admin credential enters generated code. The current
Python MCP calculator and persisted old program format require explicit review;
see the design rather than assuming a localhost compatibility proxy.
