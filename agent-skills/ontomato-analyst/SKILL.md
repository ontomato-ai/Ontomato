---
name: ontomato-analyst
description: "Connect to an existing Ontomato ontology from outside the product: delegate natural-language data questions, inspect pending work and granted actions, run permitted actions, and use analysis agents; read current definitions without changing the ontology or business data."
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

The skills cover different tasks on this same platform: `ontomato-ontomap-builder` maintains definitions and mappings; `ontomato-analyst` connects external agents to them; `ontomato-app-builder` builds applications on their capabilities. Adapter development and enterprise permission management support this platform at their own boundaries. These names explain the roles, not dependencies on other installed skills. Keep this package's files together; its local references travel with it.

## This skill’s role

Answer business questions using the current ontology and its permitted data. This package delegates data questions and acts on pending work; it does not change the data source, ontomap, permissions or business records. It needs no product checkout. Use the accessible retriever from `agent list` for a natural-language question, install `ontology-query` when you need to control the query, or use the separately configured analysis MCP service for a report.

## Configuration

Use Node.js 18 or newer. Keep this package together; no product checkout is needed.
Scripts read environment first and application.yml beside the script as fallback.
Use ONTOMATO_ONTOLOGY_URL (including any ontology gateway prefix),
ONTOMATO_TK (sent as tk), and optionally ONTOMATO_URL as the common deployment base.
The YAML fallback keys are ontologyUrl, tk and envUrl. An explicit service URL is sufficient without envUrl.
ONTOMATO_LANGUAGE and ONTOMATO_CORRELATION_ID propagate to requests.
In a hosted session, commands send the session credential from ONTOMATO_EXECUTION_CALLBACK
and the session bridge supplies the active run header. Outside a hosted session, commands use
ONTOMATO_TK and send an explicit run header when the caller supplies ONTOMATO_RUN_ID.
Java chooses and verifies the current user's task scope; callers
never pass user/domain identity or select an elevated execution credential.

Read this file and references on demand; no runtime-specific entry exists. Public anonymous access follows the installed policy.
For enterprise login, obtain an authorized tk before execution; it is not a runtime
service credential. The enterprise distribution includes a separate login helper.

## Commands

Run `node <this-skill>/ontomato.mjs <command>` from the workspace root, where `<this-skill>` is the directory this SKILL.md is in; `@file` arguments are relative to the workspace root. JSON accepts `@file`.

| Command | API and result |
| --- | --- |
| `pending [--flow name] [--limit n]` | Your own pending items, read-only: only published pending metrics of active workflows; each step is restricted by your role, scope and row permissions |
| `actions` | The actions your roles are granted by an active revision, with the granting process; the same intersection the executor uses |
| `run <actionId> [@parameters.json]` | `POST /action/execute`: perform one step your roles are granted; a refusal is reported with its real cause |

## Agent commands (platform and standalone)

In a platform run (`ONTOMATO_SKILL_SCENARIO=platform`), `agent` CLI commands use the current run's
runtime channel (`ONTOMATO_AGENT_COMMAND_URL` and `ONTOMATO_AGENT_CALLBACK`), equivalent to the
native `agent` tool: `read --files` writes directly into the caller's `outputs/agents/` and
`read --follow` is unsupported (end the turn to wait for delivery or question notifications).
Outside the product (standalone), `agent` commands use `/platform/agent-channel/commands` with
`ONTOMATO_TK` or `ONTOMATO_API_KEY`, `read --follow` consumes SSE, and `read --files` downloads
delivered bytes into `ONTOMATO_OUTPUT_DIR` (`outputs`).

| Command | API and result |
| --- | --- |
| `agent list [query]` | List accessible agents and their provider/id references |
| `agent start --agent <providerId>/<agentId> --message @question.txt [--context @context.json]` | Admit the retriever's task; return taskId and sessionRef immediately |
| `agent read <taskId> [--follow] [--files]` | Read a snapshot (or follow SSE updates outside the platform); deliver files without changing their bytes |
| `agent send --session <providerId>/<sessionId> --message @answer.txt --reply-to <questionId>` | Answer in the same conversation; steer while running, otherwise start its next round |
| `agent send --session <providerId>/<sessionId> --message @question.txt [--steer]` | Continue that conversation; ordinary messages fail while busy unless explicitly steered |
| `agent cancel <taskId>` | Cancel this execution and its delegated descendants; keep accepted results |


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

The retriever's task ends with its delivered files or its answer; zero rows can be a formal result.
Check each file's scope, assumptions and self-check before using it. Preserve partial-result limits.
Lookup failure is not empty data.


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
The domain comes from the credential. Inside a platform worker (`ONTOMATO_SKILL_SCENARIO=platform`),
`agent` commands call the runtime's run-scoped channel URL with `ONTOMATO_AGENT_CALLBACK` so
delegation, results and cancellation stay attached to the active run. Outside the product, `agent`
commands use `/platform/agent-channel/commands` and `read --follow` uses the task's events endpoint.
Do not retry an uncertain admission by starting a second task; inspect the returned task reference.
