---
name: ontology-query
description: Query ontology structure, DSL syntax, stored values, business knowledge and published metrics through Ontomato.
compatibility: Requires Node.js 18 or newer and an authorized Ontomato ontology service credential.
---

# Ontology query

Run commands from the workspace root as `node <this-skill>/scripts/ontomato.mjs <command>`, where `<this-skill>` is the directory this SKILL.md is in. `@file` arguments are relative to the workspace root.

## Configuration

Scripts read environment first and `application.yml` beside the skill directory as fallback. Use `ONTOMATO_ONTOLOGY_URL` (including any ontology gateway prefix), `ONTOMATO_TK` (sent as `tk`), and optionally `ONTOMATO_URL` as the deployment base. The YAML keys are `ontologyUrl`, `tk` and `envUrl`. `ONTOMATO_LANGUAGE` and `ONTOMATO_CORRELATION_ID` are sent when present. In a hosted execution the host supplies `ONTOMATO_EXECUTION_CALLBACK`; metric runs use `ONTOMATO_RETRIEVAL_CALLBACK_URL` when the host supplies it.

## Commands

| Command | API and output |
| --- | --- |
| `dataset-desc` | `POST /ontology/query/overview`; prints the ontology description |
| `classes` | `POST /ontology/query/overview`; prints class names and descriptions |
| `schema <class>...` | `POST /ontology/query/schema`; prints enabled fields and direct relationships |
| `relationships <class>...` | `POST /ontology/query/schema`; prints direct relationships |
| `dsl-reference <class>...` | `POST /ontology/query/dsl-reference`; prints the generated DSL syntax and Markdown examples |
| `distinct-values <class> <attribute> [--like text] [--limit n]` | `POST /ontology/query/distinct-values`; prints values and the completeness marker |
| `execute-dsl <json\|@file>` | `POST /ontology/query/execute-dsl`; prints the rows and execution metadata of one DSL object |
| `knowledge <question> [--limit n]` | `POST /ontology/query/knowledge/search`; prints matching business knowledge entries |
| `metrics <question> [--cursor id] [--limit n]` | `POST /ontology/query/metrics/search`; prints published metric matches, revisions and the next cursor |
| `execute-metric <id> --revision <revision> [@parameters.json] [--binding id]` | `POST /ontology/query/metrics/execute`; prints the executed metric result |
| `recall-metrics <question>` | `POST /ontology/query/metrics/recall`; prints the recall response, or fails after a 3 second timeout |
| `run-metric <id> --revision <revision> --question <question> [--binding id \| --params @file]` | Starts one retrieval metric run, waits for its output, writes `outputs/metrics/<key>.dataset.json` and prints `{path,title,rowCount,columns,truncation,receiptId}` |

`--binding` selects an owned parameter set. `--params` supplies a JSON object; it is mutually exclusive with `--binding`. [DSL reference](references/dsl.md) describes the DSL command responses.

A command that succeeds prints its result on stdout and exits 0. A command that fails prints only the error message on stderr, nothing on stdout, and exits 1; the message is the service's own error, for example `limit must be between 1 and 100`. A script that parses a command's output checks the exit status first and parses stdout only after success. Keep stderr out of a file you parse (no `2>&1`): parsing an error message as JSON fails with `JSONDecodeError` and hides the real error.
