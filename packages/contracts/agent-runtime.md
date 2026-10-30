# Standard agent runtime wire contract

Implemented contract, 2026-10-28. This replaces the batch 1 private skill,
artifact and run-state contract. Executable schemas live in src/agent-runtime*.ts.
[Implementation design](../../docs/agent-runtime-design.md) owns placement and
migration scope; [code execution](agent-runtime-code.md) and
[retrieval](data-retrieval.md) own their respective boundaries. Main-checkout
image/stack and external Claude Code acceptance remain controller-owned.

[External MCP services](agent-runtime-mcp.md) are configured in runtime and
referenced by immutable service UUIDs. That contract owns management and selection.
The [domain-skill host integration](domain-skills.md) reuses this
publication/admission protocol.

## HTTP and admission

Requests carry `Authorization: Bearer <host service credential>` and
`X-Correlation-Id`. Session, run, artifact, MCP and domain-skill requests also carry
`X-Domain-Id`. Credentials resolve a configured host; the host verifies the user
and domain first. Every lookup uses host + domain, including streams and file
reads. Foreign resources return 404, invalid service credentials 401. Provider
publication needs publisher authority but no invented startup domain. Success is
plain JSON; HTTP failures retain `{error:{code,message},correlationId}`.

| Method and path | Request / response |
| --- | --- |
| POST /v1/sessions | `{}`; 201 `{session,replayed}` |
| GET /v1/sessions/:id | `{session,messages,latestRun}` complete snapshot |
| GET /v1/sessions/:id/history | bounded conversation history page; `before`, `after`, `through`, optional recovery `runId` |
| POST /v1/sessions/status | `{sessionIds}`; ordered `{sessions:[{session,latestRun}]}` |
| POST /v1/sessions/:id/runs | StartRun below; 202 `{run,replayed}` |
| GET /v1/runs/:id | `{run,messages,pendingMessages,toolExecutions,artifacts,cursor}` |
| GET /v1/runs/:id/events | SSE, query `afterSeq` + `streamId` |
| POST /v1/runs/:id/cancel | `{}`; 200 `{run}` after stopping |
| POST /v1/sessions/:id/run-intents/:runId/cancel | 204, including unadmitted intents |
| DELETE /v1/sessions/:id | 204; active session 409 |
| POST /v1/skills | Package publication below; 201 resolved package metadata |
| GET /v1/artifacts/:id | Immutable file metadata |
| GET /v1/artifacts/:id/content | Raw bytes, Content-Type, Content-Length, ETag=hash |
| GET /v1/runs/:id/artifacts | `{artifacts}`; optional `path` and `atSeq` resolve a path at an event boundary |

Session/run creation uses a UUID `Idempotency-Key`, also the resource ID. The
host can persist its business gate before sending admission. The shared admission
ledger retains operation, target and canonical semantic fingerprint per scope.
Same key + same request replays the original resource, even when stopped; changed
input/definition/target returns 409. Resolve a matching prior admission before
checking busy state or current skill publication. Secret values and correlation
IDs do not participate in fingerprints; public environment values, secret names,
language, input and definition do. Retrying does not rotate an admitted run's
credentials or re-resolve its skills. One session has one active run under a row
lock. Persist admission, resolved definition, input and initial events before
responding or executing. Do not append input twice.

Intent cancellation prevents a late admission (410) after an uncertain response.
Deletion retains admission tombstones; old creation retries return 410. A reader
closing its connection never cancels execution. Status-list reads use one PG
statement snapshot, preserve request order/duplicates, and reject the whole list
if any ID is missing. They exclude messages, definitions, artifacts and error
text; latestRun includes only id, status and stopReason.

## Run definition, environment and sandbox

Wire shape (all IDs are UUIDs; paths are portable relative paths):

```ts
type SkillRef = { namespace: {kind:"provider"; provider:string}
                            | {kind:"domain"; domainId:string}; name:string };
type StartRun = {
  language: string;
  input: RuntimeUserMessage;
  definition: {
    systemPrompt: string;
    modelRole: string;
    skills: SkillRef[];
    externalMcp: {id:string}[];
    compaction: {systemPrompt:string; summarizePrompt:string; updatePrompt:string};
    sandbox: {limits: CodeLimits};
  };
  environment: {
    values: Record<string,string>;
    secrets: Record<string,string>;
  };
};
```

The runtime always exposes PI `read`, `write`, `edit`, `bash`. There is no Python
switch, context entry or business tool registration. Python runs through bash.
The service owns physical paths, UID allocation, output directory (`outputs/`)
and sandbox mode; callers cannot choose a host path or UID. Limits reuse the
existing worker policy. Model keys remain supervisor-only and are resolved from runtime-owned domain settings.

The run environment is a single map formed from explicit values + secrets plus
runtime identity. Duplicate names, NUL, invalid environment names and attempts
to replace runtime identity are admission errors. The server constructs a small
OS environment (PATH, HOME, TMPDIR, locale and Python library path); it does not
inherit service/model credentials. Public values and secret *names* are stored;
secret values live only for the admitted run. Persist no raw request body.
Continuation must supply fresh values. Unknown environment variables are allowed
for third-party standard skills; there is no runtime business-variable registry.

