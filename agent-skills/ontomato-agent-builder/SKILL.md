---
name: ontomato-agent-builder
description: "Ontomato agents and MCP: create and change the definitions of regular and report agents (prompt, callable MetricViews and Actions, external MCP services and skills, data scope) and maintain the connections of external MCP services. Not for building the ontology or writing data; MetricViews and Actions are written and published with ontomato-app-builder."
---

# Ontomato agents and MCP

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

The skills cover different tasks on this same platform: `ontomato-ontomap-builder` maintains the ontology and its data (definitions, mappings, business data and resources); `ontomato-app-builder` builds MetricViews, Actions and applications on it; `ontomato-agent-builder` configures agents and MCP services; `ontomato-analyst` queries and analyzes. Adapter development and enterprise permission management support this platform at their own boundaries. These names explain the roles, not dependencies on other installed skills. Keep this package's files together; its local references travel with it.

## This skill’s role

Configure the agents users talk to: write an agent's prompt, select the published MetricViews (read-only), Actions, external MCP services and skills it may use, and limit the classes it may query; maintain the domain's external MCP services. MetricViews and Actions are built and published with `ontomato-app-builder`; this package only refers to their IDs. It works through deployed APIs without the product source.

## Prerequisites

- The deployment is running and its frontend URL is known, for example `http://host:3000`.
- The account can manage agents and MCP services (usually a domain administrator).
- Node.js 18 or later. The script uses only Node built-ins.

Agent, MCP service and skill interfaces live under `<envUrl>/api/...` with the same authentication as the pages; listing MetricViews and Actions goes through `<envUrl>/api/data-query/...`.

## Configure the Ontomato URL

The script reads `application.yml` beside itself as simple `key: value` lines. Set `envUrl` to the frontend base URL (including a deployment proxy prefix when needed), without `/api` or a browser `#` route:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`. This is the public-edition client: it sends no enterprise login credentials and has no `login` command.

## Commands

```
node ontomato.mjs agent list
node ontomato.mjs agent get <id>
node ontomato.mjs agent save @agent.json
node ontomato.mjs agent delete <id>
node ontomato.mjs metric-views
node ontomato.mjs actions
node ontomato.mjs skills
node ontomato.mjs mcp list
node ontomato.mjs mcp tools <name>
node ontomato.mjs mcp save @mcp.json
node ontomato.mjs mcp delete <name>
```

| Command | Interface | Effect |
| --- | --- | --- |
| `agent list` | `GET /api/analysis-agents` | Agents of the domain: `id`, name, whether regular, whether enabled |
| `agent get` | `GET /api/analysis-agents/<id>` | The full definition |
| `agent save` | with `id`: `PUT /api/analysis-agents/<id>`; without: `POST /api/analysis-agents` | Create or change; only definition fields are sent, read-back fields such as `id` and timestamps are not |
| `agent delete` | `DELETE /api/analysis-agents/<id>` | Delete the agent |
| `metric-views` | `POST /api/data-query/metricView/queryList` | Published MetricViews: `id`, name, read-only or not, parameter names |
| `actions` | `POST /api/data-query/action/queryList` | Published Actions: `id`, name, parameter names |
| `skills` | `GET /api/skills` | Selectable skills: `id`, category (`analysis` or `visualization`), title, with disabled ones marked |
| `mcp list` | `GET /api/mcp/services` | External MCP services: name, URL and header names (header values are not printed) |
| `mcp tools` | `GET /api/mcp/services/<name>/tools` | Connects to the service and lists its tools, confirming the connection works |
| `mcp save` | existing name: `PUT /api/mcp/services/<name>`; otherwise `POST /api/mcp/services` | Create or change a service |
| `mcp delete` | `DELETE /api/mcp/services/<name>` | Delete a service |

A failure prints the HTTP status and reason and exits non-zero.

## Agent definition

To change an agent, `agent get` and keep its current definition, change the fields in that JSON and `agent save` it; untouched fields stay as they were. Common fields:

| Field | Meaning |
| --- | --- |
| `name`, `description` | Name and one-line summary shown in the agent list |
| `executionMode` | `loop`. `dimension` is the old dimension orchestration; do not use it for new agents |
| `reportDeliverableEnabled` | `false` for a regular agent that answers turn by turn; `true` for a report agent that produces analysis reports |
| `loopPrompt` | The agent's own prompt: role, which capability to use for which question, answer format |
| `enabledMetricViewIds` | The agent's query tools: MetricView `id`s it may execute directly (read-only Functions, `readOnly: true` in `metric-views`), knowledge search included; available in every run |
| `enabledActionIds` | The agent's write operations: Action `id`s (write Functions) it may execute; offered in regular conversations only, and the agent lists the parameters and waits for the user's confirmation first |
| `enabledMcpServiceNames` | External MCP services it may call |
| `enabledSkillIds`, `enabledVisualizationSkillIds` | Analysis and chart skill `id`s |
| `classNames` | Classes its queries may access; empty means unrestricted |
| `isEnabled`, `sortOrder` | Enabled or not, list order |

A selected MetricView, Action or MCP service that is later deleted or unpublished keeps its ID in the definition; runs ignore it and the page shows it as unavailable.

## Prompt for knowledge Q&A plus data questions

When one agent both searches knowledge and answers data questions, select the retrieval MetricView (see "Retrieval Function" in `ontomato-app-builder`) on a regular agent; data queries stay available. The prompt sets the routing, the speed and the citations, for example:

```markdown
You are the ××× knowledge assistant. Answer quickly and accurately, with sources.

- Knowledge questions about documents, rules, clauses or events: run "××× search" directly with `execute_metric_view`, writing query as one complete sentence and top_k as 8. Search once; only if the results are clearly off, rephrase and search one more time.
- Statistics, counts, rankings and comparisons: use `collect_evidence`, stating the whole question at once.
- When a question needs both, call both tools in the same round.
- Give the conclusion first, then 2 to 5 sources, each with its title or section and the link as a Markdown link `[source](source)` rather than a bare URL. If the results hold no support, say so instead of inventing one.
- Do not write a report or draw a chart unless asked.
```

A complete example from modeling, loading data and the retrieval MetricView to the agent definition and verification is in [references/knowledge-and-data-agent.md](references/knowledge-and-data-agent.md).

`execute_metric_view`, `collect_evidence` and `execute_action` are fixed tool names of the agent runtime. The MetricViews' names, descriptions and parameters go into the prompt automatically; `loopPrompt` only needs to say when to use which.

## External MCP services

JSON for `mcp save`:

```json
{"name": "crm", "url": "https://mcp.example.com/mcp", "headers": {"Authorization": "Bearer ..."}}
```

`url` must be an http(s) address; `headers` are sent with each call and may be omitted. Names are unique within the domain and agents refer to services by name. After saving, run `mcp tools <name>` to confirm it connects and lists tools, then add the name to an agent's `enabledMcpServiceNames`. Header credentials are stored by the server; `mcp list` shows header names only.

## Verify

After saving, `agent get` and confirm every selected ID is there. Then ask a real question: talk to the agent in the page, or use the analysis-agent MCP (`run_analysis`) described in `ontomato-analyst`, and check in the run's activities that it called the expected MetricView or data query and answered as the prompt says. A successful save does not show that the agent will use these capabilities as intended.
