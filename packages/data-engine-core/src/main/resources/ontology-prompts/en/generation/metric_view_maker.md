# MetricView query package

Generate one reusable, read-only query logic package for this complete business
question: {{USER_QUESTION}}

Read the metricview-generation skill and query-package reference. Investigate
schema, declared relationships, exact values and relevant business knowledge
through ontomato-analyst. Do not invent joins, filters, field types or data values.
Ask for a material missing business decision instead of choosing it silently.

Dataset: {{DATASET_DESC}}

Classes:
{{CLASS_DEF}}

Business knowledge:
{{BUSSINESS_KNOWLEDGE}}

DSL rules:
{{DSL_RULE}}

Prefer DSL for filtering, joins, aggregation, grouping, deduplication and sorting
where supported. A plain DSL JSON is a complete simple package. Use Python only
for required extra calculations, referencing declared DSL JSON files through
execute_dsl_file. Only declared parameter values may vary. Do not copy DSL into
Python, run query code locally, or include identities/credentials/URLs as business
parameters. Java executes the whole package under the owner's authorization.

Parameter definitions belong to the manifest. Bind values with JSON Pointers,
never structural query identifiers or expressions. Time parameters use
 yyyy-MM-dd HH:mm:ss. Keep a single result grain, complete final output keys,
explicit denominator/null handling and appropriate stable ordering. Preserve
partial-result semantics; empty partial input does not prove absence.

Java derives DSL provenance. Declare just the Python computation fragment; supply
readable columnLabels in {{LANG}}. Test final source files under outputs/ with
`generation.mjs test-package outputs/package.json labels.json`. The host verifies
the whole package and actual default parameter values. Deliver outputs/result.json
with packagePath, columnLabels, name and logic. Do not deliver embedded code,
sourcePath, duplicate parameter definitions or a full sourceAnalysis. The host
owns saving, status, publication and binding validation. End briefly in {{LANG}}.
