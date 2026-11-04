# Query logic packages

Ontology owns one closed execution input: `{manifest,files:[{path,content}]}`.
The wire schema is `src/query-package.ts`; its generated structural JSON Schema
is used by Java. File content is UTF-8 source, never exploration rows or credentials.
A plain DSL file is normalized by the collection boundary to a package with one
`query.json`, query ID `main`, and a DSL entry. No Python or handwritten manifest
is needed for this case. Full packages use this manifest:

```json
{
  "schema": "ontomato.query-package.v1",
  "entry": {"kind":"python","path":"calculate.py"},
  "queries": {"employees":"queries/employees.json"},
  "modules": [],
  "parameterDefs": [],
  "parameterBindings": [],
  "computation": {
    "operations": [{"id":"total","operation":"aggregate","expression":"SUM(employees.salary)",
      "inputs":[{"query":"employees","key":"salary","role":"value"}]}],
    "outputs":[{"key":"total","from":"total"}]
  }
}
```

A manifest DSL entry is `{kind:"dsl",query:"employees"}` with computation:null.
Queries map logical IDs to files. Modules explicitly lists additional Python
source files; the Python entry must not also appear there. No directory scan or
inferred import closure. Paths are relative without links, dot segments, backslashes
or absolute prefixes. Collected files must exactly match those declared.

Python follows the existing answer protocol:

```python
# ontomato-python:2
import json
from query_runtime import execute_dsl_file, parameters
rows = execute_dsl_file("queries/employees.json")
print(json.dumps({"answer": [{"total": sum(row["salary"] for row in rows)}]}))
```

Only Java runs it. Raw DSL submission from a package grant is forbidden. Query
references resolve to frozen server input; editing sandbox files cannot replace
it. An execution-bound package-read grant permits only package references at
/ontology/query/execute-dsl, under the owner, domain, task classes and deadline.
The generic runtime still receives ordinary files[] and one entry, with Java's
private helper and parameters.json. No second runtime or elevated model token.

Parameter definitions use Function name/type/value, optional description/sample/
classNames. All standard Function parameter types retain their value meanings.
The package owns these definitions; bindings own actual values. Parameters are
JSON values, never identifiers or source interpolation. A parameterBindings item
is `{query,parameter,pointer}`. The pointer may target an existing condition value,
time_range start/end, output limit count/offset or vector query value. It cannot
target class, field, relation, operator, expression or structural containers.
`execute_dsl_file(path, parameter_values={...})` can override only parameters
bound to that query. Arrays and null stay values, not DSL structure.

Java derives each DSL graph. For Python, operations describe only the additional
calculation: project/filter/group/aggregate/join/calculate/constant, expression,
and inputs. Inputs reference `{query,key,role}` or `{operation,role}`; role is
value/group/filter/join. Outputs map final key to an operation ID or `query.key`.
Java namespaces DSL nodes and turns intermediate outputs into project nodes,
then validates one combined existing ontomato.query-subgraph.v1 graph. Python
statements are trusted declarations as before; no static lineage analysis.
Final row keys, labels and graph output keys must agree. Labels are separate
business metadata and never permission evidence.

Java computes packageSha256 over canonical manifest plus exact source files, and
executionInputSha256 over package hash plus actual values. The accepted dataset
freezes them with the receipt. Runtime sourceSha256 continues to hash only its
entry file. Its idempotency fingerprint already includes all files. A changed
source, binding target or computation declaration invalidates a generation test;
pure parameter descriptions do not. Test acceptance reads all files from the
same generation run, not inherited artifacts or a model's success claim.

New retrieval output is workbench.dataset.v2. Submission recipes are package or
metric references; old dsl/python writing is rejected. A metric receipt includes
its frozen package but keeps kind:metric so candidate binding behavior stays
unchanged. v1 immutable datasets are accepted only on historical reads. Stored
protocol-2 read Functions without a package retain their original execution and
source declarations at the read boundary; saving changes requires a package.
Old protocols still require explicit migration. No bulk conversion or guessed
DSL extraction. Read Functions store one queryPackage; parameters are projected,
return graphs are generated, and MetricViews reference that Function.

During the separately coordinated QC cutover, executedCode is a generated,
complete-source projection for the existing QC call. It is not the saved algorithm,
not accepted as a new write format, and must be removed when QC consumes packages.
This batch does not change blind-view rules, quotes, scoring or QC lifecycle.
