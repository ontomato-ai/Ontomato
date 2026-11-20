# Dataset delivery

1. Put the final DSL in its own file, for example work/q.json. A plain DSL file is a complete package. Use a Python package ([query packages](query-package.md)) only for calculations the DSL cannot do.
2. Write work/delivery.json:

```json
{
  "title": "Active employees",
  "columnLabels": {"headcount": "Active employees"},
  "assumptions": [],
  "selfCheck": {"scope": "", "filters": "", "grain": "", "denominator": "", "nullGroups": ""}
}
```

   Every selfCheck value is text. columnLabels gives every output key a label in the user's language.
3. Run `deliver`. The host fills in the question, decisions, source graph, hashes and receipt.

Several tables: one input file and one delivery per table, each with its own `--out`. A delivery is your own query logic; do not look for a metric to reuse or compare against.
