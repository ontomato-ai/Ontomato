# Metric views catalog: common practice

This page is the full-width catalog of this domain's metric views (`platform:MetricView`): search by name and
description, batch-change publication status on checked rows, click a row to open its full-width detail page
(`/ontology/assets/metrics/detail?selected=<id>`), or click **New Metric View** to open the detail entry in create mode
(`/ontology/assets/metrics/detail?mode=create`).

## Page structure

- `list` reads the owner's unpaged catalog (`list` read, searchable via deep-linked panel state `search`), showing
  the matching total beside the search box and all matching rows with name, description, linked function, origin,
  status, creator, reviewer and last updated time.
- Checking one or more rows reveals the batch publication bar with `batchStatus` (`PENDING_REVIEW`, `PUBLISHED`,
  `UNUSED`) and `publishStatus` (`publishStatus.setStatus` / `metricViews.setStatus`), updating checked rows in one
  batch and reporting per-metric outcomes.
- Clicking a row navigates to `/ontology/assets/metrics/detail?selected=<primaryKey>`.
- Clicking **New Metric View** in the page header navigates to `/ontology/assets/metrics/detail?mode=create`.

## Common practice

1. **Look for an existing metric to reuse first.** Search `list` via `search` to locate candidate metrics, then open
   candidates on `/ontology/assets/metrics/detail?selected=<id>` to compare complete logic — grain, scope, filters,
   time semantics, denominators and null handling — before creating a new metric.
2. **Batch publication status updates.** Check the target metrics (`checked`), set `batchStatus` (`PENDING_REVIEW`,
   `PUBLISHED`, or `UNUSED`), and invoke `page_action({ operation: "publishStatus.setStatus" })` (confirmed in
   conversation by default).
3. **Create or edit a metric.** Open `/ontology/assets/metrics/detail?mode=create` to draft, test, and save a new
   metric view, or open `/ontology/assets/metrics/detail?selected=<id>` to inspect, edit, test, or delete an existing
   metric view.
