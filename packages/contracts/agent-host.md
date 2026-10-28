# Common agent host proxy

Approved 2026-10-28. [src/agent-host.ts](src/agent-host.ts) owns the shell-facing
schemas/types (`@ontomato/contracts/agent-host`). Every application host implements
these same shapes under its own prefix. Paths below are **relative to that prefix**;
`S` = `/sessions/:sessionId`, `R` = `S/runs/:runId`, `F` = `S/artifacts/:artifactId`.
Multiple surfaces within a host use distinct mount prefixes; no surface/workbench
identifier is carried in these shapes or query parameters.
No renderer, feedback, dataset or editable-definition fields belong here.

Proposed extension, not implemented: [domain skills](domain-skills.md) adds the
runtime's resolved skill metadata to the read-only run projection.

| Method/path | Input | Output (200 unless listed) |
| --- | --- | --- |
| GET `/agents` | — | `AgentHostAgentList` |
| GET `/sessions` | `agentId`, optional opaque cursor/limit (30 default, 100 max) | `AgentHostSessionPage` |
| POST `/sessions` | `AgentHostCreateSession` | 201 `AgentHostCreateSessionResponse` |
| GET `S` | — | `AgentHostSessionSnapshot` |
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

Snapshots preserve PI messages, tools, files and `running/stopped`, `stopReason`,
`errorMessage`. Merge settled messages by ID in messageSeq order; replace partials.
SSE uses `event: runtime`, JSON `AgentHostStreamFrame` and `id: <cursor.seq>` for
event frames. Preserve IDs, cursors and deltas; heartbeat comments carry no state.
On snapshot_required or broken transport, replace the snapshot and resume from its
cursor. A stopped final snapshot needs no stream. Disconnect never cancels. Cancel
stops owned work and returns a stopped run, or null if admission was prevented.
HTTP errors never invent PI state; stop may be an ordinary question.

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
