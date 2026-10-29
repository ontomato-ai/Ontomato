---
name: network-graph
description: Render general-purpose entity relationship networks from supplied nodes and links, supporting directed or undirected edges, grouping, status highlighting, anchor nodes, multiple layouts, filtering, and interactive exploration.
metadata:
  ontomato.type: executable
  ontomato.category: visualization
  ontomato.title: Network Relationship Graph
  ontomato.tags: '["visualization","relationship graph","network graph","entities","dependencies","ECharts"]'
  ontomato.version: 1.0.0
  ontomato.outputType: html
  ontomato.defaultEnabled: "false"
---

## Standard CLI

Write the documented input to a JSON file and run:

`node skills/network-graph/scripts/index.mjs work/input.json`

The command writes its result under `outputs/` and prints the file path.
Reference that path in Markdown. The command runs unchanged in an external harness;
use the package's local path when it is installed somewhere other than `skills/`.


## Network Relationship Graph

Render a general-purpose relationship network from supplied entity nodes and relationship links. The graph emphasizes entity connectivity and exploration; it does not infer or create relationships that are absent from the input.

Use this skill for customer-product associations, supplier networks, organization relationships, knowledge graphs, dependency networks, and general entity relationship exploration.

Use `quality-trace-graph` instead when the task specifically concerns quality traceability, batch lineage, recall impact, evidence paths, or traceability data gaps. Use the `echarts` skill for numeric charts and weighted flow charts such as Sankey.

## Input Parameters

Recommended input:

```json
{
  "chartType": "network-graph",
  "title": "Supplier Relationship Network",
  "data": {
    "nodes": [
      {"id": "S-01", "name": "Supplier A", "type": "supplier", "status": "normal"},
      {"id": "P-01", "name": "Product X", "type": "product", "isAnchor": true}
    ],
    "links": [
      {"source": "S-01", "target": "P-01", "relation": "supplies"}
    ]
  },
  "layout": "force",
  "directed": true,
  "showRelationLabels": true,
  "anchorIds": ["P-01"],
  "maxNodes": 150
}
```

| Parameter | Required | Description |
|---|---|---|
| `data` | Yes | `{nodes, links}`, `{nodes, edges}`, or an array of relationship rows with source and target fields. |
| `title` | No | Display title. |
| `chartType` | No | Must be `network-graph`; defaults to this value. |
| `layout` | No | `force` (default), `circular`, or `none` when node coordinates are supplied. |
| `directed` | No | Whether links show arrowheads. Defaults to `true`. |
| `showRelationLabels` | No | Show relation names on edges. Defaults to `false` to reduce clutter. |
| `anchorId` / `anchorIds` | No | IDs to emphasize; these must come from the current question or input data. |
| `maxNodes` | No | Maximum rendered nodes, 10–300; defaults to 150. Nodes near anchors and high-degree nodes are prioritized. |
| `idField` / `nameField` / `typeField` / `statusField` | No | Optional node field mappings. Defaults to common names such as `id`, `name`, `type`, and `status`. |
| `sourceField` / `targetField` / `relationField` | No | Optional link field mappings. |
| `width` / `height` | No | Optional minimum canvas dimensions in pixels. |

## Data Rules

- Node IDs must be unique and stable. Links must refer to existing node IDs.
- Accepted node ID fields include `id`, `object_id`, and `code`; labels include `name`, `label`, and `title`.
- Accepted link collections include `links`, `edges`, or `relations`; endpoints include `source/from/src` and `target/to/dst`; relation labels include `relation`, `relationName`, `edge_name`, or `type`.
- Array-of-links input is accepted. Nodes are then derived only from endpoint identifiers and supplied endpoint labels, if present; no additional business relationships are inferred.
- Duplicate nodes and duplicate links are de-duplicated. Links with missing endpoints are skipped and reported in `meta.warnings`.
- When the graph exceeds `maxNodes`, nodes near the specified anchors are preferred, then nodes with higher degree. The output metadata reports truncation.
- `layout: "none"` uses numeric `x` and `y` values from the input nodes. If coordinates are missing, the skill falls back to `force` layout.
- Edge weights may influence visual width only when a valid numeric weight field is supplied. They do not imply that the graph is a flow chart.
- Statuses and types affect visual emphasis only; they do not establish facts about risk or causality.

## Output Format

```json
{
  "html": "Fully rendered HTML page",
  "meta": {
    "skillId": "network-graph",
    "chartType": "network-graph",
    "title": "Supplier Relationship Network",
    "dataRows": 2,
    "nodeCount": 2,
    "linkCount": 1,
    "warnings": []
  }
}
```
