# Standard harness replacement design

Controller-review segment, 2026-10-28. Baseline public f073cc7, enterprise
10efb96; branch feature/agent-runtime-standard. This segment changes documents
only. It does not claim new endpoints or tests have been implemented. The review
gate precedes implementation. [Runtime wire contract](../packages/contracts/agent-runtime.md),
[standalone execution](../packages/contracts/agent-runtime-code.md) and
[retrieval contract](../packages/contracts/data-retrieval.md) are the shape owners.

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

The existing journal-aware loop fork and pi-ai 1.3.0 remain the conversation
owner. The new package brings its own PI dependency closure; use only its four
tool factories and skill discovery, not AgentSession, CLI, settings discovery,
model routing or a second loop. A narrow adapter transports the standard tool
schema/content/details into the existing loop. Explicitly test the 1.4 tool /
1.3 wire-profile boundary (text, image, errors, streaming tool output); unsupported
blocks fail visibly. If this cannot be done through public exports, return that
finding to the controller before upgrading/forking more PI components. Record
actual production dependency size and notices in main-directory image acceptance.

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

For external execution, propose POST /api/knowledge-governance/skill-runs with a
UUID key and `{message}` to create the same host business record/open gate without
starting a runtime agent. Return `{id,sessionId,runId,expiresAt}`; a matching retry
returns that gate without reopening it. CLI begin prints these identities;
POST /api/knowledge-governance/:id/skill-runs/:runId/close closes it. Bound expiry by the existing query timeout setting and, when present,
the authenticated credential expiry; every mutation checks it. Explicit close or
a new run closes earlier. No new lifetime configuration is introduced. The internal entry calls the same gate-opening service and additionally
admits the runtime run. External history remains in the external harness, not a
fabricated runtime session. This minimal entry is a review decision because the
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
exported prompt constant in segment 2. Renderer research and Vue integration
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

## Verification and review boundary

Segment 1: review documents against current implementation and authority, check
relative links/diff/changed-file scope, commit only Markdown, stop. No typecheck
can prove the proposed schemas have been implemented at this stage.

Segment 2 commands use existing repository entry points:

```sh
pnpm typecheck:runtime
pnpm typecheck:workbench
pnpm test:runtime
pnpm --filter @ontomato/workbench-server exec vitest run src/services/knowledge-governance src/services/data-retrieval
pnpm lint:workbench
pnpm test:scripts
```

Run enterprise typecheck and the relevant existing full-context Java startup
tests, plus narrowly selected grant/formal-output/Function tests. Record exact
Maven selectors after locating them; no unfiltered external-system Java suite.
Adapt existing process integration tests instead of writing tests that mirror
prompt text or a manifest. Add only missing deterministic invariants:

| Concrete risk | Required evidence |
| --- | --- |
| Tools still execute old wrappers or disagree with upstream | Real worker process invokes four PI tools and standard CLI scripts; same files/digests externally; no alternate entry |
| UID/workspace accidentally per tool/run or skills replaceable | Linux process/permissions proof: same session/new run same UID/files, different session inaccessible, read-only package rename/edit denied |
| Snapshot can change or point to missing bytes | Tool writes/overwrites/deletes, errors after write, binary file, same bytes reused, live/history/hash equality and interrupted commit recovery |
| Restart/cancel loses source or replays side effects | Real PG + independent runtime/host processes; orphan child cleanup, stopped/aborted recovery, next run file continuity, unknown outcome not replayed |
| Response loss becomes failure/duplicates action | Drop admission/output/SSE responses; same ID reconciliation, preserved state while unreachable, stale run gate rejection |
| Nullable real settings/specs or app assembly fail | Fixture actual nullable model/metric fields; full application startup test process, public/enterprise imports, malformed vs empty payload distinctions |
| Formal rows bypass permissions or differ in history | Query superset then authorized rerun, zero/false/null/partial results, tampered receipt/file rejection, same projection from HTTP snapshot |
| Governance context hook secretly survives | All eight commands as ordinary subprocesses; read/updated work across compaction, saved sources/progress and continuation |
| Plain question ends up a business failure | Normal stop message without file; explicit free-text answer same session/new run; aborted/error/length preserved |
| Packaging still copies runtime-only files | Actual package resource fixture + startup publication; dependency/export/import and notice generation checks |

The worker may run temporary local PG, fixture HTTP/model servers and test child
processes in its worktree. It must not build product images or start the development
stack there. Main-directory runtime image build, Linux final-image probes,
enterprise four-image smoke, live governance/retrieval questions and browser
acceptance are controller-owned. External Claude Code steps are in the retrieval
design. Remote 128 demo-test 35 questions requires separate current authorization;
record comparable model/data/question inputs, per-question correctness and timing,
without an invented pass threshold. It has not run in this segment.

Review decisions to settle before implementation: the minimal external work-gate
entry points, and the explicit standalone process state shape (no assistant exists
there). Dependency compatibility is an implementation proof obligation, not an
implicit authorization to replace the PI loop. No other user-level scope choice
is required by this draft.
