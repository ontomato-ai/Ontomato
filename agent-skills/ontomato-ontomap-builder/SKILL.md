---
name: ontomato-ontomap-builder
description: "Build and maintain Ontomato ontology definitions and their data mappings, business knowledge and text resources; connect a supported data source and verify the ontology with questions. Use for new or existing ontomaps and data-source changes, not database migration or adapter development."
---

# Ontomap builder

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

Maintain the ontology of one business data source: connect a supported source, create or adapt its ontomap, maintain business knowledge, attach text resources and check the result with questions. This package works through deployed APIs; it needs no product checkout. Database structure inspection or changes require separately available, authorized database tools. It does not export/import business datasets or migrate resource bindings.

## Prerequisites

- Ontomato is already deployed.
- You have the frontend base URL, such as `http://host:3000`.
- Node.js 18 or newer. The script uses only Node built-ins.

Every call goes through the frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

The script reads `application.yml` beside itself as simple `key: value` lines. Use unquoted values and full-line comments. Use the frontend base URL (including a deployment proxy prefix when needed), without `/api/data-query` or a browser `#` route. Keep the configuration private, especially enterprise credentials.

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, without an API path or browser route:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

## Choose the ontology task

Start with the authorized deployment/context and the business purpose. Read `list-datasources` and `get-ontomap` before changing an existing configuration. Connection success establishes access, not a correct model or complete data migration.

| Task | Use the existing capabilities this way | Completion evidence |
| --- | --- | --- |
| Create an ontomap | Test the connection. Use an available read-only database client to inspect actual tables/indices, columns, types, keys and representative relationship pairs. Prepare the definition, select the source with `use-datasource`, then save it with `set-ontomap`. | Read it back with `get-ontomap`; ask bounded questions that exercise the relevant objects and relationships. |
| Maintain an existing ontomap | Save the current `get-ontomap` result, edit that object and carry back unrelated definitions, descriptions and returned fields unchanged. Resolve new or renamed mappings from the source. | The intended difference is present and unrelated meaning remains. A request to rename or adapt a mapping is not an instruction to remove its relationships. |
| Change the data source | Test and inspect the target first. Prepare a compatible ontomap and resolve each existing relationship and resource binding before switching. Then call `use-datasource` and `set-ontomap`, and read back/test the result. | Definitions match the actual target; cross-object questions and relevant resources work. These are separate writes, not an atomic migration. If one fails, read actual state before retrying or restoring the affected configuration. |
| Maintain business knowledge | Read current entries, then save the requested additions/edits or delete the identified entry. | Read back IDs, content and review status; metadata changes alone do not prove a business answer is correct. |
| Attach text to an object | Use `upload-vector` for an existing object and a declared `vector` attribute. | Query that object/resource through `ask` or an authorized data reader; the success message alone does not identify the created resource. |

If a required relationship, resource or permission reference cannot yet be preserved with the available tools, keep the current connection and ontomap active. Prepare the target definition and explain the missing access or capability. Resolve those dependencies before switching; do not switch first and plan repairs later, or turn a requirement such as keeping photos usable into deferred work.

For relational relationships, use the observed columns and values to establish `fromField` and `toField`, including direction and multiplicity. Missing connection keys are a data-preparation gap, not a reason to delete the business relationship or join on a display name. Database changes require a suitable tool and authorization for that work; this skill has no column-creation or dataset-migration command. Explain an unresolved mapping in business terms and identify the access or preparation needed.

For a whole-definition replacement, obtain any business decision that is still missing before removing classes, attributes or relationships; do not ask again when the user has already explicitly authorized that exact change. Configure and prepare only the task's scope. If the available tools cannot inspect a needed technical fact, state the missing prerequisite rather than ask the user to guess it or fall back to product-source assumptions.

This is the public-edition client: it sends no enterprise login credentials and has no `login` command. An authenticated enterprise deployment needs the matching enterprise package and authorized identity.

## Commands

Run `node ontomato.mjs <command>` from this directory, or pass the script path. JSON may be an argument or `@file`.

