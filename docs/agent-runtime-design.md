# Standard harness replacement design

Implementation, 2026-10-28. Public baseline d9fcae3 after the authorized rebase;
enterprise baseline 10efb96. Controller review approved the external business-gate
entry and standalone process state; a later user decision unified all PI components
at 1.4.0. [Runtime wire contract](../packages/contracts/agent-runtime.md),
[standalone execution](../packages/contracts/agent-runtime-code.md) and
[retrieval contract](../packages/contracts/data-retrieval.md) own the wire shapes.

Success means the same standard skill files and commands work in an external
Claude Code/Codex harness and in the product. Governance and retrieval are both
prompt + skills + model role on the same harness. Runtime understands sessions,
PI events, models, files and processes; business services understand their own
records and permissions. This batch does not resume the paused assistant/UI work.

## Implementation ownership and PI reuse

| Owner | Responsibility |
| --- | --- |
| packages/contracts | HTTP/message/artifact shapes, dataset boundary, shared Markdown reference rule |
| packages/agent-runtime | Single PI loop, journaling, compaction, model adapter, package registry, session sandbox, artifact file store |
| apps/agent-runtime | Public process/container assembly; reused by enterprise |
| workbench-server | Definitions/prompts, governance and retrieval business gates, callback HTTP, projections, QC scheduling |
| ontology service | Knowledge/schema/DSL/metrics, grants, formal-output permission checks, existing Python caller semantics |
| provider skill directories | Standard SKILL.md, scripts and references, also distributed externally |

Local source inspection found pi-coding-agent 1.4.0 with exported createReadTool,
createWriteTool, createEditTool, createBashTool, loadSkills and
formatSkillsForPrompt. Use an exact dependency on that package, not copied tool
algorithms. Its built-in edit schema is edits[], read uses line offset/limit,
and bash has command/timeout; retain those upstream schemas and behaviors. Do not
translate the retired workspace_* arguments into new private APIs.

The loop is re-forked from pi-agent-core 1.4.0 source maps; pi-ai and
pi-coding-agent are exact 1.4.0 dependencies. UPSTREAM.md records hashes and local
changes. Awaited event sinks, prepareRequest and sequential tools are upstream
hooks used by the runtime for journaling, compaction and terminal persistence.
Only the four tool factories and explicit skill discovery are consumed from the
coding-agent SDK; there is no second AgentSession or CLI execution loop.

Instantiate tool execution in a non-root run worker reached by Node IPC. The
supervisor owns model calls/events and forwards tool name, arguments and cancel;
the worker invokes the upstream factory's execute function and returns its
standard result/update. This private infrastructure IPC is not part of any skill
package; scripts are ordinary subprocesses of PI bash and use normal stdout/exit
codes. Run all four factories under the session UID, not just bash. Upstream path
handling does not make a root file tool safe merely by passing cwd.

The existing worker-launch.py applies identity/rlimits before starting the Node
tool worker; descendants inherit the identity/limits. Keep the lifetime pipe and
process-group/UID cleanup. Disable PI ambient project/global skill discovery and
session-environment exposure; provide only the explicit runtime environment.
Preserve external MCP connections as configured service tools; prevent collisions
with the four built-in names. No business special cases enter the tool adapter.

## Session sandbox lifecycle

Runtime data volume layout:

```text
sessions/<opaque-session-storage-key>/workspace/
  skills/<name>/SKILL.md, scripts/, references/  (supervisor-owned, read-only)
  work/                                       (scratch and source)
  outputs/                                    (published files)
  home/, tmp/                                 (worker-owned)
skills/<namespace-key>/<name>/<digest>/        (immutable package source)
artifacts/sha256/<prefix>/<hash>               (immutable file bytes)
```

1. Session admission creates its PG identity. First run reserves a monotonically
   allocated UID using the existing persistent allocator, records it on the
   session, then creates the workspace and selected skill copies. A crash can
   burn a UID; it must never assign that UID to another session. At most one
   run per session can allocate/prepare under the admission lock.
2. Persist preparation state before execution. Filesystem operations occur outside
   short DB transactions; recover incomplete preparation explicitly as aborted,
   never silently use an incomplete skill tree. Public IDs are mapped to server
   storage keys; URL input never becomes an unchecked filesystem path.
3. Production uses a supervisor-owned workspace root, group=session UID, sticky
   group-write directory (01770). Root-owned skills directory (0550) cannot be
   renamed/replaced by the worker; skill files are 0440. work/outputs/home/tmp
   are writable for that UID. An ordinary writable workspace root with a
   read-only skills child would permit replacing the child, so it is insufficient.
   Verify actual permissions and replacement attempts in Linux.
4. Each run starts a fresh tool worker with fresh environment. HOME/TMPDIR point
   inside the workspace. PYTHONPATH points to the installed provider helper where
   needed. Scratch, source and outputs survive rounds. Update skills only between
   runs. No initialFiles rehydration into a fresh run directory is needed.
