---
name: admin-choropleth-map
description: Build and revise reusable .chart.json province-level choropleth maps from region name or code rows, using the platform's bundled China province boundaries.
---

## When to use

Use this skill when the conversation needs a reusable map that fills Chinese province-level regions with a numeric measure. It writes a `.chart.json` file that the platform draws and can add to a dashboard, an object view or a metric widget. Use leaflet when each row has coordinates, and echarts for non-map charts.

## Command

Write the input to a JSON file and run:

`node skills/admin-choropleth-map/scripts/index.mjs work/input.json`

Reference the printed `outputs/<name>.chart.json` path as a Markdown image. The image description is the title shown in the conversation and becomes the card name when added to a dashboard. Keep the title out of the chart file. Use the package's local path in an external harness.

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
| `source` | no | MetricView reference; only `metric` or `dataset`, and other keys are rejected. |

`dataset` is a path in the workspace directory the command runs in. Reading it records the file as the chart's source automatically.

## Region matching

Boundaries are the platform's bundled `china-provinces` resource; the skill neither downloads nor caches them. It checks every `name` value against the chosen boundary property before writing, and reports all values the resource lacks. The values must match that property exactly:

- default (`name`): short province names, such as `北京`, `广东`, `内蒙古`;
- `fullname`: official full names, such as `北京市`, `广东省`;
- `code`: administrative codes as text, such as `110000`.

A value that does not match a bundled region is reported and no file is written. Fix the region column or pass the property it uses rather than introducing another boundary source.

## Source reference

Reading a `dataset` file records that file as the chart's source automatically. When the rows come from one MetricView, also write:

`"source": { "metric": { "metricId": "...", "parameters": { ... } } }`

Copy the id and parameters from the accepted dataset's metric recipe or from `ontomato-analyst` `metrics` / `execute-metric`; never invent them. The MetricView reference wins over the recorded file. Without either a MetricView or a recorded dataset file (for example with inline `data`), the chart can be viewed in this conversation but cannot be added to a dashboard or imported elsewhere. `source` may name only `metric` or `dataset`; other keys are rejected.

## Revising

Change the input and run the command again with the same `name`. The file is the map's definition. Reference it as generated and do not edit it by hand. If the command reports a missing role or an invalid file, fix the named column and rerun.
