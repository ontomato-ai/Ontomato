# Dataset preparation

The recipe request contains title, question, recipe, sourceAnalysis, assumptions,
decisionIds, metricUses and selfCheck. It does not contain result rows.

recipe is one of:
- {kind:"dsl",dsl:<one DSL object>}
- {kind:"python",code:<exact Python source>,sha256:<SHA-256 of source bytes>}
- {kind:"metric",metricId,revision,parameters:<object>,bindingId?:<owned binding ID>}
  metricId always identifies the dynamic metric. A binding uses its saved values;
  pass {} or exactly those values, never overrides.

Use the ontology skill's Python helper and protocol-2 code for Python. Declare sourceAnalysis using the shared query-subgraph contract:
read references/query-subgraph.md and references/query-subgraphs.json in this skill.
Every output node key matches one result column; label is a ready-to-display name
in the user's language, never a technical key when a human-readable name is available.
Include all source fields and calculation paths, not only one convenient source.
For DSL, reuse sourceAnalysis returned by execute-dsl and set its output labels in
the user's language. Java reconstructs the actual DSL dependencies and uses only
the declared output labels by key. Python requires the full
analysis. Published metrics use their saved analysis. Legacy stored metrics without one retain key labels and do not publish a fabricated graph; their stored outKeyRefs are converted only for permission evaluation. No new outKeyRefs declaration is accepted.
Each metric use is {id,revision,use:"direct"|"derived"|"not_used",reason}.
selfCheck contains scope, filters, grain, denominator, nullGroups (all strings),
and comparisons: [{metricId,comparable,explanation,executionRef:null|string}].
assumptions is a string array. decisionIds contains only confirmed decisions
supplied by the host; use [] if none. Empty arrays are valid, invented identities
are not.

The returned file has schema workbench.dataset.v1, columns/rows, final recipe,
field sources, assumptions/decisions/metric uses/selfCheck, a formal execution
receipt and truncation (null or {truncated:true,rowLimit,truncationHint}). Preserve
null, false, zero and empty strings. The runtime assigns artifact identity after
the file is written; do not insert an artifact ID into the JSON.

## Minimal complete DSL preparation

Save this object as `work/count.json`, replace `/Employee` with a class from
`schema`, then run `node scripts/dataset.mjs preview @work/count.json`.
Use the same object for delivery. Keep every selfCheck value as text, including
`filters` and `nullGroups`; use `""` when there is nothing to add, never `[]`, `{}`
or `null`. This example counts authorized rows and needs no attribute source.

```json
{
  "title": "Employee count",
  "question": "How many employees can I access?",
  "recipe": {
    "kind": "dsl",
    "dsl": {
      "problem": "Employee count",
      "answer": {
        "steps": [{
          "graph": {"patterns": [{"objects": [{"idx": 0, "variable": "e", "class": "/Employee"}]}]},
          "output": {"to_user": true, "fields": [{"variable": "e", "field": "*", "function": "COUNT", "as": "headcount"}]}
        }]
      }
    }
  },
  "sourceAnalysis": {
    "schema": "ontomato.query-subgraph.v1",
    "queries": [{"id": "q", "label": "Employee count"}],
    "nodes": [
      {"id": "employees", "kind": "class", "label": "Employees", "queryId": "q", "className": "/Employee", "variable": "e"},
      {"id": "one", "kind": "operation", "label": "1", "queryId": "q", "operation": "constant", "expression": "1"},
      {"id": "count", "kind": "operation", "label": "COUNT(*)", "queryId": "q", "operation": "aggregate", "expression": "COUNT(*)"},
      {"id": "result", "kind": "output", "label": "Employee count", "key": "headcount"}
    ],
    "edges": [
      {"id": "count-input", "kind": "dependency", "source": "one", "target": "count", "role": "value", "label": ""},
      {"id": "count-output", "kind": "dependency", "source": "count", "target": "result", "role": "value", "label": ""}
    ],
    "filters": []
  },
  "assumptions": [],
  "decisionIds": [],
  "metricUses": [],
  "selfCheck": {
    "scope": "Employees visible to the current user",
    "filters": "No additional filter",
    "grain": "One total",
    "denominator": "",
    "nullGroups": "No grouping",
    "comparisons": []
  }
}
```
