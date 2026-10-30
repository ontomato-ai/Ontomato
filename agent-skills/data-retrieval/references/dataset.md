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
