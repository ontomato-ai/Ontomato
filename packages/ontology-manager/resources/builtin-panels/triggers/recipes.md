# Triggers panel recipes

This panel lists domain `platform:Trigger` definitions in a full-width table with inline Edit, Disable/Publish, and Delete row actions, owner-computed armed and total counts, and a modal dialog for creating or editing a trigger.

## Public state

- `search` (`string`, `deepLink: true`): Filters the triggers table through `platform:Trigger.query`.
- `creating` (`boolean`, `deepLink: false`): Opens the modal with `createForm` (`platform:Trigger.createForm`) to draft a new trigger.
- `editing` (`object: platform:Trigger`, `deepLink: false`): Opens the modal with `editForm` (`platform:Trigger.form`) for the chosen trigger.

## Common flows

1. **Filter the list:** Update `search` with `present({ search: "nightly" })`; clear with `present({ search: "" })`.
2. **Create a trigger:**
   - Open the create dialog with `present({ creating: true })`.
   - Use `fill_form` on `createForm` to fill `/name`, `/description`, `/condition/frequency`, `/condition/timeZone`, `/effectKind`, `/effect/actionId` (or `/effect/workflowId`), `/effect/parameters` (or `/effect/inputs`), `/executor`, and `/status`.
   - Leave the draft unsaved unless the user asks to save; when asked to save, invoke `page_action` for `createForm`'s `platform:Trigger.save`.
3. **Edit a trigger:**
   - Open the edit dialog with `present({ editing: { className: "platform:Trigger", primaryKey: "<id>" } })`.
   - Use `fill_form` on `editForm` to modify fields and leave unsaved until the user asks to save via `page_action`.
4. **Publish / Disable a trigger inline:**
   - Use `page_action` on `triggers` with the row's verbatim `rowKey` (`platform:Trigger:<id>`) and operation `triggers.setStatus` (`publish` when `enabled === false`, `disable` when `enabled === true`).
5. **Delete a trigger inline:**
   - Use `page_action` on `triggers` with the row's verbatim `rowKey` (`platform:Trigger:<id>`) and operation `triggers.delete` (`remove`). Confirmation is enforced by the platform.
