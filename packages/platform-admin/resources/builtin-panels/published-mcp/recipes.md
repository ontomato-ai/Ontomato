# Published MCP services (`builtin-product-published-mcp`)

Read-only settings panel for inspecting MCP endpoints published by the platform.

## Common flows

- **Inspect a specific published service**: call `present` on `/settings/mcp-services` with `state.selected` set to `{ className: "platform:PublishedMcpService", primaryKey: "<service-name>" }`.
- **Copy endpoint URL**: the `serviceSummary` projection renders `mcpUrl` with a one-click copy button (`copyableFields: ["mcpUrl"]`).
- **Browse available tools**: `serviceTools` reads the `tools` collection of the selected service and renders each tool's name, description, and collapsible JSON input schema.
