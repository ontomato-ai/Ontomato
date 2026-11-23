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

The host attaches the admitted `queryIntent` and a `queryCoverage` report when an intent was
supplied. These are host-owned, not metadata you submit. Predicate presence is structural only;
an `unverified` report does not establish semantic correctness, distinct counting, or collective
coverage of all requested tables. Keep the report with the immutable file and explain unresolved
scope. Structural coverage is diagnostic only; it does not block an otherwise valid query.

For a condition whose admitted mapping is null, include `conditionBindings` in delivery metadata,
keyed by the admitted condition id, with `{className,field,operator,value}` from verified schema.
Unknown condition ids and replacements of existing mappings are rejected. These bindings are
model proposals checked against the actual DSL; they do not replace the original intent.
