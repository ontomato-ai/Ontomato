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
   - Rename: call `page_action` on `boardGrid.renameBoard` (`dashboards.rename`) with `{ name }`, or use the in-place tab rename action on `boardTabs` (pill tab strip).
   - Delete: trigger `boardTabs.remove` (`dashboards.delete`), which presents the platform impact confirmation dialog.

3. **Manage groups and layout**:
   - Create group: call `page_action` on `boardGrid.createGroup` (`dashboards.createGroup`) with `{ title, insertIndex? }`.
   - Rename group: call `page_action` on `boardGrid.renameGroup` (`dashboards.renameGroup`) with `{ groupId, title }`.
   - Delete group: call `page_action` on `boardGrid.deleteGroup` (`dashboards.deleteGroup`) with `{ groupId }`.
   - Save layout (group order, card placement, spans, names, or updated `chartFile`): call `page_action` on `boardGrid.saveLayout` (`dashboards.saveLayout`) with `{ groups: [{ id, title, metrics: [...], charts: [...] }] }`.
   - Preview whole-board edits before saving: call `fill_form` on `boardGrid` (supports `groups`, `name`, `groupRenames`, `itemRenames`, `itemOverrides` with chart `fileOverride`, `highlightedIds`, and `summary`); the grid shows an unsaved preview banner, highlights changed cards, locks manual layout edits until saved or discarded, and persists through `boardGrid.saveLayout`.

4. **Edit card parameters**:
   - Select the target card in `cardId` and set `cardDialog` to `"parameters"`.
   - Use `fill_form` on `cardParamForm` to update editable MetricView parameter fields; modified fields appear in a bordered before/after change summary below the form before saving via `platform:DashboardCard.save`. Only that card refreshes after saving.

5. **Inspect chart data, zoom, metric source, or rename/delete a card**:
   - Chart card headers provide hover controls to expand the chart/table into a fullscreen zoom modal, toggle between the drawn chart and the formatted data table (with a "View metric" footer action), edit parameters, or open rename/delete actions; truncated results show a warning icon beside the card title.
   - Set `cardDialog` to `"metricSource"` with `cardId` selected to display `cardMetricSource` (bordered single-column summary with backing `MetricView` link, status, and aligned key-value parameters) and the footer `cardMetricOpen` (`ObjectRefCard`) button to navigate directly to the metric detail page.
   - Rename (prefilled with the current card name) or delete a card via `boardGrid` row actions (`dashboardCards.rename`, `dashboardCards.delete`).
