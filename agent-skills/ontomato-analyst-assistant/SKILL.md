---
name: ontomato-analyst-assistant
description: "Read ontology metadata and ask complete business data questions through an existing Ontomato ontology. Use for dataset descriptions, classes, fields and relationships, published metric search and business knowledge search, and the ask retrieval entry; this package never queries data directly."
---

# Ontomato assistant analyst

## This skill's role

Answer business questions using the current ontology and its permitted data. This package reads ontology definitions and asks the ontology retriever for data; it does not change the data source, ontomap, permissions or business records.

Use one consistent ontology context: deployment, domain where applicable, object identities and resource references. Reuse the business intent, access and scope already established in the session. Resolve technical facts through the metadata commands below. Ask only for missing business decisions or access that those commands cannot supply; do not ask a nontechnical user to guess technical facts. If a required capability is unavailable, explain the missing prerequisite and affected business task while preserving the requested outcome.

## Configuration

Use Node.js 18 or newer. Scripts read environment first and application.yml beside the script as fallback.
Use ONTOMATO_ONTOLOGY_URL (including any ontology gateway prefix),
ONTOMATO_TK (sent as tk), and optionally ONTOMATO_URL as the common deployment base.
The YAML fallback keys are ontologyUrl, tk and envUrl. An explicit service URL is sufficient without envUrl.
ONTOMATO_LANGUAGE and ONTOMATO_CORRELATION_ID propagate to requests.
ONTOMATO_RUN_ID supplies the run header when a host provided it.
ONTOMATO_QUERY_TK optionally selects the host-issued ontology execution credential.

Run `node ontomato.mjs <command>` from this directory. JSON accepts `@file`.

## Commands

| Command | API and result |
| --- | --- |
| `dataset-desc`, `classes` | `GET /ontology/query/overview`: description or class names/descriptions |
| `schema <class>...`, `relationships <class>...` | `POST /ontology/query/schema`: enabled fields and direct relationships |
| `metrics <question> [--cursor id] [--limit n]` | `POST /ontology/query/metrics/search`: published read specifications, revision and next cursor; no model call |
| `knowledge <question> [--limit n]` | `POST /ontology/query/knowledge/search`: relevant business knowledge |
| `ask [--lang en] [--request-id UUID] "complete question"` | Start concurrent binding execution and retrieval; return the first deliverable results and download their files |
| `ask --status <retrievalId>` | Read branch status, available results, cursor and quality checks |
| `ask --wait <retrievalId> --after <cursor>` | Wait for later results without starting another query; download only the returned results |
| `ask --cancel-retriever <retrievalId>` | Cancel only the current retriever, retaining binding results and their QC |
| `ask --cancel <retrievalId>` | Cancel unfinished work in both branches; keep accepted results |
| `ask --resume <retrievalId> --answers @answers.json [--request-id UUID]` | Explicit answers in the same session, new run |

Read definitions through the metadata commands and bring every data question to `ask`.

## ask lifecycle

`ask` prints its request ID before creating work and then the retrieval/session IDs.
The ontology host runs binding recall/execution and the retriever concurrently.
They do not share execution results. Only a successfully executed binding can
return early; no match or a binding failure keeps ask waiting for the retriever.
A successful result with zero rows is still a result, with its completeness flags.
The response includes pending branch status, a result cursor and downloaded files.
If a binding answers the question, explicitly cancel the retriever. Otherwise
wait with the returned cursor for later results. Keep the new cursor after every
wait. Do not restart ask for this question or treat lookup failure as empty data.
Binding files are formal host results with null selfCheck, not agent self-checks.
The retriever retains its existing metric-use and comparison requirements.
Keep them to inspect or retry an uncertain response. Reusing a request ID with
changed input is an error. Status returns the authoritative PI run state, messages and file artifact IDs.
A normal stop may be a question, not a dataset. Ask the user and resume the same
retrieval with their text; silence does not select a recommendation.

```json
{"expectedRunId":"<run from status>","expectedDecisionRevision":0,
 "message":"Use active employees only"}
```

Use this envelope with ask --resume <id> --answers @file and a fresh request ID.
Reuse that same request ID/envelope after a lost response. Quality checking is
asynchronous; inspect ask --status later.

## Query workflow and result meaning

Read overview, schema/relationships and knowledge before asking. Retrieve metric
specifications before inventing a calculation. `ask` does this orchestration
for natural-language questions. It can take several minutes.

An `answer` is data, not permission to claim complete coverage. Preserve `truncated`,
`rowLimit` and `truncationHint`, including an empty partial result. Null, false and
zero are distinct values. Missing relationships/fields are ontology gaps; do not
invent joins or request elevated credentials to force a result. Report the business
answer with scope, assumptions and limits. Final datasets from `ask` are rerun
under the user's authorization and stored as immutable artifacts.