```
node ontomato.mjs list-datasources
node ontomato.mjs test-datasource <type> '<json>'
node ontomato.mjs test-datasource <type> @payload.json
node ontomato.mjs use-datasource <type> '<json>'
node ontomato.mjs use-datasource <type> @payload.json
node ontomato.mjs get-ontomap
node ontomato.mjs set-ontomap '<json>'
node ontomato.mjs set-ontomap @ontomap.json
node ontomato.mjs get-knowledge
node ontomato.mjs save-knowledge @knowledge.json
node ontomato.mjs delete-knowledge <id>
node ontomato.mjs upload-vector @vector.json
node ontomato.mjs ask "How many people are there?"
node ontomato.mjs ask --lang en "How many people are there?"
```

## Command results and write scope

| Command | Observable result | Effect |
| --- | --- | --- |
| `list-datasources` | `currentType` and installed adapter metadata | Read only; `requiresJoinFields` says whether relationships require explicit join columns. |
| `test-datasource` | Connection/catalog or search-index report | Does not select a source, save a connection, migrate data or validate every read/write capability. |
| `use-datasource` | `datasource set` | Saves this adapter type's connection and selects it. Existing ontomap, knowledge, resources and permissions are not migrated; saved connections of other types remain. This command configures one source, not a multi-source definition. |
| `get-ontomap` | Complete ontomap JSON | Reads definitions, not object records. |
| `set-ontomap` | `ontomap saved` | Replaces the complete definition and validates the primary-key contract. It does not create/alter business tables or migrate objects, permissions or resources. Read back the result. |
| `get-knowledge` | Entry array | Read only; use returned `knowledgeID` values to identify later edits/deletions. |
| `save-knowledge`, `delete-knowledge` | Per-entry success message or failure | Writes knowledge; array saves stop at the first failure and retain earlier successes. |
| `upload-vector` | `vector uploaded` or failure | Adds a resource and appends a reference to the object's vector field in the business data source. The CLI does not print the returned resource ID/path. An uncertain result is not grounds to append again. |
| `ask` | Session/events and result data | Runs a question against the current context; it is not an ontomap editor or a dataset export. |

The commands below document their current API paths. Legacy API names containing `Schema` do not change the product concept: the complete semantic definition is the ontomap.

`type` is one of the types `list-datasources` prints.

`ask` sends `Accept-Language`. The default is `en`.

## Text resources and object identity

`upload-vector @vector.json` uploads **text only**. The script turns `text` into the bytes of a file and uses the same text for embedding; `suffix` only changes its filename extension, not its format. Keep `suffix: "txt"` for this command. It cannot upload an existing image or PDF; setting `suffix: "jpg"` or `"pdf"` does not convert text into that file type.

The object must already exist and the attribute must be declared `vector`. For a new object its reference list can start as `[]`; do not clear an existing list before an append. Preserve the exact object primary-key value. The payload is:

```json
{"className":"paragraph","attrName":"content","objectId":"p1","text":"The paragraph text…","suffix":"txt"}
```

The resource file and embedding belong to Ontomato; the business field stores references shaped as `[{"path":"...","text":"..."}]`. Retrieval is scoped by domain/context, class name and attribute name; each resource also refers to an object key. Changing those names or keys requires explicit handling of existing bindings. `set-ontomap` and `use-datasource` do not perform that migration. If only the database connection changes, preserving names/keys and the reference values is a prerequisite, not proof that resources still work: check retrieval and a download before claiming completion.

This package has no commands to migrate, delete or rebuild resources and no original-file upload flag. Use only an already available, authorized resource tool for such work; otherwise explain the capability gap. Repeated uploads append new resources rather than replacing old ones. `get-ontomap` cannot verify resource contents because it only returns definitions.

Vector attachment needs a data adapter that can read the target object and write its reference field. The included implementations provide that path for PostgreSQL, MySQL, SQL Server, DuckDB, Neo4j, Elasticsearch and OpenSearch; GaussDB reports unsupported writes. Installed types come from `list-datasources`; connection success does not establish write authorization or deployment-version support. Treat an unsupported-operation error as a capability boundary, not a reason to write vector storage directly.

A non-2xx response or JSON `success: false` is a failure and exits non-zero. A success message does not replace read-back or verification of the business result.

## Business knowledge