5. Cancel closes the host gate first; runtime stops model/tool admission, cancels
   PI tools, kills/reaps every process owned by the session UID, collects the
   final output boundary and commits stopped/aborted. Natural stop also reaps
   leftover background processes before final collection. It keeps the directory
   and UID; the next run gets a fresh process, never a surviving shell environment.
6. On service restart, clean owned orphan processes, close unfinished runs as
   aborted and retain their workspace/UID. Do not attribute previously unregistered
   crash-left files to a later run: establish that later run's scan baseline first.
   Previously committed artifacts remain valid. A missing persistent workspace
   is an explicit preparation error, not silently an empty continuation.
7. Session deletion is allowed only after stopped. Commit its tombstone, remove
   owned metadata/workspace and unreferenced artifacts using resumable cleanup.
   No UID recycling or workspace TTL is added. Registered packages are shared and
   are not deleted merely because one session ends.

This preserves the approved UID/rlimit isolation level, not a filesystem or
network namespace. Workers may read world-readable OS files. Container network
policy owns reachable destinations. Explicit native development mode remains
weaker; a macOS proof cannot stand in for Linux UID isolation.

## Governance standard skill

Publish the directory at
packages/workbench-server/resources/runtime-skills/knowledge-governance. Replace
run.mjs with scripts/governance.mjs plus references for command arguments; the
publication helper reads package files instead of generating a tool manifest.
One skill is sufficient for all eight existing actions:

| CLI subcommand | Host action / preserved behavior |
| --- | --- |
| read-knowledge | Read knowledge via ontology; register source/count in the same request |
| read-ontology | Read schema via ontology; register sources |
| search-history | Same-domain cross-user history search under governance permission |
| read-history | Read owned-domain historical facts and register their source |
| collect-turn-artifacts | Use diagnostic material owner; unknown side effects are never automatically replayed |
| read-evidence | Existing domain-checked diagnostic evidence reader |
| read-work-record | Read this run's saved work/revision |
| update-work-record | Existing notes/issues/progress/reviewed IDs and source checks |

CLI form: `node skills/knowledge-governance/scripts/governance.mjs <command>
@work/args.json`. Requests go to POST
/api/knowledge-governance/:id/runs/:runId/actions/:action, with plain JSON arguments,
tk, language, correlation and session identity headers. This replaces the old
/runtime/context and /runtime/tools route and invocation envelope. Identity comes
from authenticated user/domain plus stored host session/run ownership. A caller
cannot acquire authority merely by knowing a run ID.

Every action retains existing validation, pagination and source semantics.
Source-registration writes and update-work-record check current writeRunId/open
and revision inside the commit transaction. Network reads occur before that short
transaction. Cancel and new-round opening serialize with writes. Closed/old runs
return 409 GOVERNANCE_RUN_CLOSED, not a successful no-op. The accepted guarantee
starts when the host closes the gate, with an in-flight write limited to its own
run record before closure. No new settlement handshake is introduced.

The host builds the stable governance prompt once at run admission, preserving
modelRole knowledgeGovernance and localized templates. It includes a pointer to
the skill and asks the agent to read-work-record before work and after compaction
when current progress is needed. update-work-record returns the authoritative new
work/revision in the normal command result. Remove automatic before-model progress
refresh and its prompt interpolation; do not reproduce it as a hook. Continuation
uses the same skill read. Governance behavior acceptance checks saved progress
and source/work consistency, not a specific prompt string or tool-call count.

For external execution, POST /api/knowledge-governance/skill-runs with a
UUID key and `{message}` to create the same host business record/open gate without
starting a runtime agent. Return `{id,sessionId,runId,expiresAt}`; a matching retry
returns that gate without reopening it. CLI begin prints these identities;
POST /api/knowledge-governance/:id/skill-runs/:runId/close closes it. Bound expiry by the existing query timeout setting and, when present,
the authenticated credential expiry; every mutation checks it. Explicit close or
a new run closes earlier. No new lifetime configuration is introduced. The internal entry calls the same gate-opening service and additionally
admits the runtime run. External history remains in the external harness, not a
fabricated runtime session. This minimal entry is controller-approved because the
old API always started a model and could not support the required external proof.

Both modes use the environment names in the retrieval contract. Environment tk
uses normal identity verification; internal callback delegations retain their
existing run/route verification with transport changed to the documented header.
No runtime host service key is supplied to a script. Business methods do not branch
on which harness ran the command.

## Storage and transport change

Retain scoped sessions, runs, admissions, messages, events, compactions and
model-call facts. Change runs to running/stopped and PI projection; add session
UID/workspace metadata. Replace artifact JSON payload columns with immutable
file metadata. Replace skill version/manifest rows with name/digest metadata
and current publication pointers. Code-execution bytes also move behind the same
file interface. Wire snapshots/HTTP/events all reference the same artifact rows.

The blob write precedes metadata commit; an unreferenced blob after a crash is
safe to clean, a committed reference to nonexistent bytes is an error. Never
serve arbitrary mutable workspace files for a historical artifact. Register
files after all tools, not only bash or successful tools. Store a path occurrence
and hash, so overwrite does not alter historical answers. See wire contract for
cursor-bound resolution and registration events.

