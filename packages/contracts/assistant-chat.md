# Assistant host HTTP contract

Approved 2026-10-28. Shapes/types are owned by [src/assistant-chat.ts](src/assistant-chat.ts)
(`@ontomato/contracts/assistant-chat`); [design](../../docs/assistant-unification-design.md)
owns implementation. The frontend owns `agent-shell` declarations/data ports.

All paths below have prefix `/api/assistant`; `S` means `/sessions/:sessionId`,
`R` means `S/runs/:runId`, `F` means `S/artifacts/:artifactId`. Use the existing
API base, verified user/domain authentication and language. Every read/write checks
both domain and user. The browser receives no runtime credential, environment or
system prompt. Inaccessible/deleted resources return 404; no deletion tombstones.

| Method/path | Request | Response |
| --- | --- | --- |
| GET `/agents` | `workbenchId` | `AssistantAgentList` |
| GET `/agents/:agentId` | configuration permission | `AssistantAgentDefinition` |
| POST `/agents` | `AssistantAgentInput`, UUID Idempotency-Key | 201 `AssistantAgentDefinition` |
| PUT `/agents/:agentId` | `AssistantAgentInput`, configuration permission | `AssistantAgentDefinition` |
| GET `/sessions` | `workbenchId`, `agentId`, optional cursor/limit (30 default, 100 max) | `AssistantSessionPage` |
| POST `/sessions` | `AssistantCreateSession` | 201 `AssistantCreateSessionResponse` |
| GET `S` | — | `AssistantSessionSnapshot` |
| DELETE `S` | — | 204; active run: 409 `SESSION_BUSY` |
| POST `S/runs` | `{message:string}` | 202 `AssistantAdmission` |
| GET `R` | — | `AssistantRunSnapshot` |
| GET `R/events` | `afterSeq`, `streamId` from snapshot cursor | SSE |
| POST `R/cancel` | `{}`; includes owned unadmitted run intent | `AssistantCancelResponse` |
| GET `R/artifacts/resolve` | workspace-relative `path` | `AssistantArtifactResolution` |
| GET `F` | — | existing `RuntimeArtifact` |
| GET `F/content` | optional `download=1` | immutable bytes |
| GET `F/dataset-source` | — | `AssistantDatasetSource`; generic file: 404 |
| GET `S/feedback` | optional `runId` | `AssistantFeedbackList` |
| PUT `S/feedback` | `AssistantFeedbackWrite` | `AssistantFeedback` |
| DELETE `S/feedback/:feedbackId` | — | 204 |

JSON success is 200 unless listed otherwise. Creation requires UUID
`Idempotency-Key`, also the session/run ID and identical to its runtime ID. Matching
retries return the original admission; changed input returns 409
`IDEMPOTENCY_CONFLICT`. Reconcile uncertain admission with that ID. Only an active
run blocks another message (`SESSION_BUSY`); no predecessor/revision check is added.
Every next message, including clarification and report follow-up, uses the same
run-creation route and session. No completion endpoint or `needs_input` shape.

Sessions retain their selected agent. Lists sort by descending `(updatedAt,id)`
with opaque keyset cursors; definitions use display order. Disabled agents remain
selectable for history but reject new execution (`AGENT_DISABLED`, 409).
`workbenchId` is code-declared (`business` here). New session title is empty; its
first accepted user message becomes the verbatim title, truncated only for display.
No title model or suggestions. Feature declarations and renderer registrations
belong to the frontend host; action authorization remains server-owned.

Snapshots reuse runtime messages, tools, artifacts and PI `running/stopped`,
`stopReason`, `errorMessage`; merge settled messages by ID in `messageSeq` order,
and replace pending partials. SSE is `event: runtime`, JSON `AssistantStreamFrame`,
`id: <cursor.seq>` for event frames. Preserve IDs/cursors/deltas. On
`snapshot_required` or broken transport, read a fresh snapshot and reconnect from
its cursor; a final stopped snapshot needs no stream. Disconnect never cancels.
Cancel closes host/child gates and cancels child retrievals before runtime; returns
a stopped run, or null if the intent prevented admission. HTTP errors never invent
agent state. `stop` may be a question and is not a business-success claim.

Markdown references resolve by **(runId,path)**: final version for a stopped run,
current version while running, including runtime's inherited baseline. Null means
no registered file. No per-message event boundary or runtime message change.
Content uses media type/length/hash ETag, `nosniff`, safe download names and attachment
disposition for HTML. Render HTML only in the sandbox required by
[agent-artifact-markdown.md](agent-artifact-markdown.md); use its shared prompt
constant. Dataset source associations verify original receipts/digests; the
optional QC field reuses retrieval's result and can be refreshed independently.

Feedback upserts one value per user/session/run/target; dislike requires a reason.
Validate target ownership and derive question/output on the server. Storage remains
in workbench. Errors are `{error:{code,message},correlationId}`: 400
`INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, the 409
codes above, or 503 `DEPENDENCY_UNAVAILABLE`. Never return empty history on read
failure. No credentials/stacks in public errors.

Agent configuration edits prompt, skills and model role under existing management
permission; list responses omit the prompt. Dashboard create/add accepts
`dashboard-artifacts` session/dataset artifact IDs instead of old checkpoint indexes.
