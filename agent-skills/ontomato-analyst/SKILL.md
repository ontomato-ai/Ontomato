---
name: ontomato-analyst
description: "Query and analyze business objects and relationships through an existing Ontomato ontology. Use for natural-language questions, controlled DSL queries, value exploration and analysis reports; read the current definitions without changing the ontology or business data."
---

# Ontomato analyst

## Ontomato: work through one ontology

Ontomato is an ontology platform: it describes a business domain and uses that shared meaning to connect data, answer questions and provide business operations.

| Concept | Meaning |
| --- | --- |
| Class and object | A class describes a business object type, such as Employee or Department. An object is one instance, identified by its primary-key value. |
| Attribute | A named property of an object, with a type and business meaning. Display names and descriptions explain a field; they do not replace its technical name. |
| Relationship | A directed business connection, such as Employee **belongs to** Department. Its meaning is distinct from how a database stores or queries it. |
| ontomap | The machine-readable definition of classes, attributes, relationships, descriptions and data mappings. It describes the data; it is not the object records themselves. |
| Business knowledge and resources | Knowledge adds terminology, rules and calculation meanings. A `vector` attribute associates text or file resources with an object for semantic retrieval and display. Each skill exposes only its documented resource operations. |
| Capabilities on the ontology | Queries and analyses use these definitions. MetricViews expose reusable queries; Actions expose defined business operations. Applications call those capabilities. Their definitions and business knowledge are managed separately from the ontomap JSON. |

Classes and attributes must map to real structures in the selected data source. With a relational source, a relationship can use matching columns through JOIN; with a graph source, it can use stored edges. A storage change does not by itself remove a business relationship. Resolve its mapping, direction and multiplicity from evidence; do not infer a valid join merely from similar column names. A bridge table or another prepared mapping may be necessary for some relationships.

Use one consistent ontology context: deployment, domain where applicable, object identities and resource references. Reuse the business intent, access and scope already established in the session. Resolve technical facts, such as JOIN columns and existing grant sources, through commands, authorized data tools and bundled references. Ask only for missing business decisions or access that those tools cannot supply; do not ask a nontechnical user to guess technical facts. If a required capability is unavailable, explain the missing prerequisite and affected business task while preserving the requested outcome.

The skills cover different tasks on this same platform: `ontomato-ontomap-builder` maintains definitions and mappings; `ontomato-analyst` queries and analyzes them; `ontomato-app-builder` builds applications on their capabilities. Adapter development and enterprise permission management support this platform at their own boundaries. These names explain the roles, not dependencies on other installed skills. Keep this package's files together; its local references travel with it.

## This skill’s role

Answer business questions using the current ontology and its permitted data. This package reads definitions and queries data; it does not change the data source, ontomap, permissions or business records. It needs no product checkout. Choose `ask` for a natural-language question, `execute-dsl` when you need to control the query, or the separately configured analysis MCP service for a report.

## Configuration

Use Node.js 18 or newer. Keep this package together; no product checkout is needed.
Scripts read environment first and application.yml beside the script as fallback.
Use ONTOMATO_ONTOLOGY_URL (including any ontology gateway prefix),
ONTOMATO_TK (sent as tk), and optionally ONTOMATO_URL as the common deployment base.
The YAML fallback keys are ontologyUrl, tk and envUrl. An explicit service URL is sufficient without envUrl.
ONTOMATO_LANGUAGE and ONTOMATO_CORRELATION_ID propagate to requests.
ONTOMATO_RUN_ID supplies the run header when a host provided it. The Python helper
uses the same variables. ONTOMATO_QUERY_TK optionally selects the host-issued
ontology execution credential, and ONTOMATO_QUERY_RUN_ID preserves its bound run
for a nested standalone execution. Ordinary external execution uses your own tk.

The product loads these same files read-only and invokes the commands below using
bash. Read this file and references on demand; no runtime-specific entry exists.
Python uses `python/query_runtime.py` via PYTHONPATH; use protocol-2 source as in
the data-retrieval skill. Public anonymous access follows the installed policy.
For enterprise login, obtain an authorized tk before execution; it is not a runtime
service credential. The enterprise distribution includes a separate login helper.

## Commands

Run `node ontomato.mjs <command>` from this directory. JSON accepts `@file`.