Runtime-owned variables: `ONTOMATO_SESSION_ID`, `ONTOMATO_RUN_ID`,
`ONTOMATO_CORRELATION_ID`, `ONTOMATO_LANGUAGE`, `ONTOMATO_WORKSPACE`,
`ONTOMATO_OUTPUT_DIR`. The first two refer to this session and run, never a model
argument. Tool-call identity belongs to event metadata; scripts do not need an
invocation/tool-call envelope. Host skill variables and their exact meaning are
specified in the retrieval contract and governance design, and repeated in each
skill's user documentation. File references are relative to the workspace.

A session receives its workspace and UID on first run and reuses both across
rounds and service restarts. Workspace contents persist; environment and worker
processes do not persist between runs. Only enabled skill packages appear under
`skills/<name>/`; a duplicate display name across namespaces rejects admission.
At a new run boundary the runtime replaces that read-only tree using the newly
resolved package digests, never while a tool is executing. Previous definition
snapshots still identify the historical bytes. Session deletion kills any owned
processes before removing the workspace; published artifacts have their own
immutable storage. See design for ownership, crash recovery and deletion order.

## Standard skill publication and discovery

```ts
type PublishSkill = {
  skill: SkillRef;
  files: {path:string; content:string}[]; // UTF-8 source files in this batch
};
type PublishedSkill = {
  skill: SkillRef; digest:string; description:string;
};
```

