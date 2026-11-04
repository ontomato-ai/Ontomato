---
name: data-retrieval
description: Deliver a query logic package as a dataset by rerunning it through Ontomato under the user's authorization.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato ontology service credential.
---

# Data retrieval

Each result table is delivered as a dataset: the host reruns your query under the user's permissions and writes the file. Read [delivery inputs](references/dataset.md) before the first delivery; read [query packages](references/query-package.md) only when you need Python.

```sh
node <this-skill>/scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json [--out outputs/name.dataset.json]
```

- Run it from the workspace root. Paths inside a package are relative to the manifest's directory.
- Deliver when the logic is ready. `preview` takes the same arguments and is only for a real doubt.
- One table per delivery; several tables mean several deliveries.
- Reference the returned file; never edit its rows or receipt.

Outside the product, set ONTOMATO_ONTOLOGY_URL and ONTOMATO_TK (or ONTOMATO_API_KEY), optionally ONTOMATO_LANGUAGE and ONTOMATO_OUTPUT_DIR, run `begin @work/question.json` with `{"question":"..."}` before delivering and `close` when done. Inside the product these are already set. Keep work/.retrieval-*.json and work/.dataset-*.json so a lost response can be reconciled.
