# App builder workspaces

Directory panel for managing `platform:AppWorkspace` records at `/app-builder`.

## Public state

- `search` (`string`, `deepLink: true`): Filters workspaces by name.
- `creating` (`boolean`, `deepLink: false`): Opens the create-workspace dialog (`createForm`).
- `renaming` (`platform:AppWorkspace`, `deepLink: false`): Opens the rename-workspace dialog (`renameForm`) for the targeted workspace.

## Common flows

### Create a workspace

1. Use `present` with `{ creating: true }` (or click **New workspace**).
2. Use `fill_form` on `createForm` to enter `/name`.
3. Use `page_action` to submit `createForm` (`appWorkspaces.create`); on success, the panel navigates to `/app-builder/workspace?workspace=<id>` using the owner-returned workspace ID.

### Open a workspace

1. Filter via `search` if needed.
2. Click a workspace row or its **Open** action to navigate to `/app-builder/workspace?workspace=<id>`.

### Rename a workspace

1. Use `present` with `{ renaming: { className: "platform:AppWorkspace", primaryKey: "<id>" } }` (or click **Rename** on a row).
2. Use `fill_form` on `renameForm` to update `/name`.
3. Use `page_action` to submit `renameForm` (`appWorkspaces.save`).

### Delete a workspace

1. Click **Delete** on a workspace row (or invoke `workspaces.delete` via `page_action`).
2. Confirm the impact summary (active runs block deletion; confirming stops business tests and removes linked conversations).
