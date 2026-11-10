---
name: ontomato-ontomap-builder
description: "Ontomato ontology and data: connect a data source, build and maintain the ontomap, its mappings and business knowledge; write business data into the business database (PostgreSQL, MySQL), batch-import vector resources and load test data, and verify with questions. Not for MetricViews, Actions, applications or agent configuration, nor adapter development."
---

# Ontomato ontology and data

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

Maintain the ontology of one business data source and the data in it: connect a supported source, create or adapt its ontomap, maintain business knowledge; create tables and import business data in the business database, batch-import vector resources, load test data, and check the result with questions. Every write of data into the ontology happens in this package. Ontology operations go through the deployed Ontomato APIs; the business database is written directly through a configured database command. It does not migrate resource bindings or whole databases.

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

To write the business database directly with `db-sql` and `db-import`, add two settings:

```yaml
# Business database for db-sql and db-import: postgresql or mysql
databaseType: postgresql
# JSON argv of a client that reads SQL from stdin; put the password in PGPASSWORD or MYSQL_PWD, not here
databaseCommand: ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "db-host", "-U", "user", "-d", "business"]
```

`databaseCommand` is the argv array of a client that reads SQL from standard input; the script runs it as is, without a shell. It can be a local `psql`/`mysql`, or `ssh` or `docker exec -i` followed by the client. psql needs `-v ON_ERROR_STOP=1`, otherwise it keeps going after an error. Keep the password in `PGPASSWORD`, `MYSQL_PWD` or the client's own credential file, never in `application.yml`. It connects to the business database the ontology maps, not to Ontomato's own metadata database.

## Choose the ontology task

Start with the authorized deployment/context and the business purpose. Read `list-datasources` and `get-ontomap` before changing an existing configuration. Connection success establishes access, not a correct model or complete data migration.

| Task | Use the existing capabilities this way | Completion evidence |
| --- | --- | --- |
| Create an ontomap | Test the connection. Use an available read-only database client to inspect actual tables/indices, columns, types, keys and representative relationship pairs. Prepare the definition, select the source with `use-datasource`, then save it with `set-ontomap`. | Read it back with `get-ontomap`; ask bounded questions that exercise the relevant objects and relationships. |
| Maintain an existing ontomap | Save the current `get-ontomap` result, edit that object and carry back unrelated definitions, descriptions and returned fields unchanged. Resolve new or renamed mappings from the source. | The intended difference is present and unrelated meaning remains. A request to rename or adapt a mapping is not an instruction to remove its relationships. |
| Change the data source | Test and inspect the target first. Prepare a compatible ontomap and resolve each existing relationship and resource binding before switching. Then call `use-datasource` and `set-ontomap`, and read back/test the result. | Definitions match the actual target; cross-object questions and relevant resources work. These are separate writes, not an atomic migration. If one fails, read actual state before retrying or restoring the affected configuration. |
| Maintain business knowledge | Read current entries, then save the requested additions/edits or delete the identified entry. | Read back IDs, content and review status; metadata changes alone do not prove a business answer is correct. |
| Load business data | Run DDL with `db-sql`, then `db-import` a CSV per table; `set-ontomap` when the definition must cover new tables. | Row counts and keys in the business database match the files; `ask` finds the imported objects and relationships. |
| Batch-import text resources | Once objects exist and the `vector` attribute is declared, `upload-vectors` a JSONL file; use `upload-vector` for one resource or an original file and `delete-vector` to remove one. | The failure list is empty or handled; spot checks retrieve and download. |
| Load test data | In a test environment or test domain, `import-test-data` a zip. | Read objects and resources back; it clears the classes it covers and is not for real data. |
| Deploy a book hand-off package | Apply its `ddl.sql`, `import/<class>.csv`, `ontomap.draft.json` and `upload-manifest.jsonl` with `db-sql`, `db-import`, `set-ontomap` and `upload-vectors`. | Re-check model, records and evidence resources as the package's `import-map.md` lists. |

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
node ontomato.mjs db-sql @ddl.sql
node ontomato.mjs db-import public.paragraph @paragraph.csv
node ontomato.mjs import-test-data test-data.zip
node ontomato.mjs upload-vector @vector.json
node ontomato.mjs upload-vectors resources.jsonl
node ontomato.mjs delete-vector <class> <attribute> <objectId> <path>
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
| `db-sql` | `sql executed` or the client's error | Runs the given SQL (tables, columns, data fixes) in one transaction directly in the business database; nothing is committed on error. |
| `db-import` | Progress per batch | Reads a CSV (first row: column names) and inserts it in batches (500 rows by default), each in a transaction; stops at a failing batch, earlier batches stay committed, resume with `--from <rows imported>`. |
| `import-test-data` | `test data imported` | Uploads a test-data zip: clears every class in the file and its vector resources, then writes; test environments or test domains only. |
| `upload-vector` | The new resource, including `path` | Adds one resource and appends a reference to the object's vector field. Check an uncertain result before appending again. |
| `upload-vectors` | Progress and failures per batch | Adds text resources from JSONL in batches (100 lines by default), each line on its own; failed lines go to `<file>.failed.jsonl`; a failed request stops with a `--from` hint. |
| `delete-vector` | `vector deleted` | Deletes one resource and the object's reference to it. |
| `ask` | Session/events and result data | Runs a question against the current context; it is not an ontomap editor or a dataset export. |

The commands below document their current API paths. Legacy API names containing `Schema` do not change the product concept: the complete semantic definition is the ontomap.

