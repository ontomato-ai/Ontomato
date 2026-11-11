---
name: metricview-generation
description: Generate one reusable MetricView query logic package from a natural-language requirement, using ontology-owned validation and business tests.
---

# MetricView generation

Read the task's business rules and [query packages](references/query-package.md).
Use ordinary read/write/edit/bash tools and ontomato-analyst for permitted schema,
relationships, values and DSL exploration. The data-retrieval skill must also be
installed; the host provides it and this script reuses its package collector.

Write the DSL and any necessary Python calculation under outputs/. Prefer DSL
where it supports the calculation. Python uses `execute_dsl_file`, parameters
from query_runtime, and the existing answer array protocol. It can execute only
DSL files declared in the package; only parameter values may vary. Never run
query code in local Python or put identity, credentials, URLs or host paths in
business parameters. Java injects the helper and internal execution authority.

```sh
node <this-skill>/scripts/generation.mjs test-package outputs/package.json labels.json
```

A plain DSL entry is accepted instead of a manifest. labels.json maps each final
output key to a readable label in the user's language. This command tests the
whole package with manifest parameter values. Read operations cannot obtain
write authority. Java derives DSL provenance; declare only additional Python
computation paths, never another full sourceAnalysis. Reusable parameter bindings
must not freeze test values in the saved filter description.

Write outputs/result.json as one JSON object:
`{packagePath:"outputs/package.json",columnLabels:{...},name:"...",logic:"..."}`.
Parameter definitions live in the manifest; do not copy them into this result.
Preserve output keys and test the final package after execution changes. The host
collects all files from this run and checks the exact package test; a model claim,
bash success or inherited artifact is not a receipt. Java owns saving, publication,
binding consistency and permissions. End with a brief description.

## Dataset settlement

Only when the host explicitly identifies a dataset-settlement task, first search
published metrics with ontomato-analyst. Compare the complete requested logic,
including grain, scope, filters, time semantics, denominators and null handling.
Matching preview numbers do not establish equivalence. Read a matching metric's
current revision and parameter definitions. If equivalent, write
`{kind:"reuse",metricId:"...",revision:"...",parameters:{...}}` to outputs/result.json.
Do not create a package for this outcome. Preserve declared subject references.

Otherwise generate and business-test the final package as above, and write
`{kind:"create",packagePath:"outputs/package.json",columnLabels:{...},name:"...",logic:"..."}`.
Include the requested grouping, aggregation, pivot and chart statistics in this
package; a card only selects output fields and renders them. Its display sorting,
row count, formatting and style do not belong in the calculation unless they
change the requested business value. Do not call another metric from a Function,
and do not substitute row counts for zero, missing or nonnumeric results.
Ordinary natural-language creation still uses the original tested-package result,
without a reuse outcome. Java alone saves, adopts, publishes and adds bindings.

Hosted runs supply ONTOMATO_ONTOLOGY_URL, ONTOMATO_GENERATION_ID,
ONTOMATO_GENERATION_KIND and scoped ONTOMATO_TK. External agents run `begin` with
an authorized user credential (or API key) before testing, then `close`. Ordinary
external credentials do not become internal computation credentials.
