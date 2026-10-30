# Service logging contract

Reviewed 2026-10-28; implemented in stage two, 2026-10-29. This contract
replaces service-specific application/agent log formats. Runtime messages,
model-call records and audit records keep their existing owners and semantics.
[Design](../../docs/service-logging-design.md) owns implementation placement.

## One event, three outputs

[service-logging-format.json](src/service-logging-format.json) is the shared definition
of field order, spelling, enums, limits and approved defaults. Both Node services
load it; Maven packages that same resource for Java. Do not hand-copy its field
lists or maintain a second Java pattern. The prose below defines its semantics;
the [fixtures](src/service-logging-fixtures.json) are common cross-language examples.

Create an event UUID and millisecond UTC timestamp once, capture context, normalize
and bound the event, then fan out to stdout, file and PG. The first two receive
identical UTF-8 bytes, including one LF, without color. PG stores the same line
without its terminating LF and indexed projections of the same event. A PG
outage may lose that copy; it must not delay either other output or the business.

The prefix is `time level`; remaining fields are `key=value`, in the JSON-defined
order, separated by one ASCII space. All base fields appear. Missing context is
`-`, not an empty string or an invented domain/user. Enum tokens and integers are
unquoted; other values are JSON string literals. Escape quotes, backslashes,
control characters and U+2028/U+2029; keep other Unicode literal and replace lone
surrogates with U+FFFD before encoding. A stack is one escaped value, never a
second physical line. Unknown fields are not appended.

`service` identifies a runtime boundary, not an edition. `module` is a stable
logger name. `instanceId` identifies the process's configured node/container
(local fallback: hostname plus PID). `id` identifies this log event only.
`correlationId` joins a causal chain; `runId` identifies the executing runtime
run/code execution when known; `sessionId` identifies its session, or the local
backend session when no runtime session exists. These IDs are independent;
never infer one from another or use prefix matching. Runtime messages and tool
outputs are not service-log events.

For `kind=http`, append all HTTP fields: uppercase method, path without query
or fragment, status (null/`-` if no response was sent), monotonic elapsed whole
milliseconds and outcome. For `kind=downstream`, append a credential-free
logical target, duration and outcome; retries produce separate completion
events under the same correlation. An exception adds the error group last:
exception class, optional stable code and full cause/stack before bounding.
An HTTP error without an exception need not invent a stack. Ordinary app events
have no kind-specific suffix. Default INFO covers business request completions
and lifecycle events; health checks, heartbeat/chunk events and log-query polling
do not produce INFO noise.

## Payload and truncation

Never log result rows, request/response bodies, prompts, messages, tool output,
credentials or raw headers. Producers report safe counts, byte sizes, resource
references and outcomes instead. In particular, a large data query records a
summary, not even the head/tail of its dataset. Head/tail truncation applies to
necessary diagnostic text such as an exception; it is not permission to log data.

Limits count UTF-8 bytes of the **encoded JSON literal**, including quotes.
For an oversized text field with limit L, reserve the JSON quotes and the
configured marker reserve R; take the longest whole-scalar prefix fitting
`floor((L - 2 - R) / 2)` encoded bytes and the longest non-overlapping suffix
fitting the remaining budget. Insert the configured marker between them. Its
count is the UTF-8 bytes of the omitted **unescaped, normalized** middle.
Never cut a scalar or escape sequence; the reserved marker space is not refilled.
The same bounded value is used in every output. No arbitrary object serialization
or second, unbounded PG payload is permitted.

Identity values are never shortened to a different identity. An oversized logging
identity becomes null/`-` in both the line and indexed columns; append only its
field name to the bounded message as `invalid log context: <field>`. This does not
reject a business operation. Incoming correlation IDs use the shared ASCII
pattern; absent/invalid values get a UUID at the public request boundary. The
fixed field set and individual budgets fit within the shared whole-line limit.

## Query boundary