A package is a directory with standard `SKILL.md`, scripts and references.
Frontmatter uses only [Agent Skills specification](https://agentskills.io/specification)
fields; no runtime manifest metadata is required. Name must match the directory,
be unique in the selected run, and description must be nonempty. The runtime
validates portable paths, duplicate files and package bounds; no absolute paths,
traversal, links, remote fetching or host-directory imports. UTF-8 is sufficient
for the three source packages in scope; binary package transport is deferred.

Compute SHA-256 from the UTF-8 canonical JSON array of `[path,content]` pairs,
sorted by path without Unicode/newline rewriting. Store immutable files by
namespace/name/digest on the runtime volume. PG stores package metadata and the
current published digest for each authorized name. Identical bytes are
idempotent. New bytes create a new digest and atomically advance that name; old
bytes remain addressable by admitted runs. Definition input references names;
admission stores their resolved digests. There is no mutable package content or
semantic-version manifest. A missing/unauthorized reference fails admission.

Use PI's skill loader against only the installed selected directories, with
default/global discovery disabled. Use its catalog formatter for name,
description and SKILL.md location in the system prompt. Do not eagerly append
bodies or execute scripts to construct context. The model reads SKILL.md and
references using read, then runs the documented commands using bash. This is the
same [progressive disclosure](https://agentskills.io/client-implementation/adding-skills-support)
flow used outside the product. Prompt compaction counts the catalog and four
tool definitions; raw loaded messages remain in history.

## PI state and history

```ts
type RunState = {
  status: "running" | "stopped";
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted" | null;
  errorMessage: string | null;
};
```

stopReason/errorMessage project the latest settled PI assistant message, not an
independent business result. Before any assistant message they are null. A run
may still be running after an assistant toolUse message. At stopped, a final
assistant fact is present: natural stop/length/error uses PI's values; cancel,
shutdown or recovered unfinished work uses aborted with an explanatory
errorMessage. Preparation/worker/storage errors use error. Runtime-originated
termination uses an assistant error/abort message with empty content, timestamp
and explicit origin: runtime; it must not invent a model response or mutate a previous settled message.
Use resolved model metadata when available; before model resolution use the
requested role from the stored run definition, not a fictional provider.
The pre-model case is a declared wire variant: the message has
origin: "runtime", role: "assistant", content: [], stopReason
error or aborted, nonempty errorMessage and numeric timestamp; model/api/provider
and usage are null because no provider call happened. Model-origin messages keep
the existing required PI metadata/usage. The adapter materializes this service
notice as context text for subsequent PI input rather than passing an incomplete
provider message to pi-ai. This is one explicit boundary case, not another run
status or a claim that a model emitted the notice.

Only status answers whether execution is still active. length is not silently
converted to error or complete success. toolUse is preserved if that is the last
PI fact; consumers do not equate it with success. An aborted run retains prior
messages and artifacts. Restart closes unfinished work as stopped/aborted before
new admission and never replays a possibly executed tool. Reconstructed model
context marks a missing tool result as unknown outcome without altering history.
HTTP/SSE transport failure does not change run state. Hosts retry reads and use
the authoritative snapshot after reconnection.

Existing ordered PI lifecycle events remain. agent_end contains the same
RunState as the committed run. Tool errors remain PI tool-result errors and may
be corrected by the model. Do not introduce a second completed/failed/cancelled/
interrupted enum for agents. Hosts close their write gate on stopped regardless
of stopReason; rendering and business consumers read the message and files.

Messages retain stable IDs, session message sequence, provider signatures and
usage. Service timestamps are ISO, PI timestamps milliseconds. Compression
stores summary + covered-through message sequence without rewriting raw history,
keeps tool-call/result pairs and retains raw context when summarization fails.
Model role selection and write-only keys follow the
[model configuration contract](agent-runtime-model-config.md). Runtime owns
storage and resolves each run locally. Workbench and ontology hosts share settings
within a platform domain. Run requests no longer carry `modelCredential`.

## Conversation history reads

`session-history.ts` defines the window read used by the common agent-host shell.
The runtime selects a keyset range in storage before reading message bodies;
limits are 50 user/assistant messages and two Runs as targets, with a hard
500-message cap. Other records accompany the interval. A long Run may span pages.
A session lock pairs the tail/repair page boundary with its current live cut;
subsequent forward pages are pinned to the first response's through cursor.
Backward pages have no live baseline. Full internal history/model reads are
unchanged. See [agent-host](agent-host.md#conversation-history-window) for the
host projection and shell merge/scroll behavior.

## Events and file artifacts

Snapshots contain one consistent projection boundary and cursor
`{runId,seq,streamId}`. Persist lifecycle facts before publishing. message_update
and tool_execution_update carry deltas only; full partials exist in snapshots.
Sequence values are increasing, durable reservations may leave gaps, and values
are never reused. Subscribe after the snapshot cursor, atomically bridging replay
and live subscription. Missing volatile tails produce snapshot_required and
close; clients replace the snapshot and reconnect. A stopped snapshot at the
final cursor needs no further stream. No promise of lost-token replay is added.

```ts
type Artifact = {
  id: UUID; sessionId: UUID; runId: UUID; toolCallId: string | null;
  path: string; // outputs/... relative to the workspace
  sha256: string; size: number; mediaType: string;
  createdAt: string; seq: number;
};
```

After every tool finishes (also errors/cancellation), collect new or changed
regular files under outputs. Read each source once into a task-owned temporary
snapshot while computing SHA-256; the digest and size describe the copied bytes.
Atomically place the blob at `artifacts/sha256/<prefix>/<hash>` before committing
metadata and the corresponding tool end. Detect concurrent modification and
retry collection or report an explicit storage error; never record a hash of
different bytes. Scripts write temporary files outside outputs and rename final
files into it. Arbitrary background writers have no transactional publication
guarantee. Stop and reap the run's remaining processes, then collect a final
boundary before agent_end. A collection failure cannot be reported as a clean
stop. Previously committed snapshots remain readable.

Use one internal ArtifactFiles interface for blob put/read/delete and authorized
output scanning; route handlers and store code
must not invent separate file backends. No file bytes or business JSON payloads
in the artifact table. Repeated observation of unchanged bytes emits nothing;
an A→B→A overwrite creates three metadata occurrences, with A's blob deduplicated.
Deleted workspace files do not delete snapshots. New-round unchanged files keep
their previous artifact IDs; prior outputs are not re-attributed to the new run.

artifact_registered events carry the same metadata returned by snapshots. Tool
end and settled tool-result details carry the IDs registered at that boundary,
not file content. Runtime never switches on a dataset/chart/report schema.
GET content streams the immutable blob after scoped metadata lookup, never a
client-supplied path or bare digest. Missing/corrupt blobs are explicit errors,
not empty files. Blob paths remain private to the runtime.

Path resolution selects the last occurrence for that path through atSeq in the
specified run (or its inherited session baseline); responses retain the owning
run. Without atSeq it uses that run's current/final boundary. The shell resolves a message's path at its owning run's final/current boundary,
never a later run's mutable workspace; atSeq remains available to other consumers. If no artifact
exists yet, render pending/unavailable rather than guess. Hashes may deduplicate
bytes across scopes; every read still requires an authorized artifact ID.

Markdown presentation is owned by [the shell contract](agent-artifact-markdown.md).
Hosts reference its common prompt rule. Runtime only supplies path/ID/bytes and
contains no renderer. Session deletion removes owned metadata/workspace and
unreferenced blobs after committing the tombstone; a crash may leave unreachable
blobs but must never delete a still-referenced one. Retention/compression policy
and object storage are outside this batch.


## Model connection test

`POST /v1/models/test` is a model-gateway operation for an unsaved configuration,
not a run. It uses host/domain authentication and the schemas in
[`runtime-model-test.ts`](src/runtime-model-test.ts). It sends one minimal pi-ai
request, does not retry or persist anything, and cancels on disconnect. Request fields, masked-key restoration and response are defined in the
[model configuration contract](agent-runtime-model-config.md).

## Restricted run history

`GET /v1/history` and `/v1/history/:hostId/:runId` expose the projection defined in
`src/agent-runtime-history.ts`. It contains user questions, final answers and artifact metadata,
never full messages, thinking, tools or annotations. Artifact content is read through
`/v1/history/:hostId/:runId/artifacts/:artifactId/content`. `X-Domain-Id` always applies.
Only hosts configured with `domainHistory: true` can read another host's projection; shipped
configuration grants this to ontology alone. Other runtime routes remain host-scoped.
`definition.agentId` is an optional opaque host-owned agent identity for filtering.
