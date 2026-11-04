# Parameterized dashboard query

Create a reusable query logic package for the supplied query. Read the
ontology-generation skill and query-package reference. Preserve all original
output keys and business behavior, including filters, grain, denominator,
null handling and partial results. The supplied program may render a complete
package; inspect its DSL files and Python calculation, not just its launcher.

Dataset: {{DATASET_DESC}}

Classes:
{{CLASS_DEF}}

DSL rules:
{{DSL_RULE}}

Original query:
```python
{{PYTHON_CODE}}
```

Keep DSL in JSON files. A pure DSL needs no Python. Additional Python calls
execute_dsl_file for declared queries; it may change only declared parameter
values. Java derives DSL sources and executes the whole package under user
permissions. Declare only the added Python computation paths. No static lineage
analysis, local execution, identity parameters or hand-written permission graph.

Extract appropriate changing values into manifest parameterDefs using Function
name/type/value conventions. Keep original values as defaults and bind DSL values
by parameterBindings JSON Pointers. Do not bind structure, identifiers, operators
or expression source. Existing output keys must remain stable.

Write every source file under outputs/, supply readable columnLabels and test
with `generation.mjs test-package outputs/package.json labels.json`. Deliver
outputs/result.json with packagePath, columnLabels and title. Parameter definitions
are owned by the package, not duplicated in the result. Use {{LANG}} for descriptions.
