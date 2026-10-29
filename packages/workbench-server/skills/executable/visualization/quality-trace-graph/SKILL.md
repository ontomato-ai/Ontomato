---
name: quality-trace-graph
description: Render batches, process executions, assembly events, recall decisions, and products as an interactive directed evidence graph highlighting risk anchors, recall status, and data gaps.
metadata:
  ontomato.type: executable
  ontomato.category: visualization
  ontomato.title: Quality Traceability Graph
  ontomato.tags: '["quality traceability","relationship graph","directed graph","derived paths","batch impact","ECharts"]'
  ontomato.version: 1.0.0
  ontomato.outputType: html
  ontomato.defaultEnabled: "false"
---

## Standard CLI

Write the documented input to a JSON file and run:

`node skills/quality-trace-graph/scripts/index.mjs work/input.json`

The command writes its result under `outputs/` and prints the file path.
Reference that path in Markdown. The command runs unchanged in an external harness;
use the package's local path when it is installed somewhere other than `skills/`.


## Quality Traceability Graph

Render objects and relationships returned by quality traceability queries as a directed evidence graph. Use it to explain how a batch leads to final products, which products received recalled batches, or where a traceability chain has missing records.

This skill renders only the supplied data. It does not access M3, query platforms, or other APIs, and does not invent business relationships.

## When to Use

- Query results contain source and target objects and relation names spanning multiple hops.
- A graph needs to show batches, process executions, assembly events, inspections, recall decisions, and products together.
- Risk anchors, defective or recalled objects, affected products, or branches without subsequent records need emphasis.
- Relation direction and meaning matter more than numeric weights.

Use the general `echarts` skill for numeric charts such as bar, line, pie, scatter, heatmap, funnel, map, tree, sunburst, and gauge charts. Use Sankey for weighted source-target-value flows; do not substitute Sankey for quality evidence paths.

## Input Parameters

Recommended input:

```json
{
  "data": {
    "nodes": [
      {
        "id": "BAT-0014",
        "name": "BAT-0014",
        "type": "batch",
        "status": "risk",
        "isAnchor": true
      },
      { "id": "PE-00116", "name": "PE-00116", "type": "process-execution" },
      {
        "id": "BAT-0092",
        "name": "BAT-0092",
        "type": "batch",
        "status": "recalled"
      }
    ],
    "links": [
      {
        "source": "BAT-0014",
        "target": "PE-00116",
        "relation": "consumed_by",
        "pathType": "derived"
      }
    ]
  },
  "title": "Downstream Product Lineage of BAT-0014",
  "layout": "layered",
  "direction": "LR",
  "maxNodes": 120
}
```

| Parameter   | Required | Description                                                                                               |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `data`      | Yes      | `{nodes, links}`, `{nodes, edges}`, or an array of links containing at least `source` and `target`.       |
| `title`     | No       | Chart title. Defaults to "Quality Traceability Graph".                                                    |
| `layout`    | No       | Uses the deterministic `layered` layout.                                                                  |
| `direction` | No       | `LR` for left to right or `TB` for top to bottom. Defaults to `LR`.                                       |
| `maxNodes`  | No       | Maximum rendered nodes. Defaults to 120; accepts 10–200. When exceeded, nodes near anchors take priority. |
| `anchorId`  | No       | A single anchor ID. Equivalent in priority to a node with `isAnchor: true`.                               |
| `anchorIds` | No       | Multiple anchor IDs, such as a product investigation anchor and a defective batch risk anchor.            |

Accepted link fields include `links/edges/relations`, `source/from/src`, `target/to/dst`, and `relation/relationName/edge_name/type`. Accepted node fields include `id/object_id/code`, `name/label`, `type/object_type`, and `status/state`.

Namespaced IDs retain their original values for linking. Display labels default to the business key after the final colon. For example, `quality_traceability_demo_batch:BAT-0014` displays as `BAT-0014`.

## Object Types and Statuses

Recommended object types:

- `batch`: raw material, intermediate, or finished batches
- `process-execution`: process or production executions
- `assembly-event`: assembly events
- `inspection-event`: inspection events
- `recall-decision`, `quality-decision`: recall or quality disposition decisions
- `product`: product instances or serial numbers
- `material`, `part`, `component`: materials, parts, and components
- `supplier`, `customer`: suppliers and customers
- `shipment`, `order`, `work-order`: logistics and business documents

Recommended statuses:

- `normal`: ordinary object
- `risk`: risk anchor
- `recalled`: recalled object
- `defective`: defective object
- `affected`: affected object
- `missing`: data gap or no subsequent records
- `isolated`: isolated object

When a real object exists but subsequent records are missing, retain the object and set `broken: true` or `status: "missing"`. Do not fabricate a business event.

## Relationship and Evidence Rules

1. Links must come from query results or explicit business foreign keys. Do not expand impact based on weak associations such as shared equipment, personnel, or suppliers.
2. Relation names must match arrow direction. Use actual ontology relations such as `consumes`, `produces`, `uses_batch`, `creates`, and `recalls_batch`. If reversing a process-to-batch `consumes` edge for downstream reading, use an explicit inverse display name such as `consumed_by`.
3. `pathType: "direct"` denotes a direct relationship; `pathType: "derived"` denotes one derived through intermediate batches or events. Line styles and tooltips distinguish them.
4. Anchors must come from the current question or query results. The example ID `BAT-0014` is for testing only and must never become a fixed default.
5. Cycles, duplicate nodes or links, missing endpoints, missing anchors, and truncation are reported in `meta.warnings`. Cycles are preserved and rendered; callers should verify relation directions.

## Suggested Test Prompt

Visualize the downstream lineage of BAT-0014. Highlight recalled batch BAT-0092, final product SN-2025-0001, and the BAT-0052 branch with no subsequent records. Show every relation name.

Repeat with different batch IDs and product serial numbers to confirm that anchors, titles, nodes, and paths come from the current input rather than example constants.
