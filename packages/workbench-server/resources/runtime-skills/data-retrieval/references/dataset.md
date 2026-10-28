# Dataset preparation

The recipe request contains title, question, recipe, outKeyRefs, assumptions,
decisionIds, metricUses and selfCheck. It does not contain result rows.

recipe is one of:
- {kind:"dsl",dsl:<one DSL object>}
- {kind:"python",code:<exact Python source>,sha256:<SHA-256 of source bytes>}
- {kind:"metric",metricId,revision,parameters:<object>}

Use the ontology skill's Python helper and protocol-2 code for Python. Declare
outKeyRefs as {key,className,attrName,asGroupBy,statCal} for every result column.
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
