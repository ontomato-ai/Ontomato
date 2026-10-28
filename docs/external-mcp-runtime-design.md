# External MCP configuration in the agent runtime

Implemented 2026-10-29 after controller review; public baseline `cc5ac842`, enterprise `8e125bc`.
Success: configure on the
existing page, select in an agent, call its tools; unselected agents get none.
The [MCP contract](../packages/contracts/agent-runtime-mcp.md) owns wire semantics.

## Placement and replacement

Page → guarded workbench route → existing runtime HTTP client → runtime MCP
service/store. Reuse `RuntimeStore` pool, transactions and schema initialization;
add one table keyed by `(host_id,domain_id,id)`, unique on host/domain/name, with
URL and private headers. Runtime assigns immutable UUIDs.
Additive creation supports the current runtime schema without converting old
workbench data or erasing sessions.

Assistant admission supplies selected IDs; runtime resolves them once.
`tools.ts` owns connection/discovery/calls, also used by management discovery.
The workbench system MCP directory remains a separate consumer.

| Existing path/behavior | Replacement/removal |
| --- | --- |
| `workbench-server/src/services/mcp/service-config.ts` | Delete local persistence/schema; use runtime HTTP client |
| `workbench-server/src/infrastructure/postgres-migrations/20260911-mcp-service-configs/` and its registration | Delete table-creation code; existing table/rows remain untouched and unused until release conversion |
| `workbench-server/src/api/routes/mcp-services.ts` local reads and direct discovery | Runtime operations; preserve authentication, management guard and page URLs |
| `workbench-ui/src/features/mcp/api.ts` schemas; editor plaintext round trip | Shared schemas and mask-aware editing |
| `workbench-server/src/services/assistant/service.ts` / `platform/agent-runtime/runtime.ts` empty external list | Pass this agent's selected IDs; unrelated run definitions retain empty selection |
| `agent-runtime/src/tools.ts` global IDs/host allow-list/transport selection; `RuntimeOptions.mcpServers` | Runtime-owned scoped configuration and automatic initialization negotiation |
| `apps/agent-runtime/src/index.ts` `AGENT_RUNTIME_MCP_SERVERS` parsing | Delete entire environment path and its startup/integration fixtures |
| `contracts/src/agent-runtime.ts` `serverId` references | Shared UUID references; update all producers, consumers and fixtures together |
| `workbench-server/src/services/mcp/client.ts` unused `callMcpTool` and re-export | Delete call path; retain `listMcpTools` for existing system-directory endpoints |

Paths are under `packages/` unless prefixed `apps/`. The old loop's
`external-mcp.ts` is already absent. No old-data conversion or table drop.
`/mcp/analysis-agents`, `/mcp/ops-agent`, system directory behavior and Java MCP
(including enterprise ToolsController) stay outside scope. Enterprise reuses the
public implementation with its existing `mcp-service` guard.

## Approved rename behavior

Controller decision, 2026-10-28: preserve automatic reference following by using
stable IDs. Runtime changes only the service name; definitions keep
`enabledMcpServiceIds`, and the selector renders `{id,name}` options. Management
routes use `:id`. Deleting and recreating a name creates a new ID, so old selections
do not accidentally authorize the replacement. Runtime never writes host definitions.

The new host column is additive and defaults to an empty selection. Old name
columns and configuration rows remain untouched and unread; release conversion
must assign scoped service IDs and translate old references. This module includes
no conversion. Legacy MCP table/column creation paths are removed from startup.

## Verification and handoff

Checks cover durable contracts: scope/selection, masked edit round trips, and
initialization fallback without replaying actions. A local process fixture covers
discovery/call mechanics. Obsolete tests are removed; validation includes TS/Vue
checks, lint and both Maven compiles. No exception matrix.

Controller owns main-directory page → selection → actual tool call, the unselected
comparison, image builds and registry smoke. Host proxy, PI state and artifact
Markdown stay unchanged. Merge against whichever concurrent module enters develop
first. Report InfoHub state/release-conversion follow-up to the controller.
