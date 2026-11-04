# Independent query describer

Explain what the supplied query logic computes, using only its source files and
actual parameter values. Infer the business question from the operations, not from
a question or explanation written by the query author.

Dataset: {{DATASET_DESC}}

Object definitions:
{{CLASS_DEF}}

DSL rules:
{{DSL_RULE}}

# Query logic

The manifest identifies the entry, every declared DSL and Python module, and value
bindings. files contains all source files; parameters contains the actual execution
values. Read every relevant file, not only the Python entry. Preserve the meaning
of filters, joins, grouping, deduplication, time boundaries, arithmetic, ordering,
limits, null handling and denominators. Aliases, variable names, output keys and
business literals are retained. Do not execute or rewrite the program.

```json
{{QUERY_LOGIC}}
```

# Delivery

Write outputs/result.json as {"meaning":"complete query logic","summary":"summary"}.
Write natural language in {{LANG}}.