`get-knowledge` entries include `knowledgeID`, `knowledgeTitle`, `knowledgeText`, `knowledgeTags` and `status`. Keep the returned ID for edits/deletions; a title alone is not an identity.

Read the supplied business material and organize definitions, calculation rules, conditions and exceptions into knowledge entries. Use `get-knowledge` to inspect existing entries, `save-knowledge` to save them, then `get-knowledge` to verify the result.

`get-knowledge` returns an array of the current domain's entries, including pending entries and their IDs. `save-knowledge` accepts one JSON object or an array:

```json
{
  "knowledgeTitle": "Revenue",
  "knowledgeText": "Revenue includes paid orders and excludes refunded amounts.",
  "knowledgeTags": ["Business"],
  "status": 0
}
```

Specify `status`: `0` is pending review, `1` is approved and available for question retrieval. Keep unconfirmed extracted content pending; use approved status for confirmed knowledge. The backend computes the embedding when saving.

Omit `knowledgeID` or leave it empty to add. To edit, include an existing ID from `get-knowledge` and all entry fields; saving replaces the entry's content, tags and status. Repeating an entry without an ID creates another entry. A missing or foreign-domain edit/delete ID is refused.

Arrays are saved in order. The script prints each successful entry's title and stops with a non-zero exit on the first failure; earlier saves remain. `delete-knowledge <id>` deletes one entry. These commands use the same management APIs and knowledge as the Ontology Manager.

## Connect a datasource

1. `node ontomato.mjs list-datasources` — `GET /api/data-query/businessConfig/dataAdapters`. Prints `currentType` (the adapter this domain uses now) and `adapters`, the adapters installed in this deployment. Each entry has `type`, `label`, `requiresJoinFields`, `fields` (the connection fields the type needs) and `examples` (a sample value per field); saved connections are not shown.
2. `node ontomato.mjs test-datasource <type> '<json>'` — `POST /api/data-query/businessConfig/testDataAdapter`. Same arguments and body as `use-datasource`, but nothing is saved and the domain's datasource does not change. On success it prints the connection report told apart by `kind`. For catalog sources (`kind: "catalog"`: JDBC, Neo4j), it prints `elapsedMs`, `databaseProduct`, `databaseVersion`, `driverName`, `driverVersion`, `catalog`, `schema` and `tables` (`name` and `type`, `TABLE` or `VIEW`, of the schema the connection landed in). For search engines (`kind: "search"`: `elasticsearch`, `opensearch`), it prints `elapsedMs`, `databaseProduct`, `databaseVersion`, `clusterName` and `indices` (visible, queryable open indices). For catalog sources those table names are what class `name` must resolve to; for search engines the class `name` derives the index (see the class `name` rule below). A connection that lands in no schema (for example a PostgreSQL `currentSchema` that does not exist) fails, as does a DuckDB file that does not exist; the test does not create the file. The connection test gives up after 15 seconds.
3. `node ontomato.mjs use-datasource <type> '{"url":"jdbc:postgresql://db.example:5432/my_database?currentSchema=public","user":"app","password":"change-me"}'` — `POST /api/data-query/businessConfig/useDataAdapter`. The script merges `type` into the JSON and posts it. Send the fields listed in that type's `fields`; usually `url`, `user`, `password`.

Which types are actually available depends on the deployment. `list-datasources` is authoritative.

## Connection notes per database

Do not put regional JDBC parameters such as `serverTimezone=Asia/Shanghai` in the URL.

| Type | Notes |
| --- | --- |
| mysql | Accepts URL parameters such as `useUnicode=true&characterEncoding=utf8&useSSL=false`, e.g. `jdbc:mysql://db.example:3306/my_database?useUnicode=true&characterEncoding=utf8&useSSL=false`. |
| postgresql | Select the schema in the URL with `currentSchema`, e.g. `jdbc:postgresql://db.example:5432/my_database?currentSchema=public`. |
| sqlserver | Select the database in the URL with `databaseName`, e.g. `jdbc:sqlserver://db.example:1433;databaseName=my_database`. |
| gaussdb | Scheme `jdbc:opengauss://`, e.g. `jdbc:opengauss://db.example:5432/my_database`. |
| duckdb | The URL is a file path the backend can access, e.g. `jdbc:duckdb:/data/warehouse.duckdb`; `fields` is `url` only. |
| neo4j | Bolt URI plus `user` and `password`, e.g. `bolt://db.example:7687`; queries run against the server's default database. |
| elasticsearch | HTTP URL plus optional `user` and `password` for Basic authentication, e.g. `http://host:9200`. |
| opensearch | HTTP URL plus optional `user` and `password` for Basic authentication, e.g. `https://host:9200`. Point-in-time (PIT) requires OpenSearch 2.4+. The declared object primary key must be unique and map to a sortable `keyword` field or `.keyword` subfield. |

