---
name: data-retrieval
description: Deliver a query logic package as a dataset by rerunning it through Ontomato under the user's authorization.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato ontology service credential.
---

# Data retrieval

Each result table is delivered as a dataset: the host reruns your query logic under the user's
permissions, records where the data came from and writes the file. One command delivers it, run from
the workspace root, where `<this-skill>` is the directory this SKILL.md is in:

```sh
node <this-skill>/scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json --active [--out outputs/name.dataset.json]
```

`--active` delivers into the retrieval the platform started for you; leave it out only outside the
product (see the end of this file).

## The query logic package

What you deliver is a query logic package. It has one of two shapes, delivered the same way:

- **DSL only.** `work/q.json` is one DSL object (not an array). A plain DSL file is already a complete
  package. Use this whenever the DSL can express the whole calculation: it runs in the database, its
  source can be traced, and quality checks and later reuse read it directly.
- **Python with its DSL.** Only when one step cannot be expressed in the DSL, for example averaging an
  age stored as text, or combining two independent queries into a ratio. The Python does that step and
  nothing else; the data still comes from DSL declared in the package, and the Python may change only
  their parameter values. Read [query packages](references/query-package.md) for the manifest; paths
  inside a package are relative to the manifest's directory.

## Delivery inputs

`work/delivery.json` describes the table for the reader and has exactly these top-level fields:

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
what population the table covers, which filters apply, what one row is, the denominator if there is a
share, and how empty groups are treated; write "not applicable" where one does not apply. The host
fills in the question, decisions, source graph, hashes and receipt. A delivery is your own query logic;
do not look for a metric to reuse or compare against.

## Delivering

- One table per delivery. A question that needs several tables gets several deliveries, each with its
  own `--out`; do not merge unrelated results with Python.
- Write the query straight into the file you will deliver. Deliver when the logic is ready; the
  delivery itself runs the query and reports any error. To see a result first, run that same file
  with ontology-query's `execute-dsl`, and when it answers the question deliver it unchanged rather than writing it
  again. `preview` takes the same arguments as `deliver` and is only for a real doubt about the result.
- A small table's rows come back in the command's response; open the file only when you need more.
- Reference the returned file; never edit its rows or receipt.

Outside the product, set ONTOMATO_ONTOLOGY_URL and ONTOMATO_TK (or ONTOMATO_API_KEY), optionally ONTOMATO_LANGUAGE and ONTOMATO_OUTPUT_DIR, omit `--active`, run `begin @work/question.json` with `{"question":"..."}` before delivering and `close` when done. Keep work/.retrieval-*.json and work/.dataset-*.json for external retrieval and output reconciliation.
