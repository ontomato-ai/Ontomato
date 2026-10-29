# Runtime-owned external MCP services

Implemented 2026-10-29 after controller review. Extends
[agent-runtime](agent-runtime.md); [the design](../../docs/external-mcp-runtime-design.md)
owns placement and replacement scope.

## Ownership and management HTTP

Runtime owns **(hostId, domainId, id)** configuration; each service has an immutable
UUID assigned by runtime and a unique name within its host/domain. The service credential
determines host; `X-Domain-Id` carries the host-verified domain. Every operation
uses this scope, with no global fallback or body-supplied host/domain. Workbench
owns its existing management permission and service selector.

Browser, host and runtime share [src/agent-runtime-mcp.ts](src/agent-runtime-mcp.ts);
tool metadata reuses the MCP contract:

```ts
type McpServiceView = {
  id: string; name: string; url: string; headers: Record<string, "********">;
};
type McpServiceWrite = {
  name: string; url: string; headers?: Record<string, string | null>;
};
```

Names remain trimmed, case-sensitive, nonempty and at most 100 characters; URLs
are HTTP(S). Header names use HTTP validation, reject duplicate case variants and
return lowercase. All configuration responses replace values with the fixed mask.

On creation, omitted headers means `{}` and null values are invalid. On update,
omitting `headers` preserves the stored map; supplying it replaces the map.
A string sets that value, null retains the existing value for that header name,
and an omitted key is removed. `{}` clears all headers. Retaining a nonexistent
header or writing the reserved mask is invalid. The existing editor shows saved
masks, sends null for unchanged rows, strings for replacements, and omits deleted
rows. A renamed header needs its value re-entered.

Let `M = /v1/mcp/services`. All routes use the runtime JSON error envelope.

| Method/path | Request | Success |
| --- | --- | --- |
| GET `M/names` | — | 200 `{id:string,name:string}[]` |
| GET `M` | — | 200 `{services:McpServiceView[]}` |
| POST `M` | `McpServiceWrite` | 201 `{service:McpServiceView}`; create only |
| PUT `M/:id` | `McpServiceWrite` | 200 `{service:McpServiceView}`; existing row only |
| DELETE `M/:id` | — | 204 |
| GET `M/:id/tools` | — | 200 `{tools:McpToolDesc[]}`; discover using stored credentials |

Lists sort by name. Errors: 404 `NOT_FOUND`, 409 `MCP_NAME_EXISTS`, 400
`INVALID_REQUEST`, 502 `MCP_DISCOVERY_FAILED`, and existing credential 401.
Failed reads never become empty lists. PUT changes name/URL/headers, preserving id;
agent references therefore follow renames automatically. Management writes have
no automatic retry.

Workbench keeps the same suffixes under `/api/mcp/services` and forwards using
its service credential and verified domain, including discovery cancellation.
The selector requires domain identity; all other operations retain
`guardMcpServiceManagement`. List/discovery bodies use the shared shapes; mutation
responses retain existing `{success:true}` (POST 201, PUT/DELETE 200). Errors map
once to the existing `{success:false,code,error}` boundary, preserving runtime
status/code; unavailable runtime transport returns 503 `DEPENDENCY_UNAVAILABLE`.
No MCP management fields are added to [agent-host](agent-host.md).

## Selection and execution

`definition.externalMcp` is **`{id:string}[]`** (UUIDs). Workbench maps
`enabledMcpServiceIds` directly to these references. At run start, runtime takes
distinct requested IDs intersected with current configuration in the run's
host/domain. Missing/deleted IDs are ignored;
empty selection exposes no external tools. Child and auxiliary runs use their own
definitions; they do not implicitly inherit the parent's selection.

Resolved settings stay privately in memory; definitions/history/fingerprints
contain IDs, not URLs/headers. Changes affect the next run. Admission retries
return the original run before resolving again; recovery never replays actions.
Configuration read failure remains an error, not an empty intersection.

Management discovery and execution share the runtime connector. Try Streamable
HTTP first; only initialization `StreamableHTTPError` 400/404/405 permits closing
that transport and trying SSE. Both transports use configured headers, without
forwarding the platform user's credential. Discovery consumes all tool pages;
management closes afterward, execution closes on run termination/cancellation.
Tool actions are never automatically retried. Keep the runtime's unique tool-name
check (including `read/write/edit/bash`); connection/discovery/collision failures
use existing stopped/error semantics, not a second run state or partial tool set.
