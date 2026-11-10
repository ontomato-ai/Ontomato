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

The skills cover different tasks on this same platform: `ontomato-ontomap-builder` maintains the ontology and its data (definitions, mappings, business data and resources); `ontomato-app-builder` builds MetricViews, Actions and applications on it; `ontomato-agent-builder` configures agents and MCP services; `ontomato-analyst` queries and analyzes. Adapter development and enterprise permission management support this platform at their own boundaries. These names explain the roles, not dependencies on other installed skills. Keep this package's files together; its local references travel with it.

## This skill’s role

Answer business questions using the current ontology and its permitted data. This package reads definitions and queries data; it does not change the data source, ontomap, permissions or business records. It needs no product checkout. Choose `ask` for a natural-language question, `execute-dsl` when you need to control the query, or the separately configured analysis MCP service for a report.

## Prerequisites

- Ontomato is deployed and an ontomap is imported.
- You have the frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every script call goes through the frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

The script reads `application.yml` beside itself as simple `key: value` lines. Use unquoted values and full-line comments. Use the frontend base URL (including a deployment proxy prefix when needed), without `/api/data-query` or a browser `#` route. Keep the configuration private, especially enterprise credentials.

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, without an API path or browser route:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

This is the public-edition client: it sends no enterprise login credentials and has no `login` command. An authenticated enterprise deployment needs the matching enterprise package and authorized identity.

## Commands

Run `node ontomato.mjs <command>` from this directory, or pass the script path. JSON may be an argument or `@file`.

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <class> [<class> ...]
node ontomato.mjs relationships <class> [<class> ...]
node ontomato.mjs distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs ask [--lang <tag>] "How many orders were placed last month?"
```

| Command | Backend call | Returns |
| --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | Business description of the whole dataset |
| `classes` | `GET /admin/getAllClassNames` | Class names |
| `schema` | `POST /admin/getSchemaByClassName` | Per class: description, then each enabled attribute's name, type, primary-key flag and description |
| `relationships` | `POST /admin/getRelationshipByClassNames` | Relationships that start or end at the classes: source class, relationship type, target class, description |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | Distinct values of a `varchar` or `text` attribute |
| `execute-dsl` | `POST /dsl/executeV1` | DSL result JSON |
| `ask` | `POST /abcHarness` | Streamed events, then the data |

`distinct-values`: `--like` filters values; without `%` the pattern is wrapped as `%pattern%`. Without `--limit` at most 100 values are shown. Use it to find the exact stored value before writing an `=` or `in` condition.

A non-2xx response prints the status and body and exits non-zero. A JSON body with `success: false` prints its message and exits non-zero.

## Query workflow

Translate the business question into ontology objects, attributes and relationships. `schema` returns class fields and `relationships` returns relationship definitions, not object records. DSL names such as `graph` and `relationship` describe a query graph; they do not require a graph database. A SQL adapter uses the saved JOIN fields.

1. `dataset-desc` and `classes` to see what the dataset covers.
2. `schema` for the classes the question needs, and `relationships` for how they join. If an attribute has type `vector`, it represents a set of file or text resources attached to the object, queried by semantics and cannot be used for equality or range comparisons.
3. `distinct-values` to confirm filter values.
4. Write a DSL query following the rules below and run `execute-dsl`.
5. If the result is empty or wrong, check class and attribute names, filter values and relationship direction, then run again.

For a question you do not want to plan yourself, use `ask`. It often takes several minutes; set the command timeout long enough for the whole run.

## Use DSL and interpret results

When writing or debugging a DSL query, read this package’s [DSL reference and complete examples](references/dsl.md), then run `execute-dsl`. Direct `ask` does not require writing DSL first. Report a missing relationship/field as an ontology gap; do not invent mappings from database intuition or change permissions to obtain a result.

Interpret each result group’s `answer` as data and `mqls` as executed statements; `error` indicates failure. Honor `truncated`, `rowLimit` or a truncation hint when returned. An empty result means no match under these conditions and permissions, not automatically absence of a business object. Give the user a business answer, its scope and known limits rather than require them to interpret DSL or raw JSON.

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
