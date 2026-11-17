---
name: echarts
description: Build and revise reusable .chart.json chart files from query rows, covering bars, lines, pies, treemaps, funnels, sankey, scatter, radar, sunburst, boxplot, gauge, timeline and graphs.
---

## When to use

Use this skill when a conversation needs a chart that can also be added to a dashboard, an object view or a metric widget. It writes a reusable `.chart.json` file; the platform draws it and, when the file names a MetricView, re-reads that MetricView with current parameters. Use the leaflet or admin-choropleth-map skill for maps.

## Command

Write the input to a JSON file and run:

`node skills/echarts/scripts/index.mjs work/input.json`

The command writes `outputs/<name>.chart.json` and prints the path; reference that path in Markdown. It runs unchanged in an external harness; use the package's local path when installed elsewhere.

The rows must already be at the final grain: counts, shares and other business calculations belong to the MetricView output. The skill selects columns, sorts and limits for display only.

## Input

```json
{
  "chartType": "bar",
  "name": "staff-by-department",
  "dataset": "outputs/staff.dataset.json",
  "fields": { "xAxis": "department", "yAxis": "headcount" },
  "display": { "sort": [{ "field": "headcount", "order": "desc" }], "displayLimit": 10 },
  "source": { "metric": { "metricId": "metric-id", "parameters": { "year": 2025 } } }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `chartType` | yes | Type from the table below. |
| `name` | yes | Output file name without a directory or extension. |
| `data` | one of | Row objects already in the input file. |
| `dataset` | one of | Data file to read: an accepted `.dataset.json` or a JSON array/`{ "rows": [...] }`. |
| `fields` | yes | Roles from the table mapped to real column names. |
| `display` | no | Display settings below. |
| `seriesNames` | no | Series column to legend name. |
| `axisNames` | no | `{ "x": "...", "y": "...", "y2": "..." }` axis names. |
| `graphInput` | for graphs | `object` or `edges`. |
| `source` | no | Data source reference below. |

`dataset` and a `source.dataset.path` are paths in the workspace directory the command runs in.

## Chart types and roles

Roles are literal column names. A value ending in `?` is optional.

| `chartType` | Roles |
| --- | --- |
| `bar`, `line`, `area-line`, `pictorial-bar` | `xAxis`, `yAxis` (one column or several numeric columns) |
| `bar-line` | `xAxis`, `barSeries` (one or more), `lineSeries` |
| `pie`, `donut`, `nightingale-rose`, `treemap`, `funnel` | `name`, `value`, `share?` |
| `sankey` | `source`, `target`, `value` |
| `scatter` | `xAxis`, `yAxis`, `name?`, `size?` |
| `radar` | `name`, `value` (one non-negative axis per row) |
| `sunburst` | `id`, `parent`, `name`, `value`, `share?` (`parent` null on roots) |
| `boxplot` | `category`, `min`, `q1`, `median`, `q3`, `max` |
| `gauge`, `liquid-fill` | `value` (one row, and an explicit format for that column) |
| `timeline` | `date`, `name`, `description` |
| `graph` | with `graphInput: "object"`: `nodes`, `links` (one row holding two JSON arrays); with `graphInput: "edges"`: `source`, `target`, `value?`, `relation?`, `sourceName?`, `targetName?`, `sourceCategory?`, `targetCategory?` |

## Display

`display` accepts `sort`, `displayLimit` and `formats`. Sorting is stable with nulls last; the values themselves never change.

```json
{
  "sort": [{ "field": "amount", "order": "desc" }],
  "displayLimit": 10,
  "formats": {
    "amount": { "kind": "number", "decimals": 0 },
    "rate": { "kind": "percent", "scale": 100 }
  }
}
```

A percent format needs a scale: `100` maps `0.25` to `25%`, `1` maps `25` to `25%`.

## Source reference

Write the one source the rows came from; never invent an id or path.

- A MetricView: `{ "metric": { "metricId": "...", "parameters": { ... } } }`, copied from the accepted dataset's metric recipe or from `ontomato-analyst` `metrics` / `execute-metric`.
- A temporary retrieval: `{ "dataset": { "path": "outputs/result.dataset.json" } }`, the file the chart read.
- Neither: omit `source`. The chart can then be viewed in this conversation but cannot be added to a dashboard or imported elsewhere.

## Revising

Run the command again with the same `name` after changing `chartType`, `fields`, `display` or the source data. The file is the chart's definition; do not edit it by hand. If the command reports `MISSING_FIELDS`, an invalid mapping or an invalid file, fix the named role or column and rerun.
