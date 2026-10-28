# Runtime-owned external MCP services

Proposed 2026-10-28; **not implemented, awaiting controller review**. Replaces the
`serverId` path in [agent-runtime](agent-runtime.md). Placement, deletions and the
rename decision belong to [the design](../../docs/external-mcp-runtime-design.md).

## Ownership and management HTTP

Runtime owns **(hostId, domainId, name)** configuration. The service credential
determines host; `X-Domain-Id` carries the host-verified domain. Every operation
uses this scope, with no global fallback or body-supplied host/domain. Workbench
owns its existing management permission and names-only selector.

Browser, host and runtime share these schemas in `src/agent-runtime-mcp.ts`;
tool metadata reuses the MCP contract:

```ts
type McpServiceView = {
  name: string; url: string; headers: Record<string, "********">;
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
| GET `M/names` | — | 200 `{names:string[]}` |
| GET `M` | — | 200 `{services:McpServiceView[]}` |
| POST `M` | `McpServiceWrite` | 201 `{service:McpServiceView}`; create only |
| PUT `M/:name` | `McpServiceWrite` | 200 `{service:McpServiceView}`; existing row only |
| DELETE `M/:name` | — | 204 |
| GET `M/:name/tools` | — | 200 `{tools:McpToolDesc[]}`; discover using stored credentials |

Lists sort by name. Errors: 404 `NOT_FOUND`, 409 `MCP_NAME_EXISTS`, 400
`INVALID_REQUEST`, 502 `MCP_DISCOVERY_FAILED`, and existing credential 401.
Failed reads never become empty lists. PUT renames atomically within runtime;
host reference behavior awaits review. Management writes have no automatic retry.

Workbench keeps the same suffixes under `/api/mcp/services` and forwards using
its service credential and verified domain, including discovery cancellation.
Names require domain identity; all other operations retain
`guardMcpServiceManagement`. List/discovery bodies use the shared shapes; mutation
responses retain existing `{success:true}` (POST 201, PUT/DELETE 200). Errors map
once to the existing `{success:false,code,error}` boundary, preserving runtime
status/code; unavailable runtime transport returns 503 `DEPENDENCY_UNAVAILABLE`.
No MCP management fields are added to [agent-host](agent-host.md).

## Selection and execution

Replace `definition.externalMcp: {serverId:string}[]` with **`{name:string}[]`**.
Workbench maps `enabledMcpServiceNames` directly to these references. Only runtime
resolves them: once per new run, take distinct requested names intersected with
current configuration in that run's host/domain. Missing/deleted names are ignored;
empty selection exposes no external tools. Child and auxiliary runs use their own
definitions; they do not implicitly inherit the parent's selection.

Resolved settings stay privately in memory; definitions/history/fingerprints
contain names, not URLs/headers. Changes affect the next run. Admission retries
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
