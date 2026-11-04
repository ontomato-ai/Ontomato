# Reusable read Function

Turn the supplied final query into one reusable query logic package. Read the
ontology-generation skill and query-package reference. Preserve its behavior and
all final output keys. The input may be a complete package rendered as Python
transport text; inspect every declared DSL and calculation file, not just the launcher.

Business question: {{USER_QUESTION}}

Dataset: {{DATASET_DESC}}

Classes:
{{CLASS_DEF}}

DSL rules:
{{DSL_RULE}}

Original logic:
```python
{{PYTHON_CODE}}
```

Keep DSL in JSON files. If it can do the entire calculation, use a DSL entry and
no Python. Otherwise retain only the necessary Python calculation and use
`from query_runtime import execute_dsl_file, parameters`. Java executes the whole
package with the owner's permissions; do not execute query Python locally.

Extract only values that should vary into manifest parameterDefs (name, type,
value, description, optional sample/classNames). Use standard Function types;
time strings use yyyy-MM-dd HH:mm:ss. Bind DSL values by parameterBindings JSON
Pointers; never parameterize class/field/relationship/operator/source structure.
Python may read calculation parameters. Use the original values as defaults.
With these values the result must preserve the original filters, grain, time,
null handling, denominator and output keys, even when a key contains a year.
Do not introduce identities, transport settings or credentials as parameters.

Java derives DSL sources. Declare only additional Python operations in computation;
all inputs reference query output keys or other declared operations. This is a
source declaration, not static analysis. Column labels must be readable in {{LANG}}.
Do not submit a second full source graph.

Write all source files under outputs/, test the final package once with
`generation.mjs test-package outputs/package.json labels.json`, and correct actual
failures without repeating identical calls. Deliver outputs/result.json with
packagePath, columnLabels, name and logic. Parameter definitions are in the manifest
only. Do not rewrite the whole package as a single Python source. End briefly in {{LANG}}.
