# Dataset delivery

1. Put the final query logic in its own file, for example `work/q.json`: one DSL object, or a Python
   package ([query packages](query-package.md)) when a step cannot be done in the DSL. A DSL file is
   exactly the object ontology-query's `execute-dsl` accepts: the question and the steps written as `dsl-reference`
   shows, `{"problem": "How many active employees are there?", "answer": {"steps": [...]}}`.
2. Write `work/delivery.json` with exactly these top-level fields:

```json
{
  "title": "Active employees",
  "columnLabels": {"headcount": "Active employees"},
  "assumptions": ["Employees count only status = active, the business knowledge's default."],
  "selfCheck": {"scope": "", "filters": "", "grain": "", "denominator": "", "nullGroups": ""}
}
```

   `columnLabels` gives every output key a label in the user's language. `assumptions` lists the scope
   choices you made (filters, deduplication, grouping) and why. Every `selfCheck` value is a short text:
   what population the table covers, which filters apply, what one row is, the denominator if there is
   a share, and how empty groups are treated; write "not applicable" where one does not apply.
3. Run `deliver`. The host fills in the question, decisions, source graph, hashes and receipt.

A delivery is your own query logic; do not look for a metric to reuse or compare against.
