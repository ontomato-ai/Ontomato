---
name: metricview-generation
description: Generate one reusable parameterized MetricView read function from a natural-language requirement, using ontology-owned validation and business tests.
---

# MetricView generation

Use the task-specific definition and its business rules. Use standard `read`, `write`, `edit` and `bash` tools for workspace files. Explore schema, relationships, distinct values and DSL with the `ontomato-analyst` skill. Java paths are never workspace paths.

Run `node <this-skill>/scripts/generation.mjs <command> [arguments]`. Runtime supplies `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_GENERATION_ID`, `ONTOMATO_GENERATION_KIND`, and the scoped `ONTOMATO_GENERATION_TK`. The analyst uses the separate read-only `ONTOMATO_QUERY_TK` grant.

| Command | Use |
| --- | --- |
| `test program.py parameters.json` | Business test the exact source bytes and parameter definitions. The JSON file is an array (use `[]` for no parameters). Read operations cannot acquire a write sandbox. |
| `begin [source.py]` | External agents only: open a MetricView business gate using `ONTOMATO_TK` or `ONTOMATO_API_KEY`; no runtime history is invented. |
| `close` | External agents close their gate. Hosted runs are closed by the host. |

Never put credentials, identity, URLs, local paths or transport parameters in generated business parameter definitions. Python uses the existing `# ontomato-python:2` protocol and `query_runtime` helper. Test errors are feedback for correcting the source; a bash success is not a business test receipt.

## Delivery

Write **one JSON object** to `outputs/result.json`: `sourcePath` (a workspace-relative Python file, tested with these exact parameter definitions after its last modification), `parameterDefs` (array), `outKeyRefs` (array of key/className/attrName/asGroupBy/statCal), `name`, `logic`. No JSON fences or XML wrappers. This file replaces any earlier instructions about submitting tools or replying with code/labels. There are no submit tools. The host validates the file from this run, not an inherited artifact or a model claim about a test. Java owns the parameter and return checks, saving, status and publication; do not publish an asset or fabricate a test receipt yourself.

Finish with a brief description after writing the result.
