# App builder workspace

Detail panel for inspecting and managing a single `platform:AppWorkspace` at `/app-builder/workspace`.

## Public state

- `workspace` (`platform:AppWorkspace`, `deepLink: true`): The selected workspace.
- `tab` (`string`, `deepLink: true`, default `"files"`): Active view — `"files"`, `"changes"`, `"history"`, or `"releases"`.
- `filePath` (`string`, `deepLink: true`): Selected file path in the workspace tree.
- `fileSearch` (`string`, `deepLink: true`): Filter query in the file tree.
- `diffTarget` (`string`, `deepLink: true`, default `"latest"`): Diff target — `"working"`, `"latest"`, or a commit SHA.
- `renaming` (`boolean`, `deepLink: false`): Opens the rename dialog (`renameForm`).
- `publishing` (`boolean`, `deepLink: false`): Opens the publish dialog (`publishForm`).
- `sessionsOpen` (`boolean`, `deepLink: false`): Opens the linked conversations drawer (`sessionsList`).

## Common flows

### Inspect files or diffs

1. Use `present` with `{ workspace: { className: "platform:AppWorkspace", primaryKey: "<id>" }, tab: "files", filePath: "panel.json" }`.
2. Switch to `tab: "changes"` with `diffTarget: "working"` or `diffTarget: "latest"` (or a commit hash) to view unified diffs.

### Collaborate with the App Builder agent

1. Click **Ask builder agent** (`conversationEntry`) to expand the page-bottom composer bound to the `app-builder` preset agent.
2. Open **Conversations** (`sessionsOpen: true`) to jump to any existing `platform:AgentSession` linked to this workspace.

### Rename or publish the workspace

1. Set `renaming: true`, fill `renameForm` with `fill_form`, and submit via `page_action` (`appWorkspaces.save`).
2. Set `publishing: true`, fill `publishForm` (`/name` on first publish, `/icon`, `/commit`) with `fill_form`, and submit via `page_action` (`appWorkspaces.publish`).

### Restore a commit or roll back a release

1. Switch to `tab: "history"` and invoke `commitsList.restoreCommit` on a non-head commit.
2. Switch to `tab: "releases"` and invoke `releasesList.rollbackRelease` on a non-live release.
