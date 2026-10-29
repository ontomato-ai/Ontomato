# Operations diagnosis contract

Implemented, 2026-10-29; main-checkout acceptance remains controller-owned.
[Design](../../docs/ops-diagnosis-runtime-design.md) owns placement, deletion and
page migration; [review](../../notes/design.md) records the approved policy choices.
Executable reference/query schemas are in [src/ops-diagnosis.ts](src/ops-diagnosis.ts).
Ontology resources use the owner facade with ordinary caller credentials; unavailable same-domain observer reads return the explicit evidence gap described below.

## Conversation and target entry

`/api/observe/agent` implements [agent-host](agent-host.md) without new fields or
states. The fixed diagnosis agent uses a UUID selector ID. Runtime messages,
events, cursors and artifacts retain their existing shapes. The workbench verifies
observe access plus user and domain session ownership on every operation, including MCP (D1).

A target action is separate from the common proxy:

| Method/path | Request | Response |
| --- | --- | --- |
| POST `/api/observe/diagnoses` | UUID `Idempotency-Key`; `{target: DiagnosisTarget}` | 201 `AgentHostCreateSessionResponse` |

It validates and binds the target while creating a diagnosis session. Its UUID is
the common/runtime session ID; matching retries recover the same session and target,
changed input returns `IDEMPOTENCY_CONFLICT`. It does not run a model. The caller
then uses the common start-run route with a separate stable run UUID and message.
General diagnosis uses ordinary common session creation with no target. The
server includes the verified target reference in the definition context on each
run; a target is not a credential or a claim of execution failure.

```ts
type DiagnosisTarget =
  | { kind: "assistant-run"; sessionId: UUID; runId: UUID }
  | { kind: "turn"; turnKey: string }
  | { kind: "autotest-case"; testRunId: string; caseId: string };

type DiagnosisEvidence = {
  target: DiagnosisTarget;
  resolvedAt: string;
  runs: Array<{
    owner: "workbench" | "ontology";
    sessionId: UUID; runId: UUID;
    correlationId: string | null;
    artifactIds: UUID[];
  }>;
  logQueries: Array<{
    service: "workbench" | "ontology" | "agent-runtime";
    query: ServiceLogQuery; // Reuse service logging; explicit from/to, no saved cursor.
  }>;
  gaps: Array<{ source: string; code: string; message: string }>;
};
```

`UUID` and timestamp validation reuse runtime contract schemas; `ServiceLogQuery`
denotes the service-logging query schema, not a new diagnosis field list. Owners supply
related-run membership; no ID parsing/prefix search establishes a relationship.
An active target's window ends at resolution time; resolving it later can extend
that window. An inaccessible root target returns 404, not a partial successful
resolution. An authorized target with an unavailable dependent source can return
known references plus a gap; never fabricate a run, artifact or correlation ID.
This reference shape is also the small Turn/case evidence manifest. It contains
no message bodies, log lines or credential-bearing runtime definitions.

## Standard read-only skill

One `ops-diagnosis` package exposes ordinary commands through
`node skills/ops-diagnosis/scripts/ops.mjs <command> ...`. It is both the in-product
and external-harness entry, not a new log product/standalone CLI distribution.
Below, `E` is `/api/observe/evidence`; all operations require existing edition
authentication and observe authorization. Runtime source reads additionally
check domain, resource ownership and owner-provided relationship references.

