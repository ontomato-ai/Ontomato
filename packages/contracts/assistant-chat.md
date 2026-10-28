# Assistant host HTTP contract

Proposed batch 3 contract, 2026-10-28; endpoints are not implemented yet.
[src/assistant-chat.ts](src/assistant-chat.ts) owns executable shapes and exported
types (`@ontomato/contracts/assistant-chat`). [Design](../../docs/assistant-unification-design.md)
owns placement. The frontend line owns `agent-shell` declarations and data ports;
this document defines the HTTP adapter those ports can call.

## Identity and admission

All routes are relative to the host API base, use existing verified user/domain
authentication and request language, and return plain JSON unless stated otherwise.
The browser never connects to runtime or receives its service credential,
environment, system prompt or resolved definition. Every resource access checks
domain **and user**, including streams, files and feedback. An inaccessible object
returns 404. Same-domain governance/diagnosis reads use their separately authorized
internal evidence service, not a browser-selectable scope.

Session/run creation requires a UUID `Idempotency-Key`, also the created ID. Host
session IDs equal their runtime session IDs; run IDs also remain unchanged across
host/runtime. Agent IDs are host definition UUIDs. Matching-key retries return the
original admission before checking busy/latest-run state; changed input returns
409 `IDEMPOTENCY_CONFLICT`. Deletion leaves tombstones (410 `RESOURCE_DELETED`).
Host persists owned admission/gates before runtime admission; an uncertain network
response is reconciled using the same ID, never submitted under a new key.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/api/assistant/agents` | Required `workbenchId` | 200 `AssistantAgentList` |
| GET `/api/assistant/sessions` | Required `workbenchId`, `agentId`; optional opaque `cursor`, `limit` (default 30, maximum 100) | 200 `AssistantSessionPage` |
| POST `/api/assistant/sessions` | `AssistantCreateSession` | 201 `AssistantCreateSessionResponse` |
| GET `/api/assistant/sessions/:sessionId` | None | 200 `AssistantSessionSnapshot` |
| DELETE `/api/assistant/sessions/:sessionId` | None | 204; running or unresolved admission: 409 `SESSION_BUSY` |
| POST `/api/assistant/sessions/:sessionId/runs` | `AssistantStartRun` | 202 `AssistantAdmission` |
| GET `/api/assistant/sessions/:sessionId/runs/:runId` | None | 200 `AssistantRunSnapshot` |
| GET `/api/assistant/sessions/:sessionId/runs/:runId/events` | Required `afterSeq`, `streamId` from snapshot cursor | SSE below |
| POST `/api/assistant/sessions/:sessionId/runs/:runId/cancel` | `{}`; also valid for the caller's unadmitted run intent | 200 `AssistantCancelResponse` |
| GET `/api/assistant/sessions/:sessionId/runs/:runId/artifacts/resolve` | Required workspace-relative `path`, integer `atSeq` | 200 `AssistantArtifactResolution` |
| GET `/api/assistant/sessions/:sessionId/artifacts/:artifactId` | None | 200 existing `RuntimeArtifact` |
| GET `/api/assistant/sessions/:sessionId/artifacts/:artifactId/content` | Optional `download=1` | Authorized immutable bytes |
| GET `/api/assistant/sessions/:sessionId/artifacts/:artifactId/dataset-source` | None | 200 `AssistantDatasetSource`; 404 if not an accepted dataset |
| GET `/api/assistant/sessions/:sessionId/feedback` | Optional `runId` | 200 `AssistantFeedbackList` for the current user |
| PUT `/api/assistant/sessions/:sessionId/feedback` | `AssistantFeedbackWrite` | 200 `AssistantFeedback` |
| DELETE `/api/assistant/sessions/:sessionId/feedback/:feedbackId` | None | 204, owner scoped and idempotent |

Lists use descending `(updatedAt,id)` order and opaque keyset cursors bound to the
filters. Definitions use configured display order; disabled definitions remain
visible with `enabled:false` so history is selectable, but new sessions/runs
require an enabled definition (409 `AGENT_DISABLED`). The returned agent fields
describe the definition; clients cannot submit a replacement prompt, role, skill
set or identity with a chat message. `workbenchId` is a code-declared host key
(`business` in this batch), not a caller-created workspace. The frontend's code
declaration owns feature order, view targets, renderer registration and menu display;
the server enforces the corresponding action permissions independently.

## Conversation and PI state

New sessions have `title:""` and `latestRun:null`. The first accepted message is
preserved verbatim as the title; truncation is display-only. No model title or
suggestion call occurs. Creating a session does not start a model. A session keeps
its agent; selecting another agent selects/creates another conversation.

`AssistantStartRun` is exactly `{message:string, expectedLatestRunId:UUID|null}`.
The message must contain non-whitespace text but is not trimmed or rewritten.
Use null for the first run and the observed latest run ID for subsequent messages.
Only one run can be active. A changed predecessor returns 409 `STALE_RUN`; a busy
session returns 409 `SESSION_BUSY`. Every next message, including a clarification
answer or report follow-up, uses this **same** endpoint and runtime session.
There is no `needs_input`, question-choice payload, completion endpoint or repair run.

Run snapshots reuse PI message, tool and artifact schemas and expose only the
public run fields enumerated in `AssistantRun`. `running/stopped`, `stopReason`
and `errorMessage` come from runtime. `stop` may be a question; neither it nor a
report file proves the user's objective fulfilled. Network errors remain HTTP
errors and never become a synthetic agent result. On cancellation the host closes
its gates and cancels owned child retrievals before settling runtime cancellation.
The response contains a stopped run, or `run:null` when the persisted cancellation
intent prevented admission. Retry an uncertain cancellation under the same run ID.

The session snapshot contains settled history ordered by `messageSeq` and the
latest run snapshot. Merge duplicate settled messages by ID. Pending messages are
full partials through that run cursor and replace matching local partials.
`AssistantMessage.artifactSeq` is the persisted runtime `message_end` event sequence,
not `messageSeq`. Runtime must expose that existing event fact in its message
projection during backend implementation; the baseline does not yet expose it.
The host must not infer it from the latest cursor or maintain a second history.

## SSE and immutable files

Use authenticated fetch streaming through the existing API helper. SSE uses
`event: runtime`, JSON `AssistantStreamFrame` data and `id: <cursor.seq>` for event
frames, exactly as runtime does. Heartbeat comments carry no state. Keep original
session/run/message IDs, event order and cursors; no host completion/event enum is
added. `message_update` and `tool_execution_update` are deltas. On
`snapshot_required`, replace with a fresh snapshot and resubscribe from its cursor.
Closing the browser stream does not cancel the run. A stopped snapshot at its
final cursor needs no subscription. HTTP failures before stream headers use
`AssistantError`; transport failure after headers triggers snapshot reconciliation.

Resolve settled Markdown against `(message.runId,message.artifactSeq)`; a streaming
partial uses its observed run cursor. `artifact:null` means no file existed at
that boundary, not an empty file or a failed run. Resolution includes the runtime's
inherited session baseline; an old message must never select a later overwrite.
Content returns the metadata media type, length and hash ETag; files must belong
to the owned session, and downloads use safe filenames. HTML is fetched as bytes
for the renderer's sandbox, never navigated as a trusted host page; content uses
`X-Content-Type-Options: nosniff` and attachment disposition for HTML/direct downloads.
Do not accept filesystem paths or content hashes as authorization.

Accepted datasets copied from retrieval retain a server-verified source association.
`dataset-source` exposes its retrieval/artifact IDs and the existing retrieval
`qualityCheck` field when available. The frontend can refresh this small projection
after the reply; QC never holds the conversation open. Absence means no published
QC result, not a passing check. Dataset bytes come from the content endpoint;
dashboard/export actions use the verified original source ID, not a filename guess.

Presentation is owned solely by [agent-artifact-markdown.md](agent-artifact-markdown.md),
including inline images, side-panel links, incomplete references and sandboxing.
The host appends `ARTIFACT_MARKDOWN_PROMPT`; it does not copy that rule into another
prompt template. The frontend line owns markstream-vue integration and renderers.

## Feedback and host errors

Feedback has one current value per verified user/session/run/target. PUT upserts
that value; repeated identical requests do not add rows. The target must be an
assistant message or an artifact owned by that run/session; inherited artifacts
use their actual owning run. Dislike requires a nonempty explanation. No request
can supply user/domain, assistant output or authoritative question text. The
service resolves those facts. Storage stays with workbench; runtime migration is
deferred. Existing administration projections read the same feedback owner.

Errors have `{error:{code,message},correlationId}`. Expected codes include
`INVALID_REQUEST` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND`
(404), the 409/410 codes above and `DEPENDENCY_UNAVAILABLE` (503). A failed runtime
read never becomes an empty history, missing file or stopped run. Public messages
exclude stacks and credentials. Internal parsing and resource bounds remain the
server's responsibility; clients import schemas instead of declaring wire twins.
