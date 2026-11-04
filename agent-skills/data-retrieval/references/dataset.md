# Dataset delivery

1. Put the final DSL in its own file, for example work/q.json. A plain DSL file is a complete package. Use a Python package ([query packages](query-package.md)) only for calculations the DSL cannot do.
2. Write work/delivery.json:

```json
{
  "title": "Active employees",
  "columnLabels": {"headcount": "Active employees"},
  "assumptions": [],
  "metricUses": [],
  "selfCheck": {"scope": "", "filters": "", "grain": "", "denominator": "", "nullGroups": "", "comparisons": []}
}
```

   Every selfCheck value is text. columnLabels gives every output key a label in the user's language. Each metricUses item is `{id, revision, use: "direct"|"derived"|"not_used", reason}`. A comparison is `{metricId, comparable, explanation, executionRef}`, where executionRef is a real execution reference or null.
3. Run `deliver`. The host fills in the question, decisions, source graph, hashes and receipt.

Several tables: one input file and one delivery per table, each with its own `--out`.

To use a published metric directly, the input file is `{"kind":"metric","metricId":"...","revision":"...","parameters":{}}`; add `bindingId` to reuse a binding's saved values unchanged.
