# Published MCP services (`builtin-product-published-mcp`)

Read-only settings panel for inspecting MCP endpoints published by the platform.

## Common flows

- **Inspect published services**: all published services are listed in a single-column vertical card stack. Each card mounts `serviceSummary` (with a one-click copy button on `mcpUrl` and authentication guidance).
- **Browse available tools**: each service card includes a collapsed-by-default **Available tools** disclosure; expanding it mounts `serviceTools` for that service to render each tool's name, description, and collapsible JSON input schema.
