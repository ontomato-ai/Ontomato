# Dashboards Panel Guide / 仪表盘面板使用指南

This panel (`builtin-product-dashboards`) renders user dashboards at `/dashboards` with deep-linkable board and card selection.

## Public State & Deep Links

- `dashboardId` (`platform:Dashboard`): Active dashboard tab. Encoded as `?dashboardId=<id>`.
- `cardId` (`platform:DashboardCard`): Active selected card within the board. Encoded as `?dashboardId=<id>&cardId=<cardId>` (parent prefix omitted automatically in short deep links).
- `cardDialog` (`"parameters"` | `"metricSource"` | `null`, non-deep-link): Opens the card parameter editor (`cardParamForm`) or metric source summary (`cardMetricSource`) dialog for the selected `cardId`.

## Common Workflows

1. **Open a dashboard or focus a card**:
   - Navigate with `present({ target: "/dashboards?dashboardId=<boardId>" })` or `present({ target: "/dashboards?dashboardId=<boardId>&cardId=<cardId>" })`.
   - Switching `dashboardId` preserves `cardId` if it belongs to that board and clears it otherwise.

2. **Create, rename, or delete a dashboard**:
   - Create: call `page_action` on `createBoard` (`dashboards.create`) with `{ name }`. The newly created board is automatically selected.
   - Rename: call `page_action` on `boardGrid.renameBoard` (`dashboards.rename`) with `{ name }`, or use the row action on `boardTabs`.
   - Delete: trigger `boardTabs.remove` (`dashboards.delete`), which presents the platform impact confirmation dialog.

3. **Manage groups and layout**:
   - Create group: call `page_action` on `boardGrid.createGroup` (`dashboards.createGroup`) with `{ title, insertIndex? }`.
   - Rename group: call `page_action` on `boardGrid.renameGroup` (`dashboards.renameGroup`) with `{ groupId, title }`.
   - Delete group: call `page_action` on `boardGrid.deleteGroup` (`dashboards.deleteGroup`) with `{ groupId }`.
   - Save layout (group order, card placement, spans, names, or updated `chartFile`): call `page_action` on `boardGrid.saveLayout` (`dashboards.saveLayout`) with `{ groups: [{ id, title, metrics: [...], charts: [...] }] }`.

4. **Edit card parameters**:
   - Select the target card in `cardId` and set `cardDialog` to `"parameters"`.
   - Use `fill_form` on `cardParamForm` to update editable MetricView parameter fields, then save via `platform:DashboardCard.save`. Only that card refreshes after saving.

5. **Inspect metric source or rename/delete a card**:
   - Set `cardDialog` to `"metricSource"` with `cardId` selected to display `cardMetricSource` (backing `MetricView` link, status, and parameters).
   - Rename or delete a card via `boardGrid` row actions (`dashboardCards.rename`, `dashboardCards.delete`).