| Command | Route/input | Provider and output |
| --- | --- | --- |
| `resolve` | POST `E/resolve`, `{target}` | Owner-resolved `DiagnosisEvidence`; no collection, model execution or writes |
| `logs` | GET `E/logs/:service`, shared log query parameters | Single-service `LogPage`, unchanged; service enum `workbench`, `ontology`, `agent-runtime` |
| `session` | GET `E/runtime/:owner/sessions/:sessionId` | Authorized `AgentHostSessionSnapshot`; no environment/system prompt exposure |
| `run` | GET `E/runtime/:owner/sessions/:sessionId/runs/:runId` | Authorized `AgentHostRunSnapshot`; verify run belongs to the session |
| `artifact` | GET `E/runtime/:owner/sessions/:sessionId/artifacts/:artifactId` and `/content` | Existing `RuntimeArtifact` / immutable bytes; verify session ownership and artifact membership |
| `config` | GET `E/config` | Existing `diagnostic-config` safe configuration view from `/businessConfig/getConfigAndDesc`; CLI may select a top-level section after validation; never expose raw config |
| `health` | GET `E/health` | Existing read of `/maintenance/getserviceinfo`; safe status data, no start/stop/restart operation |
| `metadata` | GET `E/metadata`, `format=json\|markdown` | Existing `/admin/getSchema` or `/admin/getschemamarkdown-v2` read under the caller's credentials |
| `query` | POST `E/query`, `{query: object, limit?: integer}` | `{dsl: query}` to `/ontology/query/execute-dsl`; current user/data permissions, bounded result preview |
| `knowledge` | GET `E/knowledge` or `E/knowledge/content?path=...` | Existing workbench knowledge tree / `KnowledgeMarkdownFile`; Markdown-only root-relative read, reject traversal and links escaping the knowledge root |

The `owner` route parameter is a closed provider enum, never a URL, host credential
or runtime `hostId` override. Workbench assistant evidence retains its existing
same-domain observer scope; diagnosis sessions use D1's policy. The ontology
branch requires its owner's authorized evidence facade (D2); a workbench runtime
credential cannot read ontology-owned resources. Before proxying, resolve the
session through an authorized assistant/diagnosis record or the owner's related-run
index; possession of a runtime ID alone never admits a read. Artifact content retains its
hash/length/media type, safe filename and content security headers. Read operations
must not trigger retrieval, formal reruns, QC, cancellation or retention changes.

Configuration, health, metadata and knowledge reuse existing response contracts
and safe projections rather than exposing arbitrary upstream bodies. The script
may render a bounded human-readable preview, but must identify the source and
omitted range. Query keeps the existing sample maximum of 25 and 30-second timeout;
its result carries returned sample count and the upstream truncation indicator/
hint. The new bounded query response is:

```ts
type DiagnosisQueryPreview = {
  rows: JsonValue[];
  receivedRowCount: number;
  upstreamTruncation: {
    truncated: true; rowLimit?: number; truncationHint: string;
  } | null;
};
```

`receivedRowCount` counts rows received from the ontology call before sampling,
not the total matching data. `rows.length < receivedRowCount` identifies local
sampling independently of upstream truncation. Keep null/false/zero/empty values;
do not shorten values into invalid JSON. The script may abbreviate displayed text
with an explicit notice. Never claim a total from a truncated sample. Operational
failures are errors, not successful empty data. Shared executable reference/query-preview schemas live in `contracts/src/ops-diagnosis.ts` and are consumed by the HTTP boundary and feature pages. The portable script uses these validated HTTP responses without importing repository TypeScript.

## Logs: reuse the service contract

All filters, defaults, time bounds, cursor rules, IDs, `LogPage`, retention
limitations and errors are defined **only** by
[service-logging.md](service-logging.md). The integrated service-logging implementation owns this contract.

The evidence route is a restricted callback alias to the existing provider:

| Service | Existing boundary reused |
| --- | --- |
| Workbench | `/api/observe/logs` and its query service |
| Ontology | Existing authenticated workbench backend proxy to `/observe/logs` |
| Agent runtime | `/api/observe/runtime-logs`, which alone holds the host credential for `/v1/logs` |

No endpoint aggregates services, queries another service's table, reads a file or
parses a former log format. The caller can query all three independently and retain
each source's gaps. The script passes cursors/filters through, prints the effective
window and continuation marker, and stops at the requested page instead of silently
scanning history. HTTP trace headers describe the diagnosis request; query
parameters describe the source run being diagnosed. No raw-log export option is
added. Logs read during reasoning may appear in runtime tool history; they are not
separately archived into a Turn workspace.

