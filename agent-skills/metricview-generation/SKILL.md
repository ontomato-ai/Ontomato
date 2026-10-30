---
name: metricview-generation
description: Generate one reusable parameterized MetricView read function from a natural-language requirement, using ontology-owned validation and business tests.
---

# MetricView generation

Use the task-specific definition and its business rules. Use standard `read`, `write`, `edit` and `bash` tools for workspace files. Explore schema, relationships, distinct values and DSL with the `ontomato-analyst` skill. Java paths are never workspace paths.

Run `node <this-skill>/scripts/generation.mjs <command> [arguments]`. Runtime supplies `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_GENERATION_ID`, `ONTOMATO_GENERATION_KIND`, and one scoped `ONTOMATO_TK` for both metadata queries and generation operations.

| Command | Use |
| --- | --- |
| `test outputs/program.py parameters.json source-analysis.json` | Business test the exact source bytes and parameter definitions. The parameter JSON file is an array (use `[]` for no parameters); read programs also supply source-analysis.json. Read operations cannot acquire a write sandbox. |
| `begin [source.py]` | External agents only: open a MetricView business gate using `ONTOMATO_TK` or `ONTOMATO_API_KEY`; no runtime history is invented. |
| `close` | External agents close their gate. Hosted runs are closed by the host. |

Never put credentials, identity, URLs, local paths or transport parameters in generated business parameter definitions. Python uses protocol `# ontomato-python:2`. Java alone injects the private `query_runtime` helper and execution tk; do not run query programs with local Python. All test output is already filtered for the current user. Read references/query-subgraph.md and references/query-subgraphs.json; declare every output source and computation in sourceAnalysis, with output labels in the user's language. Reusable graphs describe parameter-dependent filters symbolically; do not freeze test/default parameter values into the graph. Test errors are feedback for correcting the source; a bash success is not a business test receipt.

## Delivery

Write **one JSON object** to `outputs/result.json`: `sourcePath` (the tested file's path under `outputs/`, for example `outputs/program.py`; write the program there because only `outputs/` is published), `parameterDefs` (array), `sourceAnalysis` (the shared subgraph JSON), `name`, `logic`. No JSON fences or XML wrappers. This file replaces any earlier instructions about submitting tools or replying with code/labels. There are no submit tools. The host validates the file from this run, not an inherited artifact or a model claim about a test. Java owns the parameter and return checks, saving, status and publication; do not publish an asset or fabricate a test receipt yourself.

Finish with a brief description after writing the result.
