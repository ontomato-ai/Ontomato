---
name: ontology-generation
description: Generate or explain ontology Actions, Functions, knowledge and dashboards; instantiate MetricView candidates; describe and quality-check query programs using ontology-owned validation.
---

# Ontology generation

Use the task-specific definition and its business rules. Use standard `read`, `write`, `edit` and `bash` tools for workspace files. Explore schema, relationships, distinct values and DSL with the `ontomato-analyst` skill. Java paths are never workspace paths.

Run `node <this-skill>/scripts/generation.mjs <command> [arguments]`. Runtime supplies `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_GENERATION_ID`, `ONTOMATO_GENERATION_KIND`, and the scoped `ONTOMATO_GENERATION_TK`. The analyst uses the separate read-only `ONTOMATO_QUERY_TK` grant.

| Command | Use |
| --- | --- |
| `source [startLine [endLine]]` | Read the exact Action source to explain; line numbers start at 1. |
| `test outputs/program.py parameters.json` | Business test the exact source bytes and parameter definitions. The JSON file is an array (use `[]` for no parameters). Read operations cannot acquire a write sandbox. |
| `prepare data.json` | Validate Action sandbox fixture `{objDatas,relDatas,vectorDatas}`; object groups contain className and rows, relationships contain relationName/sourceObjId/targetObjId. |
| `reset` | Clear the Action sandbox and import the prepared fixture. Repeat before independent Action tests. |
| `query dsl.json` | Query the Action sandbox to verify side effects. |
| `begin kind [source.py]` | External agents only: open a business gate using `ONTOMATO_TK` or `ONTOMATO_API_KEY`; no runtime history is invented. |
| `close` | External agents close their gate and remove its sandbox. Hosted runs are closed by the host. |

Never put credentials, identity, URLs, local paths or transport parameters in generated business parameter definitions. Python uses the existing `# ontomato-python:2` protocol and `query_runtime` helper. Test errors are feedback for correcting the source; a bash success is not a business test receipt.

## Delivery

Write **one JSON object** to `outputs/result.json`, with the following fields for the current kind. No JSON fences or XML wrappers. This file replaces any earlier instructions about submitting tools or replying with code/labels. There are no submit tools. A sourcePath is the tested file's path under `outputs/` (for example `outputs/program.py`); write every delivered program there, because only `outputs/` is published. Test that exact file with these exact parameter definitions after its last modification. The host validates the file from this run, not an inherited artifact or a model claim about a test.

| Kind | Result fields |
| --- | --- |
| action | `sourcePath`, `parameterDefs` (array), `classNames` (nonempty array), `name`, `logic`, optional `submissionCriteria` (`operator`, `conditions`, `unrepresentable`) |
| function | `sourcePath`, `parameterDefs` (array), `name`, `logic`; preserve the supplied output keys |
| dashboard | `sourcePath`, `parameterDefs` (array of key/name/type/value/className/attrName), `title` |
| explain | `segs`, `operations`, `negativeEffect`, exactly following the explanation schema in the task definition; read source first |
| instantiate | `instances`: array of `{id,question,parameters}` matching only the supplied MetricView candidates |
| name | `name` |
| knowledge | `knowledge`: array of `{title,knowledge}`; empty means no replacement |
| describe | `meaning` (the complete program logic), `summary` |
| quality | `conclusion`, numeric `score`, `fittedQuestion`; preserve the scoring rules in the definition |

Quality checking and Function candidates run as ontology definitions on this runtime. Java owns their asynchronous records, score thresholds, candidate/publication rules and cancellation. Do not publish an asset or fabricate a check receipt yourself. Finish with a brief description after writing the result.
