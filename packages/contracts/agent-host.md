# Common agent host proxy

Approved 2026-10-28. [src/agent-host.ts](src/agent-host.ts) owns the shell-facing
schemas/types (`@ontomato/contracts/agent-host`). Every application host implements
these same shapes under its own prefix. Paths below are **relative to that prefix**;
`S` = `/sessions/:sessionId`, `R` = `S/runs/:runId`, `F` = `S/artifacts/:artifactId`.
Multiple surfaces within a host use distinct mount prefixes; no surface/workbench
identifier is carried in these shapes or query parameters.
No renderer, feedback, dataset or editable-definition fields belong here.

[Domain skills](domain-skills.md) adds `resolvedSkills` to the read-only run
projection, using the runtime's stored namespace/name/digest/description.

| Method/path | Input | Output (200 unless listed) |
| --- | --- | --- |
| GET `/agents` | — | `AgentHostAgentList` |
| GET `/sessions` | `agentId`, optional opaque cursor/limit (30 default, 100 max) | `AgentHostSessionPage` |
| POST `/sessions` | `AgentHostCreateSession` | 201 `AgentHostCreateSessionResponse` |
| GET `S` | — | `AgentHostSessionSnapshot` for complete evidence/history consumers |
| GET `S/history` | optional before/after/through cursor, recovery runId | `AgentHostSessionHistory` for the shared conversation shell |
| DELETE `S` | — | 204; active run: 409 `SESSION_BUSY` |
| POST `S/runs` | `{message:string}` | 202 `AgentHostAdmission` |
| GET `R` | — | `AgentHostRunSnapshot` |
| GET `R/events` | `afterSeq`, `streamId` from snapshot cursor | SSE |
| POST `R/cancel` | `{}`, including owned unadmitted intent | `AgentHostCancelResponse` |
| GET `R/artifacts/resolve` | workspace-relative `path` | `AgentHostArtifactResolution` |
| GET `F` | — | existing `RuntimeArtifact` |
| GET `F/content` | optional `download=1` | immutable bytes |

Use the host's existing authentication, API base and language. The host checks
verified identity, domain and resource access; the browser receives no runtime
service credential, environment or system prompt. Inaccessible/deleted resources
return 404, with no host deletion tombstones. Creation requires UUID
`Idempotency-Key`, also the session/run ID and identical to its runtime ID. Matching
retries return the original admission; changed input returns 409
`IDEMPOTENCY_CONFLICT`. Only an active run blocks a new message (`SESSION_BUSY`),
with no predecessor/revision check. All continuation, clarification and follow-up
messages use the same endpoint/session. No completion or `needs_input` protocol.

Sessions retain their agent. Session lists sort by descending `(updatedAt,id)` with
keyset cursors; agent lists use host display order. Disabled agents remain visible
for history but cannot start new execution (409 `AGENT_DISABLED`). New titles are
empty; the first accepted user message becomes the verbatim title, truncated only
for display. No model title or suggestions are required by this contract.

Snapshots include the run's admitted `resolvedSkills: RuntimeRegisteredSkill[]`
(namespace/name/digest/description) and preserve PI messages, tools, files and
`running/stopped`, `stopReason`,
`errorMessage`. Merge settled messages by ID in messageSeq order; replace partials.
SSE uses `event: runtime`, JSON `AgentHostStreamFrame` and `id: <cursor.seq>` for
event frames. Preserve IDs, cursors and deltas; heartbeat comments carry no state.
Broken transport resumes from the last applied event cursor. On snapshot_required,
the conversation shell repairs the missing history range and the current live remainder
before resuming; retrieval activity retains its run-local snapshot recovery. A stopped final snapshot needs no stream. Disconnect never cancels. Cancel
stops owned work and returns a stopped run, or null if admission was prevented.
HTTP errors never invent PI state; stop may be an ordinary question.

## Conversation history window

`session-history.ts` owns the shared request, cursor and page-boundary contract.
Runtime selects the page; hosts authenticate the session and project only their
own session metadata and the page's retrieval associations. Both the workbench
assistant (and operations diagnosis) and ontology knowledge governance expose
this route. Model context, evidence and full exports keep their complete reads.

Without cursors, history opens at the tail. It counts user/assistant messages,
aims for at least 50 messages across at least two admitted Runs, and stops at a
Run boundary. The hard cap is 500 counted messages; a longer Run spans pages,
which merge back into the same response by run/message ID. Tool results accompany
the selected interval but do not consume the message budget. System messages do
not leave this read model. History exhaustion may end below the minima.

`before` reads an older page. `after` repairs a forward gap; the first response
captures `throughCursor`, and further repair pages carry it until `nextCursor`
is null. Cursors are session-bound positions, not credentials. `runId` includes
the previously subscribed run's status during repair even if it has no missing
message. Every query still checks host/domain/session access.

Only the initial tail/repair response supplies `latestRun`'s live cut: settled
messages and artifacts are absent there, and tool executions include only the
remainder not yet represented by settled tool-result messages. History body
messages appear once. Later repair pages carry durable bodies through the fixed
cut, not another live baseline. Their session header can be current while their
message/run entries remain restricted to the requested range.

The shell merges durable messages by ID/sequence and then replaces pending state
from the captured live cut before subscribing. Ordinary event-sequence gaps are
legal and are not interpreted as lost messages. `snapshot_required` is the repair
signal; unavailable transient deltas are not claimed as durable replay. Loading
older pages preserves newer live state and the scroll position. Reopening reads
from the server; there is no browser persistence or alternate history store.

Resolve paths by **(runId,path)**: final version when stopped, current version while
running, including the inherited session baseline. Null means no registered file.
No per-message boundary is introduced. Content uses media type/length/hash ETag,
nosniff, safe download names and attachment disposition for HTML. Rendering follows
[agent-artifact-markdown.md](agent-artifact-markdown.md), owned by the frontend.

Errors are `AgentHostError`: `{error:{code,message},correlationId}`. Standard codes:
400 INVALID_REQUEST, 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, the 409 codes
above, 503 DEPENDENCY_UNAVAILABLE. Never substitute empty history for failed reads;
public errors contain no credentials or stacks. Business actions use host action
slots and separate contracts, without extending this proxy protocol.