## Ontomap

`get-ontomap` is `GET /api/data-query/admin/getSchema`. `set-ontomap` is `POST /api/data-query/admin/setSchema`. The body is the ontomap object itself.

`set-ontomap` replaces the whole ontomap of the domain. It does not merge with the previous one.

| Field | What to write |
| --- | --- |
| `datasetDesc` | Business description of the whole dataset. It is inserted into the abcHarness programmer prompt and the question-splitter prompt. Write the business meaning, units, and enumeration values in the language the model should use. |
| `classList` | Class names. The star-chart cut uses the first name as the root class. |
| class `name` | SQL table name, or the index name for Elasticsearch/OpenSearch. A name matches a class only as an exact string; a leading `/` is accepted only when the stored name has none. Relational adapters paste it unchanged and unquoted into `from` and `join`, add no schema prefix and change no case; put the schema in the JDBC URL, such as PostgreSQL `currentSchema`. Elasticsearch/OpenSearch derive the physical index from it: trimmed, lower-cased, each `/` and every character outside `a-z0-9_-` becomes `_`, and a leading `-`, `_`, `+` or `.` gets an `i` prefix, so an existing index is reachable only when its name already equals that derived form. |
| class `showName` | Display label. The question-split subgraph shows this instead of the class name. It is not the SQL name and not the class description in the prompt. |
| class `desc` | Class description in the prompt. The programmer's class list and `getSchemaByClassName` both show it. Write the business meaning, units, and enumeration values. |
| `inStarChart` | `true` includes the class in the star chart. A relationship is kept only when both classes are `true`. Use `true`. |
| attr `name` | SQL column name, or document field name for Elasticsearch/OpenSearch. Relational adapters paste it unchanged and unquoted (`alias.column`); search requests use it as the document field name. Same exact-match rule as the class name. |
| attr `showName` | Saved on the ontomap and returned by `get-ontomap`. The schema text and SQL use `name` and `desc`. |
| attr `desc` | Field description the model reads. `getSchemaByClassName` and the question-splitter schema put it in the "field description" column. Write the business meaning, units, and enumeration values. |
| `type` | One of `varchar`, `text`, `int`, `long`, `double`, `date`, `timestamp`, `vector`, chosen for the actual mapping. `vector` denotes object-resource references held as a text array representation in the business field; maintain it through resource operations, not equality/range comparisons. See “Text resources and object identity” for upload scope, supported writes and identity constraints. |
| `bizzKey` | On the DSL question path, `true` adds this column to the result when the query left it out. The SQL built for `ask` does not read this flag. Use `true` for columns that path should keep, and `false` otherwise. |
| `enable` | `true` includes the column in the schema text and in SQL. `false` omits it. A missing value counts as enabled. Use `true`. |
| `primaryKey` | Exactly one `true` per class, with `enable: true` and `type: varchar`; otherwise saving fails. The label does not convert stored data. Resolve a non-text source key with the authorized data tools before assuming a compatible mapping; changing only the label is not proof. |
| relationship key | Relationship type name: the machine name a join and the DSL look the relationship up by, and the content of the "relationship type" column of the prompt table. Keep it short, stable and identifier-like (letters, digits, `_`). It is what the model copies into the DSL; the meaning it reads is the `desc`, not the key. |
| `fromClass`, `toClass` | Class `name` of the two ends. The direction runs from `fromClass` to `toClass` and is part of the meaning; the prompt asks the model to check it. |
| `fromField` | A real join field on `fromClass`. Required when `list-datasources` returns `requiresJoinFields: true`: the adapter needs an explicit column pair to implement the relationship, not removal of the business relationship. |
| `toField` | A real join field on `toClass`; the condition is `fromClass.fromField = toClass.toField`. Verify the pair, direction and multiplicity. Graph adapters with `requiresJoinFields: false` use the corresponding stored relationship edges. |
| relationship `desc` | Relationship description, the "relationship description" column of the prompt table. Write it as a predicate, the verb phrase that holds from `fromClass` to `toClass`: `belongs to`, `is located in`, `contains`, `is parent of`. See "Write relationship descriptions as predicates" below. |

