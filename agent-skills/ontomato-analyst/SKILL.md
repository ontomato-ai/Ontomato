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

If you are already the product retriever, use the direct query commands and data-retrieval
for delivery; do not delegate the same question to another retriever. Metric lookup, metric
execution and `pending` are not part of that work: the assistant reuses published metrics itself.

Answer business questions using the current ontology and its permitted data. This package reads definitions and queries data; it does not change the data source, ontomap, permissions or business records. It needs no product checkout. Use the accessible retriever from `agent list` for a natural-language question, `execute-dsl` when you need to control the query, or the separately configured analysis MCP service for a report.

## Configuration

Use Node.js 18 or newer. Keep this package together; no product checkout is needed.
Scripts read environment first and application.yml beside the script as fallback.
Use ONTOMATO_ONTOLOGY_URL (including any ontology gateway prefix),
ONTOMATO_TK (sent as tk), and optionally ONTOMATO_URL as the common deployment base.
The YAML fallback keys are ontologyUrl, tk and envUrl. An explicit service URL is sufficient without envUrl.
ONTOMATO_LANGUAGE and ONTOMATO_CORRELATION_ID propagate to requests.
ONTOMATO_RUN_ID supplies the run header when a host provided it. All commands
use ONTOMATO_TK. Java chooses and verifies the current user's task scope; callers
never pass user/domain identity or select an elevated execution credential.

The product loads these same files read-only and invokes the commands below using
bash. Read this file and references on demand; no runtime-specific entry exists.
Python query programs use the data-retrieval preview/delivery command. Java injects
the private query_runtime helper only for that execution; it is not part of this skill. Public anonymous access follows the installed policy.
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
| `pending [--flow name] [--limit n]` | Your own pending items, read-only: only published pending metrics of active workflows; each step is restricted by your role, scope and row permissions |
| `actions` | The actions your roles are granted by an active revision, with the granting process; the same intersection the executor uses |
| `run <actionId> [@parameters.json]` | `POST /action/execute`: perform one step your roles are granted; a refusal is reported with its real cause |
| `knowledge <question> [--limit n]` | `POST /ontology/query/knowledge/search`: relevant business knowledge |

## Standalone agent commands (outside the product)

In an Ontomato conversation, delegation follows the native `agent` tool and
`ontomato-analyst-assistant`; the CLI entry below is for standalone use.

| Command | API and result |
| --- | --- |
| `agent list [query]` | List accessible agents and their provider/id references |
| `agent start --agent <providerId>/<agentId> --message @question.txt [--context @context.json]` | Admit binding and retrieval together; return taskId and sessionRef immediately |
| `agent read <taskId> [--follow] [--files]` | Read a snapshot or follow its SSE updates; download delivered files without changing their bytes |
| `agent send --session <providerId>/<sessionId> --message @answer.txt --reply-to <questionId>` | Answer in the same conversation; steer while running, otherwise start its next round |
| `agent send --session <providerId>/<sessionId> --message @question.txt [--steer]` | Continue that conversation; ordinary messages fail while busy unless explicitly steered |
| `agent cancel <taskId>` | Cancel this execution and its delegated descendants; keep accepted results |
| `retriever-cancel <sessionId> --run <runId>` | Ontology business command: stop only the retriever, preserving binding results and QC |


## Standalone delegation and results

Use `agent list` to identify the accessible data retriever and `agent start` with its returned
reference and one complete question. Preserve the user's wording and established scope.
`start` and `send` acknowledge admission, not a result. Use `read --follow` for events and
`read --files` to download delivered bytes; do not replace event following with polling or sleeps.

For a received question, consult this conversation and ask the user only for a missing business
decision. Send the answer to the question's session with `replyTo` (CLI: `--reply-to`), using
its stable question ID. The recipient may still be running; the channel chooses steering or a
new round. Silence confirms nothing. Without a product parent, questions appear in reads/events;
`read --follow` returns on an unanswered question or a terminal snapshot, so a question is not completion.

Binding and retriever branches run independently. A successful binding, including zero rows,
is available before the retriever finishes. Check its meaning, conditions and parameters before
using it as the answer; otherwise keep the retriever's task. Lookup failure is not empty data.
Preserve partial-result limits. Both branches settle before the final result notification;
quality checks continue separately. Formal binding files have null selfCheck.


## Acting on your own work

`pending` executes the active workflow's published pending metric. The server matches each
open row to a frozen step, your role's scope for that step, and your read permissions. A missing
query or failed grant lookup is an error; an authorized query with no matches returns zero rows.

`run` performs one action. An action with grant records uses the active capability grants;
only an action with no grant records uses the legacy execution API permission. A declared
target must also be readable and in scope, and its business-state preconditions must hold.
See [acting on a case](references/actions.md) for the refusals.

`actions` answers the other half: which steps are yours to run at all. It intersects your effective
roles with the grants in force, so a row left by an earlier revision is not listed. It lists candidate actions, not permission for any particular record. "I can run this"
and "this is waiting for me" are different questions; ask both before concluding you have nothing to do.

Never pass an identity to make a step succeed. A failed business precondition describes the state of the record, not a
credential problem, and retrying with different parameters will not change it.

## Query workflow and result meaning

Read overview, schema/relationships and knowledge. Outside the product retriever, retrieve
metric specifications before inventing a calculation. Inspect exact stored values when needed. For DSL,
follow [the reference entry guide](references/dsl.md) and fetch the rules for the
actual classes; the Java service owns the grammar. The retriever does this orchestration
for natural-language questions. It can take several minutes.

An `answer` is data, not permission to claim complete coverage. The platform always
filters data according to current permissions; the retriever cannot see specific
filter conditions. When describing result scope, use "within the current permission scope"
(or in the response language, such as "当前权限范围内"); never assert all records
across the domain or that there are no scope restrictions. Distinguish "all" from
all visible results within the current permission scope. Preserve `truncated`,
`rowLimit` and `truncationHint`, including an empty partial result. Null, false and
zero are distinct values. Missing relationships/fields are ontology gaps; do not
invent joins or request elevated credentials to force a result. Report the business
answer with scope, assumptions and limits. Final datasets from the retriever are rerun
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


`ONTOMATO_TK` supplies a current user token; API-key callers use `ONTOMATO_API_KEY`.
The domain comes from the credential. `agent` commands use `/platform/agent-channel/commands`;
`read --follow` uses the task's events endpoint. Do not retry an uncertain admission by
starting a second task; inspect the returned task reference. Hosted agents use the native
tool so delegation, results and cancellation remain attached to their actual conversation.
