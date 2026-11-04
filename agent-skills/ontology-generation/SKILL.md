---
name: ontology-generation
description: Generate or explain ontology Actions, Functions, knowledge and dashboards; instantiate MetricView candidates; describe and quality-check query programs using ontology-owned validation.
---

# Ontology generation

Use the task-specific definition and its business rules. Use standard `read`, `write`, `edit` and `bash` tools for workspace files. Explore schema, relationships, distinct values and DSL with the `ontomato-analyst` skill. Java paths are never workspace paths.

Run `node <this-skill>/scripts/generation.mjs <command> [arguments]`. Runtime supplies `ONTOMATO_ONTOLOGY_URL`, `ONTOMATO_GENERATION_ID`, `ONTOMATO_GENERATION_KIND`, and one scoped `ONTOMATO_TK` for both metadata queries and generation operations. When the user only asks to refresh the structured explanation, run `explain`; do not edit the action.

| Command | Use |
| --- | --- |
| `source [startLine [endLine]]` | Read the exact Action source to explain; line numbers start at 1. Read it in one call. Do not pipe it through `sed`, `head` or `tail`: the command already returns the requested slice, and repeated paging is treated as no progress. |
| `explain` | Re-run the structured explanation for the current conversation's newest draft from its saved code. Use only when the user asks to refresh/regenerate the right-side definition; it does not change the action code. |
| `test-package outputs/package.json labels.json` | Test the complete read package, default parameter values and output labels. Plain DSL entries are accepted. Requires the data-retrieval skill alongside this skill. |
| `test outputs/program.py parameters.json` | Action business test only. Read operations use test-package and cannot acquire a write sandbox. |
| `prepare data.json` | Validate Action sandbox fixture `{objDatas,relDatas,vectorDatas}`; object groups contain className and rows, relationships contain relationName/sourceObjId/targetObjId. |
| `reset` | Clear the Action sandbox and import the prepared fixture. Repeat before independent Action tests. |
| `query dsl.json` | Query the Action sandbox to verify side effects. |
| `helpers` | Return the exact Python helper signatures and parameter rules for the current gate, generated from the single `python/query_runtime.py` source. |
| `begin kind [source.py]` | External agents only: open a business gate using `ONTOMATO_TK` or `ONTOMATO_API_KEY`; no runtime history is invented. |
| `close` | External agents close their gate and remove its sandbox. Hosted runs are closed by the host. |

Never put credentials, identity, URLs, local paths or transport parameters in generated business parameter definitions. Python uses protocol `# ontomato-python:2`. Java alone injects the private `query_runtime` helper and execution tk; do not run query programs with local Python. Run `node <this-skill>/scripts/generation.mjs helpers` for Action helper signatures before writing an Action program; read query programs follow the package reference directly. In particular, `query(dsl)` takes one DSL object, not a class name or `where`; `where` belongs only to `update`/`delete`. All test output is already filtered for the current user. For read programs, follow [query packages](references/query-package.md). Use `execute_dsl_file`, keep DSL in declared JSON files and declare only the Python computation fragment. Java derives DSL sources. Reusable filters are parameterized by JSON value bindings. Do not submit a second full sourceAnalysis. Action programs retain their existing source and parameter protocol. Test errors are feedback for correcting the source; a bash success is not a business test receipt.

## Delivery

Write **one JSON object** to `outputs/result.json`, with the following fields for the current kind. No JSON fences or XML wrappers. This file replaces any earlier instructions about submitting tools or replying with code/labels. There are no submit tools. Read deliveries use `packagePath` under outputs/, plus `columnLabels`; the host collects every declared file from this run and verifies the whole package test. Parameter definitions live in the manifest only. Action deliveries use sourcePath and parameterDefs as before. After the last execution change, test the exact delivered files again; description-only changes need no additional query.

| Kind | Result fields |
| --- | --- |
| action | `sourcePath`, `parameterDefs` (array), `classNames` (nonempty array), `name`, `logic`, optional `submissionCriteria` (`operator`, `conditions`, `unrepresentable`) |
| function | `packagePath`, `columnLabels`, `name`, `logic`; preserve the supplied output keys |
| dashboard | `packagePath`, `columnLabels`, `title`; parameter definitions belong to the package |
| explain | `segs`, `operations`, `negativeEffect`, exactly following the explanation schema in the task definition; read source first |
| instantiate | `instances`: array of `{id,question,parameters}` matching only the supplied MetricView candidates |
| name | `name` |
| knowledge | `knowledge`: array of `{title,knowledge}`; empty means no replacement |
| describe | `meaning` (the complete program logic), `summary` |
| quality | `conclusion`, numeric `score`, `fittedQuestion`; preserve the scoring rules in the definition |

Quality checking and Function candidates run as ontology definitions on this runtime. Java owns their asynchronous records, score thresholds, candidate/publication rules and cancellation. Do not publish an asset or fabricate a check receipt yourself. Finish with a brief description after writing the result.