| Command | API and result |
| --- | --- |
| `dataset-desc`, `classes` | `GET /ontology/query/overview`: description or class names/descriptions |
| `schema <class>...`, `relationships <class>...` | `POST /ontology/query/schema`: enabled fields and direct relationships |
| `dsl-reference <class>...` | `POST /ontology/query/dsl-reference`: current class-specific syntax and Markdown examples |
| `distinct-values <class> <attribute> [--like text] [--limit n]` | `POST /ontology/query/distinct-values`: values and completeness marker |
| `execute-dsl @query.json` | `POST /ontology/query/execute-dsl`: one read-only DSL object, under your permissions |
| `metrics <question> [--cursor id] [--limit n]` | `POST /ontology/query/metrics/search`: published read specifications, revision and next cursor; no model call |
| `execute-metric <id> --revision <revision> [@parameters.json] [--binding id]` | `POST /ontology/query/metrics/execute`: current revision checked, execution under your permissions; --binding selects an owned parameter set |
| `knowledge <question> [--limit n]` | `POST /ontology/query/knowledge/search`: relevant business knowledge |
| `ask [--lang en] [--request-id UUID] "complete question"` | Ontology `POST /ontology/retrievals`, then polling and dataset downloads |
| `ask --status <retrievalId>` | Read the authoritative retrieval result |
| `ask --cancel <retrievalId>` | Close the retrieval and request cancellation |
| `ask --resume <retrievalId> --answers @answers.json [--request-id UUID]` | Explicit answers in the same session, new run |

`ask` prints its request ID before creating work and then the retrieval/session IDs.
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
asynchronous; inspect ask --status later. The product retriever uses direct
ontology commands and the data-retrieval file script, never recursively ask.

## Query workflow and result meaning

Read overview, schema/relationships and knowledge. Retrieve metric specifications
before inventing a calculation. Inspect exact stored values when needed. For DSL,
follow [the reference entry guide](references/dsl.md) and fetch the rules for the
actual classes; the Java service owns the grammar. `ask` does this orchestration
for natural-language questions. It can take several minutes.

An `answer` is data, not permission to claim complete coverage. Preserve `truncated`,
`rowLimit` and `truncationHint`, including an empty partial result. Null, false and
zero are distinct values. Missing relationships/fields are ontology gaps; do not
invent joins or request elevated credentials to force a result. Report the business
answer with scope, assumptions and limits. Final datasets from `ask` are rerun
under the user's authorization and stored as immutable artifacts. This external
client never requests or selects exploration credentials.

## Analysis agents (MCP)

Ontomato serves its analysis agents as an MCP server:

- URL: `<envUrl>/mcp/analysis-agents`
- Transport: Streamable HTTP
- Authentication: none

Add this server to your agent's MCP configuration. Its tools:

| Tool | Use |
| --- | --- |
| `list_analysis_agents` | List enabled analysis agents |
| `run_analysis` | Start an analysis with `agentId` and `question`; returns a task |
| `get_analysis_task` | Poll a task by `taskId` for status and the report |
| `get_analysis_report_pdf` | Get a PDF download URL for the latest run's report of a task, by `taskId` |

The tool result does not carry the PDF itself. `get_analysis_report_pdf` returns a `downloadUrl`; download it with no authentication header:

```bash
curl -o report.pdf "<downloadUrl>"
```

Only report tasks that already have report text can be downloaded; conversation tasks have no report.


`ask` uses the ontology URL and the same entry inside and outside Ontomato. It prints the retrieval/run/decision revision, the final answer and downloaded dataset file paths under `outputs/retrievals/`. Reference those paths directly; do not rebuild the data. Resume with `ask --resume <retrievalId> --answers @reply.json`; the file includes `expectedRunId`, `expectedDecisionRevision` and `message`. Reuse `--request-id` after an uncertain response.

`ONTOMATO_TK` is the current user token; API-key callers can use `ONTOMATO_API_KEY`. In a hosted assistant, optional `ONTOMATO_RETRIEVAL_CALLER_ID` binds ask to its parent lifecycle. It is an association ID, not a credential; the command passes it automatically. External agents leave it unset. The retriever itself uses direct queries and data-retrieval's dataset command, not recursive ask.