`type` is one of the types `list-datasources` prints.

`ask` sends `Accept-Language`. The default is `en`.

## Write the business database

The ontology maps real tables in the business database. Loading data means writing those tables:

1. **Create tables or columns** with `db-sql @ddl.sql`, written in the dialect of `databaseType`; the whole script runs in one transaction. Confirm authorization before changing an existing table.
2. **Import rows** with `db-import <table> @<file>.csv`. The first row holds column names, which must match the table. An unquoted empty field becomes NULL and `""` an empty string; values are written as string literals that the database converts to the column type. Import only inserts: it never clears or overwrites, and a primary-key conflict fails that batch.
3. **Align the definition**: for new tables or columns, add the classes or attributes to the `get-ontomap` result and `set-ontomap` it. Each class needs exactly one enabled varchar primary-key attribute, and that column must be non-null and unique in the table.
4. **Verify** row counts and keys with the database client, then `ask` a question that touches the new data.

Only PostgreSQL and MySQL are supported. For other databases, prepare the same DDL and CSV, let the implementer load them with that database's own tools, then continue with steps 3 and 4.

## Text resources and object identity

The resource file and embedding belong to Ontomato; the object's vector field stores references shaped as `[{"path":"...","text":"..."}]`. Retrieval is scoped by domain/context, class name and attribute name; each resource also refers to an object key. The object must already exist and the attribute must be declared `vector`; preserve the exact primary-key value.

**Batch import** with `upload-vectors <file>.jsonl`, one resource per line:

```json
{"className":"paragraph","attrName":"content","objectId":"p1","text":"Chapter 3 Procurement | 3.2 Tendering | …body…"}
```

`text` is both what is embedded and what a search returns to the user. **Carry context into each chunk**: with the body alone, the title, document number, person or chapter a question names often cannot be found. A common form joins the document title, section or number, date and body, such as `title | section | body`. Split along the content so that one chunk covers one point.

A request carries 100 lines by default; embeddings are requested ten at a time and each line succeeds or fails on its own. Failed lines go to `<file>.failed.jsonl` (line, object, reason) and can be re-imported alone once fixed. When a whole request fails the script stops and prints `--from`; check which lines of that batch were stored before resuming, because a repeated import appends new resources instead of replacing old ones.

**One resource, or one with its original file,** with `upload-vector @vector.json`:

```json
{"className":"paragraph","attrName":"content","objectId":"p1","text":"The paragraph text…","file":"./p1.pdf"}
```

With `file`, the original file is stored as the resource and its extension becomes the suffix; `text` is still what is embedded, and the backend extracts nothing from the file. Without `file`, `text` is stored as a `.txt` resource. Delete with `delete-vector <class> <attribute> <objectId> <path>`, taking `path` from the object's vector field.

Changing class names, attribute names or keys requires explicit handling of existing bindings. `set-ontomap` and `use-datasource` do not perform that migration. If only the database connection changes, preserving names/keys and the reference values is a prerequisite, not proof that resources still work: check retrieval and a download before claiming completion.

`upload-vector` and `upload-vectors` call `POST /api/data-query/vectorResource/upload` (a multipart form; a batch sends only the `items` field, an array of `{content, className, attrName, objectId}`); `delete-vector` calls `/vectorResource/delete`. The production side of a two-environment deployment offers no resource upload or delete; prepare resources in the test environment.

Vector attachment needs a data adapter that can read the target object and write its reference field. The included implementations provide that path for PostgreSQL, MySQL, SQL Server, DuckDB, Neo4j, Elasticsearch and OpenSearch; GaussDB reports unsupported writes. Installed types come from `list-datasources`; connection success does not establish write authorization or deployment-version support. Treat an unsupported-operation error as a capability boundary, not a reason to write vector storage directly.

## Test data

In a test environment or test domain, `import-test-data <file>.zip` loads objects, relationships and vector resources in one go. The zip holds:

```
- data.json          object and relationship data
- files/             files referenced by vector attributes
```

```json
{
  "objDatas": [
    {"className": "/namespace/class1", "rows": [{"id": "c1", "attr1": "East", "photo": [{"path": "files/c1.jpg", "text": "A bright ward"}]}]}
  ],
  "relDatas": [
    {"relationName": "relationship type", "sourceObjId": "source primary key", "targetObjId": "target primary key"}
  ]
}
```

- `className` must be an existing class; each row holds only enabled attributes of that class and a non-empty primary-key value unique across the whole file.
- `relationName` must be an existing relationship type whose two ends are rows of the matching classes in this file.
- A `vector` attribute holds an array of `{"path","text"}`: `path` points to an existing non-empty file under `files/` with a 1–16 character alphanumeric extension, and `text` is non-empty and is what is embedded (the caller supplies any audio/video transcript).
- Every class that appears in the file is **cleared first**, objects and vector resources alike; other classes are untouched. If writing fails halfway, what was cleared or written stays; fix the cause and import again.

`import-test-data` calls `POST /api/data-query/testEnv/importData`. It is for tests only; load real data as described in "Write the business database".

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

`ask` posts `{question}` to `/api/data-query/abcHarness`. The response is `text/event-stream`. The script prints each event as the stream delivers it:

- the opening `{sessionId, nodeId}` frame as `session <id>`
- `MESSAGE_TYPE` text
- `DATA_TYPE` as the question plus the data JSON
- an `error` frame to stderr, then a non-zero exit

Heartbeat comments are not printed.

`ask` often takes several minutes. Set the command timeout long enough for the whole run.
