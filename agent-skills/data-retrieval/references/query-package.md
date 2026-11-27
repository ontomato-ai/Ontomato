# Python packages

Use a Python package only for the step the DSL cannot do, such as averaging an age stored as text or
combining the results of separate queries. The data still comes from DSL files; the Python only
computes on their rows, and may run only the queries the manifest declares.

Lay the package out in one directory; every path in it is relative to the manifest:

```text
work/pkg/manifest.json
work/pkg/queries/staff.json    one DSL object, exactly what execute-dsl accepts
work/pkg/calculate.py
```

Test a query on its own with `execute-dsl @work/pkg/queries/staff.json`, then deliver the package
in one command:

```sh
node <this-skill>/scripts/dataset.mjs deliver @work/pkg/manifest.json --meta @work/delivery.json --active
```

`manifest.json`:

```json
{
  "schema": "ontomato.query-package.v1",
  "entry": {"kind": "python", "path": "calculate.py"},
  "queries": {"staff": "queries/staff.json"},
  "modules": [],
  "parameterDefs": [],
  "parameterBindings": [],
  "computation": {
    "operations": [
      {"id": "avg_age", "operation": "aggregate", "expression": "AVG(staff.age)",
       "inputs": [{"query": "staff", "key": "age", "role": "value"}]}
    ],
    "outputs": [{"key": "average_age", "from": "avg_age"}]
  }
}
```

`calculate.py`:

```python
# ontomato-python:2
import json
from query_runtime import execute_dsl_file
rows = execute_dsl_file("queries/staff.json")
ages = [float(row["age"]) for row in rows if row["age"] not in (None, "")]
print(json.dumps({"answer": [{"average_age": round(sum(ages) / len(ages), 2)}]}))
```

- The first line `# ontomato-python:2` is required. Print exactly one JSON object, `{"answer": [rows]}`.
- `execute_dsl_file(path)` returns the rows of that declared query, keyed by its output `as` names.
- `computation` tells the host what the Python does with the query outputs, so it can trace where each
  result column comes from. Declare one operation per step: `aggregate`, `calculate`, `group`,
  `filter`, `join`, `project` or `constant`, with an `expression` written plainly (`AVG(staff.age)`,
  `active.n / total.n`) and `inputs` naming `{"query", "key", "role"}` or `{"operation", "role"}`,
  where role is `value`, `group`, `filter` or `join`. The expressions are declarations; only the
  Python is executed.
- The keys of the printed rows, the `outputs` keys and the `columnLabels` in delivery.json must be
  the same set.
- Leave `parameterDefs` and `parameterBindings` empty unless the question itself has a parameter.
