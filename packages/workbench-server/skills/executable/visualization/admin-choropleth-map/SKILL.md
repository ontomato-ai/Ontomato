---
name: admin-choropleth-map
description: Build and revise reusable .chart.json province-level choropleth maps from region name or code rows, using the platform's bundled China province boundaries.
---

## When to use

Use this skill when the conversation needs a reusable map that fills Chinese province-level regions with a numeric measure. It writes a `.chart.json` file that the platform draws and can add to a dashboard, an object view or a metric widget. Use leaflet when each row has coordinates, and echarts for non-map charts.

## Command

Write the input to a JSON file and run:

`node skills/admin-choropleth-map/scripts/index.mjs work/input.json`

The command writes `outputs/<name>.chart.json` and prints the path; reference that path in Markdown. It runs unchanged in an external harness; use the package's local path when installed elsewhere.

## Input

```json
{
  "chartType": "admin-choropleth-map",
  "name": "sales-by-province",
  "dataset": "outputs/province-sales.dataset.json",
  "fields": { "name": "province", "value": "sales" },
  "display": { "formats": { "sales": { "kind": "number", "decimals": 0 } } },
  "source": { "metric": { "metricId": "metric-id", "parameters": {} } }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `chartType` | yes | Always `admin-choropleth-map`. |
| `name` | yes | Output file name without a directory or extension. |
| `data` | one of | Row objects already in the input file. |
| `dataset` | one of | Data file to read: an accepted `.dataset.json` or a JSON array/`{ "rows": [...] }`. |
| `fields` | yes | `name` and `value` mapped to real column names. |
| `featureNameProperty` | no | Boundary property the `name` column matches: omit for short names, `fullname` for full names, `code` for administrative codes. |
| `display` | no | `sort`, `displayLimit` and `formats`, as for other chart files. |
| `source` | no | Data source reference below. |

`dataset` and a `source.dataset.path` are paths in the workspace directory the command runs in.

## Region matching

Boundaries are the platform's bundled `china-provinces` resource; the skill neither downloads nor caches them. The `name` column must match the chosen boundary property exactly:

- default (`name`): short province names, such as `北京`, `广东`, `内蒙古`;
- `fullname`: official full names, such as `北京市`, `广东省`;
- `code`: administrative codes as text, such as `110000`.

A value that does not match a bundled region is not drawn. Fix the region column or pass the property it uses rather than introducing another boundary source.

## Source reference

Write the one source the rows came from; never invent an id or path.

- A MetricView: `{ "metric": { "metricId": "...", "parameters": { ... } } }`, copied from the accepted dataset's metric recipe or from `ontomato-analyst` `metrics` / `execute-metric`.
- A temporary retrieval: `{ "dataset": { "path": "outputs/result.dataset.json" } }`, the file the chart read.
- Neither: omit `source`. The chart can then be viewed in this conversation but cannot be added to a dashboard or imported elsewhere.

## Revising

Run the command again with the same `name` after changing `fields`, `featureNameProperty`, `display` or the source data. The file is the map's definition; do not edit it by hand. If the command reports a missing role or an invalid file, fix the named column and rerun.