The shared Markdown rule lives in contracts/agent-artifact-markdown.md with one
exported ARTIFACT_MARKDOWN_PROMPT constant. Renderer research and Vue integration
remain batch 3. This batch adapts current governance/retrieval consumers and
history/download to the new facts; it does not introduce the new conversation UI.

Stored pre-replacement records require the pre-release conversion work already
reserved by the migration plan. Segment 2 uses clean isolated fixtures and new
schema; it must reject an unconverted legacy schema explicitly rather than erase
rows or keep old runtime branches. No automatic destructive upgrade is authorized.
Record the required legacy-to-file conversion inputs for that owner. Main-checkout
acceptance should use a separately named test DB/volume unless the controller
explicitly authorizes conversion. Preserving existing runtime data is a release
boundary, not a reason to keep two live protocols.

## Removal and retained-owner inventory

Paths below are public-repository relative. Delete obsolete exports/tests with
their consumers; do not preserve aliases just to satisfy old assertions.

| Replaced/deleted | Destination or retained owner |
| --- | --- |
| contracts agent-runtime-skills manifest, invocation/output envelopes, version refs | Standard SkillRef/name/digest publication + environment contract |
| agent-runtime/src/skills.ts executeSkill and eager instructions; skill-lifetime.mjs | PI catalog loading; run worker lifecycle via existing worker-launch.py |
| contextSkill/contextEntry; governance context callback/template refresh | Ordinary read-work-record command and host stable prompt |
| privateContext.skillBindings/python and per-tool target/context envelope | One run environment, standalone execution environment |
| agent-runtime/src/tools.ts workspace_* definitions | Four upstream PI tools; keep external MCP connection owner |
| builtinTools.python, python_execute, run execution receipts, initialFiles continuation | bash Python; persistent session files; retained standalone code endpoint |
| analyst runtime.json/runtime.mjs and Runtime invocation section/metadata | ontomato.mjs/client.mjs + unchanged packaged helper used inside and outside |
| registerGovernanceSkill/registerRetrievalSkill manifest generation | Upload the actual standard directory bytes at startup |
| workbench runtime-skills run.mjs NDJSON wrappers | Ordinary CLI scripts and standard references |
| submit_dataset/finish_retrieval tool schemas, callbacks and outcome rows | Formal output receipt API + dataset file read; PI state/message continuation |
| completed/failed/cancelled/interrupted for runtime agent/code lifecycle | PI run state; standalone process exit facts |
| tool artifact output envelopes, opaque payload/jsonb artifact storage | Output scan, content-addressed files, PG metadata |
| retrieval tri-state/questions/choice handling in API, ask, projection, abc bridge | Ordinary message reply + dataset references; keep task decision ownership |
| Java RuntimeCodeClient hardcoded runtime-only resource list, Python binding/client parsing | Package full standard skill and use generic code contract |
| Enterprise duplicated analyst command code and stale prompt tool names | Generated public scripts and edition documentation/prompt overlays |

Search every live producer/reader, including contracts, workbench client,
governance chat-view, retrieval projection/branch, current Vue consumers, tests,
Java PythonExecuteService/RuntimeCodeClient and package resource copying. Old
language enums in unrelated QC/analysis jobs are not runtime protocols and are
not deleted by a repository-wide text replacement.

Retain: sessions/events/admission/cursor recovery; compaction and PI model gateway;
UID/rlimit/lifetime isolation; `/v1/code-executions` for Java; workbench orchestration
and parent cancellation; governance materials/business work; ontology query/grant/
formal-output/QC semantics. Keep old workbench core/agent-loop, harness-sessions,
LangChain and Java file tools only for unmigrated analysis/diagnosis/generator
consumers. No work on the paused third-batch branch or remote deployment.

## Verification and handoff boundary

The user's latest instruction narrows verification to durable contracts and one
real-process smoke for each main path: governance reads/writes, one Python data
question, cancellation and restart yielding aborted. Existing valid checks may
remain; do not grow a fault matrix or maintain assertions about private SQL,
prompt wording, internal call counts or implementation-only shapes.

The kept checks protect runtime identity environment, standard skill loading,
immutable file snapshots, closed write gates, shared executable distribution and
PI/Java wire boundaries. Process smokes use isolated PG, real Node/Python child
processes and local model/ontology HTTP fixtures, including nullable configuration
and reasoning_content through pi-ai 1.4.0. Governance exercises compaction and
saved work recovery. These are mechanical proofs, not live-model answer quality.

Existing entry points: pnpm typecheck:runtime, pnpm typecheck:workbench,
pnpm lint:workbench, pnpm test:runtime and the focused workbench governance/retrieval
Vitest paths. Both editions' selected Java startup/Function/authorization tests use
disposable PG/pgvector. The Linux PI tool probe runs current source in a disposable
container with Node/Python; it does not build or accept the product image.

Main-directory image builds, real full-stack/browser acceptance, Claude Code
execution and authorized 128 comparison remain controller-owned. External steps
are in the retrieval design. Runtime/host legacy schemas are rejected explicitly
until the separately owned pre-release conversion; no old protocol fallback or
automatic deletion is installed. No unresolved architecture decision remains.
