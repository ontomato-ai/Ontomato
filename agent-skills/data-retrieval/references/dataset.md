# Dataset delivery

Write a plain ontology DSL object to work/q.json, or write an explicit package
manifest and its source files as specified in [query packages](query-package.md).
Do not copy DSL into Python. Python uses `execute_dsl_file("queries/q.json")`;
Java resolves the frozen package file and only declared parameter values may vary.

Write work/delivery.json:

```json
{
  "title": "Employee count",
  "columnLabels": {"headcount": "Employee count"},
  "assumptions": [],
  "metricUses": [],
  "selfCheck": {
    "scope": "Employees visible to the current user",
    "filters": "No additional business filter",
    "grain": "One total",
    "denominator": "Not a ratio",
    "nullGroups": "No grouping",
    "comparisons": []
  }
}
```

These are example explanations, not default assertions. Each selfCheck value is
text; comparisons is an array of {metricId,comparable,explanation,executionRef}.
Record every relevant metric use as {id,revision,use:"direct"|"derived"|"not_used",reason}.
Comparisons need comparable filters, grain and time plus an actual execution
reference, or an explanation that comparison is not valid. Keep assumptions
explicit. The question and confirmed decision identities are filled by the host.

```sh
node scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json --out outputs/count.dataset.json
```

The tool returns the path, row count, columns, truncation, receipt and package hash.
It writes the exact host bytes, with schema workbench.dataset.v2. The dataset
freezes the whole package, actual parameters, source graph, business explanations
and execution receipt. Labels must match every final output key and be readable
in the user's language. Do not declare a second sourceAnalysis: Java derives DSL
sources and combines only the Python computation fragment from the manifest.
Do not calculate hashes or create receipts yourself.

For direct metric use, the input file is:

```json
{"kind":"metric","metricId":"published-id","revision":"current-revision","parameters":{}}
```

An optional bindingId selects owned stored values and rejects overrides. A metric
execution freezes the actual Function package and keeps its metric identity.
Change of logic is derived use, never direct use. A legacy metric can still run
through the stored-data read boundary; it does not acquire invented provenance.

Use preview only to resolve an actual uncertainty. It performs an authorized
execution, not just JSON validation. Delivering identical input then reuses the
same task. Fix syntax from field-specific errors instead of reading script source.
