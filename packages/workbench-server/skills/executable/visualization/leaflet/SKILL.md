---
name: leaflet
description: Build and revise reusable .chart.json point maps from WGS-84 longitude and latitude rows, drawn over the platform's bundled China province basemap.
---

## When to use

Use this skill when the conversation needs a reusable point map of business locations, such as stores, sites, devices or projects. It writes a `.chart.json` file that the platform draws and can add to a dashboard, an object view or a metric widget. Use admin-choropleth-map for province-level values without coordinates, and echarts for non-map charts.

## Command

Write the input to a JSON file and run:

`node skills/leaflet/scripts/index.mjs work/input.json`

The command writes `outputs/<name>.chart.json` and prints the path; reference that path in Markdown. It runs unchanged in an external harness; use the package's local path when installed elsewhere.

## Input

```json
{
  "chartType": "leaflet-map",
  "name": "store-sales",
  "dataset": "outputs/stores.dataset.json",
  "fields": { "lng": "longitude", "lat": "latitude", "name": "store", "value": "sales" }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `chartType` | yes | Always `leaflet-map`. |
| `name` | yes | Output file name without a directory or extension. |
| `title` | no | Text displayed on the map. |
| `data` | one of | Row objects already in the input file. |
| `dataset` | one of | Data file to read: an accepted `.dataset.json` or a JSON array/`{ "rows": [...] }`. |
| `fields` | yes | `lng`, `lat`, `name`, and optional `value` mapped to real column names. |
| `display` | no | `sort`, `displayLimit` and `formats`, as for other chart files. |
| `source` | no | MetricView reference; only `metric` or `dataset`, and other keys are rejected. |

`dataset` is a path in the workspace directory the command runs in. Reading it records the file as the chart's source automatically.

## Map rules

- `lng` and `lat` are WGS-84 decimal degrees; convert any other coordinate system before charting.
- The only basemap is the platform's bundled `china-provinces` resource. Street-level tiles are not available.
- `name` is the readable place label; `value` scales marker size from 6 to 40px and appears in the tooltip.
- Rows without valid coordinates cannot be placed; fix the data instead of dropping them silently here.

## Source reference

Reading a `dataset` file records that file as the chart's source automatically. When the rows come from one MetricView, also write:

`"source": { "metric": { "metricId": "...", "parameters": { ... } } }`

Copy the id and parameters from the accepted dataset's metric recipe or from `ontomato-analyst` `metrics` / `execute-metric`; never invent them. The MetricView reference wins over the recorded file. Without either a MetricView or a recorded dataset file (for example with inline `data`), the chart can be viewed in this conversation but cannot be added to a dashboard or imported elsewhere. `source` may name only `metric` or `dataset`; other keys are rejected.

## Revising

Run the command again with the same `name` after changing the input, including `title` for a new map title. The file is the map's definition. Do not edit it by hand. Reference the generated file as written. If the command reports a missing role or an invalid file, fix the named column and rerun.