## Write relationship descriptions as predicates

A relationship tells the model three things: which two classes, which direction, and what the link means. The key carries the first two as a name; the `desc` carries the meaning, and the prompt shows it in the "relationship description" column next to the key. Write it as a **predicate** — the verb phrase that holds from `fromClass` to `toClass`, not a noun phrase naming the two ends:

| Write (predicate) | Do not write (noun phrase) |
| --- | --- |
| `belongs to` | `employee and department` |
| `is located in` | `company city relation` |
| `contains` | `order items` |
| `is parent of` | `parent child` |
| `is managed by` | `manager` |

- Read it from `fromClass` to `toClass`. `emp --belongs to--> dept` is right; the same two tables related the other way need `dept --has--> emp`. A relation that reads naturally in both directions is usually a sign the direction is undecided; pick the direction the questions use.
- A self-relationship has both ends on the same class, so the predicate is the only thing that separates the two directions: `is managed by`, `reports to`, `is part of`.
- When two relationships connect the same pair of classes, the predicate is what keeps them apart: `is project manager of` and `is a member of` on the same staff-to-project pair.
- Write it in the language the model should answer in. In a Chinese deployment that means `属于`, `位于`, `包含`, `是…的上级`; the predicate stays a word or short phrase, not a sentence.
- This rule is for relationship `desc` only. `datasetDesc`, class `desc` and attr `desc` stay business descriptions — nouns, units and enumerations.

Why it matters: the question splitter and the programmer match the user's wording against the relationship definitions. A predicate is the phrase the user actually types ("which city is the company located in"), so it is matched directly; a noun phrase names the pair but leaves the direction and the meaning to be guessed.

```json
{
  "datasetDesc": "Employees and departments",
  "classList": ["dept", "emp"],
  "classDefs": [
    {
      "name": "dept",
      "showName": "Department",
      "desc": "A department",
      "inStarChart": true,
      "attrs": [
        {
          "name": "id",
          "showName": "ID",
          "desc": "Department id",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": true
        },
        {
          "name": "name",
          "showName": "Name",
          "desc": "Department name",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": false
        }
      ]
    },
    {
      "name": "emp",
      "showName": "Employee",
      "desc": "An employee",
      "inStarChart": true,
      "attrs": [
        {
          "name": "id",
          "showName": "ID",
          "desc": "Employee id",
          "type": "varchar",
          "bizzKey": true,
          "enable": true,
          "primaryKey": true
        },
        {
          "name": "dept_id",
          "showName": "Department",
          "desc": "Department id",
          "type": "varchar",
          "bizzKey": false,
          "enable": true,
          "primaryKey": false
        },
        {
          "name": "age",
          "showName": "Age",
          "desc": "Age in years",
          "type": "int",
          "bizzKey": false,
          "enable": true,
          "primaryKey": false
        }
      ]
    }
  ],
  "relationshipDefs": {
    "emp_dept": {
      "fromClass": "emp",
      "toClass": "dept",
      "desc": "belongs to",
      "fromField": "dept_id",
      "toField": "id"
    }
  }
}
```

## Natural-language questions

`ask` calls the ontology `/ontology/retrievals`, prints request/retrieval/session IDs,
then polls and returns authorized datasets. Outcomes are `completed`, `needs_input`
or `failed`. Present clarification questions to the user; reply explicitly with
`ask --resume <retrievalId> --answers @answers.json` (questionId plus choiceId or
text). Use `ask --status <retrievalId>` or `ask --cancel <retrievalId>` as needed.
Keep requestId for a response-loss retry with `--request-id`. Failures exit nonzero;
preserve partial-result limits. A run may take several minutes.