Each endpoint queries only its service's PG table:

| Service | GET endpoint | Authentication |
| --- | --- | --- |
| Workbench | `/api/observe/logs` (replaces its file-backed implementation) | Existing edition authentication and observe permission |
| Ontology | `/observe/logs` | Existing log-read login check |
| Agent runtime | `/v1/logs` | Existing validated host service credential |

Logs remain environment evidence: `domainId` is an optional filter, not a new
authorization rule. Workbench retains its observe gate, including enterprise
domain + observer requirements. The new runtime endpoint grants authenticated
hosts access to service logs only; session/run/artifact access remains host +
domain scoped. Diagnostic skills reach it through an observe-authorized,
single-service workbench proxy at `/api/observe/runtime-logs`; no service token
enters a sandbox. Java retains its existing user-credential boundary and proxy
route. No endpoint aggregates tables or exposes SQL/file paths.

Filters are ANDed: `correlationId`, `runId`, `sessionId`, `domainId`, `userId`,
`instanceId`, `module` are exact strings; `minLevel` uses the shared severity order;
`from` inclusive and `to` exclusive are UTC millisecond timestamps. Omitted `to`
is request time; omitted `from` is `to - defaultWindowMs`. A run-only lookup can
supply its persisted start/end window; it is not an unbounded history scan.
`limit` uses the shared defaults/bounds. Invalid values or `from >= to` return 400.

Return plain JSON with no edition envelope:

```ts
type LogPage = {
  service: "workbench" | "ontology" | "agent-runtime";
  window: { from: string; to: string };
  records: Array<{
    id: string; time: string; level: string; module: string; instanceId: string | null;
    correlationId: string | null; domainId: string | null; userId: string | null;
    runId: string | null; sessionId: string | null; line: string;
  }>;
  nextCursor: string | null;
  storage: { mode: "best-effort"; retentionDays: number };
};
```

Sort by `(time ASC, id ASC)` and use an opaque base64url JSON cursor containing
the last returned `(time,id)` and effective window; it is not an offset or an
authorization token. On continuation, the cursor supplies omitted window bounds;
explicit bounds must match. Validate it and reuse the same filters/window on the
next page. Read at most `limit + 1` rows to determine `nextCursor`. Concurrent delayed
inserts and retention mean this is not a complete historical snapshot; a caller
may repeat a bounded window and deduplicate IDs. Empty PG results return 200 and
an empty array, never a claim that no execution happened. A missing/unavailable
log store returns 503; unexpected query failure returns 500, not an empty page.
Errors use `{error:{code,message},correlationId}`, with safe messages and codes
`INVALID_LOG_QUERY`, `UNAUTHENTICATED`, `FORBIDDEN`, `LOG_STORE_UNAVAILABLE`, or
`LOG_QUERY_FAILED`. Do not silently fall back to parsing files.

## Correlation propagation

Use the shared header names end to end. Workbench request context and Java MDC
accept/normalize correlation once and echo it in the response; outbound clients
forward that value, including retries, async jobs and skill callbacks. Runtime
admission keeps its existing mandatory correlation header and persists the first
accepted run correlation. A replay/continuation does not relabel an older run.
All host requests must normalize before calling the runtime's strict boundary.

Run/session headers are observational hints; existing callback/query-grant checks
still validate their bound run. Credential-derived domain/user and resource-owned
run/session values win over hints. Only a validated host may supply the new user
attribution header to the runtime; snapshot it with the admitted run/code
execution for async logs. Public Java/Node entries never trust that user header.
The runtime already owns `ONTOMATO_CORRELATION_ID`, `ONTOMATO_RUN_ID` and
`ONTOMATO_SESSION_ID`; standard skill HTTP clients forward their available values.
Each Python execution has its own bound credential and runtime run ID.
Code-execution logs identify their own
execution and join parent runs by correlation. Async work restores captured
context and clears it on completion; never log the credential-bearing context
object itself.
