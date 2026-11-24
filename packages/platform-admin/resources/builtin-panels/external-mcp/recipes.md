# External MCP services (`builtin-product-external-mcp`)

Settings panel for registering and managing external MCP services that agents can call.

## Common flows

- **Search services**: set `state.search` to filter the table locally by service name or address.
- **Add a service**: call `present` with `state.creating = true` to open `createForm`, use `fill_form` for `/name` and `/url` (secret header values under `/headers/*/value` must be entered by the operator on the page), and submit `createForm.save` (`platform:ExternalMcpService.create`).
- **Edit a service**: set `state.editingService` to `{ className: "platform:ExternalMcpService", primaryKey: "<id>" }`, edit fields in `editForm`, and submit `editForm.save` (`platform:ExternalMcpService.save`). Leaving stored header values blank retains their existing server-side values.
- **Check connectivity and discover tools on demand**: set `state.inspectedService` to `{ className: "platform:ExternalMcpService", primaryKey: "<id>" }`. The `inspectedTools` projection mounts only while `inspectedService` is active so external endpoints are never probed automatically on list load.
- **Delete a service**: invoke row operation `services.delete` (`externalMcp.delete`) on the target service.
