# External MCP configuration in the agent runtime

Segment 1 proposal, 2026-10-28; public baseline `cc5ac842`, enterprise `8e125bc`.
**Documentation only; awaiting controller review.** Success: configure on the
existing page, select in an agent, call its tools; unselected agents get none.
The [MCP contract](../packages/contracts/agent-runtime-mcp.md) owns wire semantics.

## Placement and replacement

Page → guarded workbench route → existing runtime HTTP client → runtime MCP
service/store. Reuse `RuntimeStore` pool, transactions and schema initialization;
add one table keyed by `(host_id,domain_id,name)` with URL and private headers.
Additive creation supports the current runtime schema without converting old
workbench data or erasing sessions.

Assistant admission supplies selected names; runtime resolves them once.
`tools.ts` owns connection/discovery/calls, also used by management discovery.
The workbench system MCP directory remains a separate consumer.

| Existing path/behavior | Replacement or removal in segment 2 |
| --- | --- |
| `workbench-server/src/services/mcp/service-config.ts` | Delete local persistence/schema; use runtime HTTP client |
| `workbench-server/src/infrastructure/postgres-migrations/20260911-mcp-service-configs/` and its registration | Delete table-creation code; existing table/rows remain untouched and unused until release conversion |
| `workbench-server/src/api/routes/mcp-services.ts` local reads and direct discovery | Runtime operations; preserve authentication, management guard and page URLs |
| `workbench-ui/src/features/mcp/api.ts` schemas; editor plaintext round trip | Shared schemas and mask-aware editing |
| `workbench-server/src/services/assistant/service.ts` / `platform/agent-runtime/runtime.ts` empty external list | Pass this agent's selected names; unrelated run definitions retain empty selection |
| `agent-runtime/src/tools.ts` global IDs/host allow-list/transport selection; `RuntimeOptions.mcpServers` | Runtime-owned scoped configuration and automatic initialization negotiation |
| `apps/agent-runtime/src/index.ts` `AGENT_RUNTIME_MCP_SERVERS` parsing | Delete entire environment path and its startup/integration fixtures |
| `contracts/src/agent-runtime.ts` `serverId` references | Shared name references; update all producers, consumers and fixtures together |
| Workbench `services/mcp/client.ts` unused `callMcpTool` and re-export | Delete call path; retain `listMcpTools` for existing system-directory endpoints |

Paths are under `packages/` unless prefixed `apps/`. The old loop's
`external-mcp.ts` is already absent. No old-data conversion or table drop.
`/mcp/analysis-agents`, `/mcp/ops-agent`, system directory behavior and Java MCP
(including enterprise ToolsController) stay outside scope. Enterprise reuses the
public implementation with its existing `mcp-service` guard.

## One decision for the controller: rename references

`saveMcpServiceConfig` currently renames configuration and rewrites this domain's
`assistant_agents.enabled_mcp_service_names` in one transaction. Across HTTP that
transaction is lost; runtime cannot write host definitions, and a best-effort
second write cannot preserve the guarantee.

**Recommendation for approval:** rename only the runtime entry. Agent selections
keep the old name (as on deletion) and stop matching next run; administrators
reselect in the existing editor. This changes the old automatic reference-following
behavior and needs explicit approval under the requirement to keep page interactions.
If automatic following is required, the controller must settle that boundary
before segment 2. No aliases or distributed transaction are proposed.

## Verification and handoff

Segment 2 checks durable contracts: scope/selection, masked edit round trips, and
initialization fallback without replaying actions. A local process fixture covers
discovery/call mechanics. Delete obsolete tests; run applicable TS/Vue checks,
lint and both Maven compiles. No exception matrix.

Controller owns main-directory page → selection → actual tool call, the unselected
comparison, image builds and registry smoke. Host proxy, PI state and artifact
Markdown stay unchanged. Merge against whichever concurrent module enters develop
first. Report InfoHub state/release-conversion follow-up to the controller.
