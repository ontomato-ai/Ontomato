---
name: data-retrieval
description: Produce a dataset file from a DSL, Python or published metric recipe by rerunning it through Ontomato under the user's authorization. Use after investigating a complete business question and declaring its sources and assumptions.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato workbench tk credential.
---

# Data retrieval files

Investigate using ontomato-analyst. Use the harness's read/write/edit/bash tools;
Python runs through bash. Do not call ask recursively from a product retriever.
Read [dataset recipes](references/dataset.md), write work/recipe.json, then run:

```sh
node <this-skill>/scripts/dataset.mjs @work/recipe.json outputs/result.dataset.json
```

The command requests a fresh authorized execution and writes the exact returned
dataset. Reference the resulting file; do not rewrite its rows in another file.
A partial dataset remains partial, even after aggregation or an empty result.
If business intent is unclear, ask the user in normal text and stop the turn.
There is no completion or needs-input command.

Set ONTOMATO_WORKBENCH_URL, ONTOMATO_TK (sent as tk), and optionally
ONTOMATO_LANGUAGE / ONTOMATO_CORRELATION_ID / ONTOMATO_OUTPUT_DIR (default outputs).
Product execution supplies ONTOMATO_RETRIEVAL_ID, ONTOMATO_SESSION_ID and
ONTOMATO_RUN_ID. Use the supplied run ID. Outside product execution, when the run
ID is absent, the script calls begin with the question and saves returned host
work identity in work/.retrieval-run.json. No runtime agent or trusted exploration
credential is created: external execution always uses your own user permissions.

For an explicit new round run `node <this-skill>/scripts/dataset.mjs begin @work/question.json`
with `{"question":"..."}`. Begin reuses the saved external record and closes its
previous write gate. `close` closes that gate when done. Keep work/ files for
response-loss reconciliation. Output requests reuse their saved idempotency key;
changed recipes receive a new key. Closed/expired run writes return HTTP 409.
