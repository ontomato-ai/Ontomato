---
name: data-retrieval
description: Deliver a query logic package as a dataset by rerunning it through Ontomato under the user's authorization.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato ontology service credential.
---

# Data retrieval files

Investigate a complete question with ontomato-analyst, then read
[delivery inputs](references/dataset.md) and [query packages](references/query-package.md).
Use ordinary read/write/edit/bash tools. A plain DSL JSON is already a package;
Python packages explicitly list their query and source files. Do not call ask recursively.

```sh
node <this-skill>/scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json
```

Optional `--out outputs/name.dataset.json` selects a distinct output path;
otherwise the submission determines the name. `--params @work/values.json` supplies
business values. A metric selector contains kind:metric, metricId, revision,
parameters and optional bindingId; its Function package is resolved by Java.

Deliver directly when the logic is ready. For a necessary trial use the same
command with `preview` instead of `deliver`. Identical inputs reuse their execution;
there is no mandatory preview. Java alone runs Python and injects query_runtime.
Never run a query program with local Python or calculate on masked preview values.
Java receives all package files, applies row permissions before calculation and
masks final columns from the composed source graph. Preserve partial results,
null, false, zero and empty strings. Reference the exact returned file, never
rewrite its rows or edit its receipt.

The metadata supplies title, columnLabels, assumptions, metricUses and selfCheck.
The host supplies the admitted question and confirmed decision IDs. Business
self-checks and comparisons remain your responsibility; do not invent execution
references or decisions. Material ambiguity requires asking the user and ending
normally, not claiming completion.

Set ONTOMATO_ONTOLOGY_URL and ONTOMATO_TK (or ONTOMATO_API_KEY), optionally
ONTOMATO_LANGUAGE, ONTOMATO_CORRELATION_ID and ONTOMATO_OUTPUT_DIR (default outputs).
Hosted execution supplies ONTOMATO_RETRIEVAL_ID, ONTOMATO_SESSION_ID and ONTOMATO_RUN_ID.
Use these identities. Outside the product run `begin @work/question.json` with
{"question":"..."} before delivery; `close` closes the external write gate.
External work retains ordinary user permissions and never receives internal grants.
Keep work/.retrieval-*.json and work/.dataset-*.json for response-loss reconciliation.
Changed inputs get a new submission; closed/expired writes return 409.