## Credentials and errors

The package documents `ONTOMATO_WORKBENCH_URL` (before `/api`), `ONTOMATO_TK`,
`ONTOMATO_RUN_ID`, `ONTOMATO_SESSION_ID`, `ONTOMATO_CORRELATION_ID` and
`ONTOMATO_LANGUAGE`. Runtime provides its reserved variables; an external harness
uses its normal authenticated identity and does not need a fabricated runtime run.
For external API-key use, optional `ONTOMATO_API_KEY` maps to the existing
`X-API-Key` header; reject simultaneous TK/API-key configuration rather than guess
which identity wins. Never print or persist either credential in evidence.
An explicit environment value
wins over any external local configuration, following existing standard skills.

In product, `ONTOMATO_TK` is the existing sealed callback capability restricted to
`/api/observe/evidence/`, run ID and expiry. Scripts forward runtime identity and
correlation headers using the existing header constants. The server unwraps it,
reauthenticates the caller and authorizes the particular read. No unrestricted
user credential, runtime service credential or query exploration grant is installed
in the worker. Ordinary user credentials remain supervisor-side for the temporary
model-configuration adapter. New runs obtain fresh callbacks; an expired callback
fails explicitly and cannot be refreshed by a model-controlled endpoint.

No shell-conversation mutation, test start, host file operation, service command,
arbitrary backend URL or user-provided SQL is available below this prefix. The
existing callback middleware's GET/POST allowance is not itself a read-only
guarantee: each admitted POST here is an explicitly read-only resolver/query.
Owner authorization and ontology DSL validation are mandatory even if the UI or
skill description calls an operation read-only.

Outside the unchanged log errors, use `AgentHostError`: 400 `INVALID_REQUEST`,
401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 503
`DEPENDENCY_UNAVAILABLE`; preserve safe upstream evidence gaps without credentials
or stacks. No partial/failed source is rewritten into an empty successful source.

## External operations MCP compatibility

Keep transport and path `/mcp/ops-agent`, installed product server name, version
`1.0.0`, one tool `send`, and its input schema `{message?: string, sessionId?: string}`.
Trim both inputs as today. With a nonempty message, create a session when absent
and start one run; with only sessionId, inspect/wait for its latest run. With
neither, return the existing invalid-input error. The existing wait is 50 seconds;
expiry returns running and never stops/restarts the run.

Preserve the existing text-content JSON payloads:

```ts
{ status: "running", sessionId }
{ status: "completed", sessionId, answer }
{ status: "failed", sessionId, error }
{ success: false, code, error }
```

Translate only at this external compatibility boundary:

- Runtime `running` -> `running`.
- Stopped `error`/`aborted` -> `failed` with a safe error.
- Other stopped PI outcomes -> the legacy `completed` payload containing the
  latest assistant text from **that run**, or an empty string if none. `completed`
  only means the old wait finished: length/toolUse and a clarifying question do
  not become claims that diagnosis succeeded. Preserve the PI fact in shell/history.
- Empty new session -> the existing completed/empty-answer behavior. Invalid input,
  missing session and busy admission retain `INVALID_CHAT_INPUT`,
  `SESSION_NOT_FOUND`, `RESPONSE_BUSY`; dependency failures use the existing
  `{success:false,code,error}` shape, not a fake failed run.

Authorization is rechecked on send and poll. Observing a known session ID is not
authorization. Poll after workbench restart uses persisted references plus runtime
snapshots; there is no in-memory response stream dependency. Server-side retries
reuse the admitted UUID; the legacy MCP input has no caller idempotency key, so a
client resending `message` is still a new turn, not exactly-once delivery. Do not
add a new tool, run ID field or diagnosis completion protocol to resolve this.
