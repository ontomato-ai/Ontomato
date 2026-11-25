# Personal Workspace Panel Guide

This panel (`builtin-product-personal-workspace`) serves the user's personal home workspace at `/home`.

## 1. Adjusting Layout, Visibility, and Opening Preferences (In-Place State)

When the user asks to rearrange blocks, resize cards, hide/show one of the existing blocks (`apps`, `dashboards`, `tasks`, `conversations`, `objects`, `recent`), or change drawer vs. full-page opening behavior, update the panel's personal state directly — no panel copy is needed:

- `layout` (`kind: "grid-layout"`, personal):
  - 12-column grid with group `workspace` and allowed item IDs `["apps", "dashboards", "tasks", "conversations", "objects", "recent"]`.
  - Each item has `{ id, colSpan, rowSpan, hidden? }`. Set `hidden: true` to hide a block, omit `hidden` to show it, reorder items in `groups[0].items`, or adjust `colSpan` (`3..12`) and `rowSpan` (`2..8`).
- `openModeObjects` (`"drawer"` | `"page"`, personal): How pinned objects open when clicked.
- `openModeMetrics` (`"drawer"` | `"page"`, personal): How pinned dashboard cards open when clicked.
- `openModeTasks` (`"drawer"` | `"page"`, personal): How scheduled tasks open when clicked.

## 2. Adding or Removing Custom Content / Blocks on the Personal Workspace

When the user asks to add a new custom widget/block (for example a domain KPI card, filtered object list, or chart), remove a block permanently, or change the workspace layout structure beyond the built-in 6 blocks:

1. **Check current home panel ownership** via the `homeStatus` member (`platform:ProductPanel.homePanel` outputs `isCustomHome` and `panelId`).
2. **First customization (`isCustomHome === false`)**:
   - The user is currently viewing the read-only built-in panel `builtin-product-personal-workspace`.
   - Read the current source files (`panel.json`, `panel.html`, `panel.mjs`, `recipes.md`) of `builtin-product-personal-workspace`.
   - Modify the source according to the user's request while preserving existing fixed blocks:
     - When adding or removing a block in `workspaceGrid`, keep `manifest.state.layout.type.itemIds`, `manifest.state.layout.default`, `workspaceGrid.config.items`, and the corresponding `#item` slot branch in `panel.html` in sync.
     - Keep `homeStatus`, `homeActions` (`productPanels.resetHome`), and the inline `askInline` `ConversationEntry` member intact so the user always retains quick ask and one-click restore.
   - Save the customized copy as a new personal panel via `PUT /api/product-panels/<new-panel-id>`.
   - Set it as the user's personal home panel via `productPanels.setAsHome` (or `PUT /api/platform/home/panel` with `{ homePanelId: "<new-panel-id>" }`).
3. **Subsequent customizations (`isCustomHome === true`)**:
   - Read the user's active custom home panel (`panelId` from `homeStatus`), apply the requested edits, and save directly in-place via `PUT /api/product-panels/<panelId>`.

## 3. Restoring the Default Personal Workspace

When the user asks to revert to the built-in personal workspace:

- Invoke `page_action` on `homeActions.resetHome` (`productPanels.resetHome`), or call `PUT /api/platform/home/panel` with `{ homePanelId: null }`.
- `/home` immediately switches back to `builtin-product-personal-workspace`.
