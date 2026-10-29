---
name: ontomato-app-builder
description: "Build applications on an existing Ontomato ontology using MetricViews for queries and Actions for business operations. Use for interface development, authorized test data and resources, application pages and explicit production synchronization in the deployment topology provided."
---

# Ontomato app builder

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

Build an application around the objects and relationships in an existing ontology. Reuse suitable MetricViews and Actions, or define and verify the interfaces the application needs; pages call MetricViews for queries and Actions for business writes. This package works through deployed APIs without the product source. It can write definitions, test data and resources, and execute Actions: the environment and the authorized business effect matter for each operation.

## Two environments

Ontomato deployments come in two shapes. Decide which one you are in before doing anything else:

- **Two-environment (two-env)**: a dedicated test deployment plus a production deployment. Import the production schema and sample its data, build and test interfaces in the test deployment, then sync the interfaces the application uses back to production.
- **Single-environment (single-env)**: one deployment used for both building and serving. There is no production address, no `import-schema`, no `prod-*` commands and no sync step; build and test directly in that deployment. This result identifies deployment topology; it does not authorize clearing data or executing business writes.

Run `env-mode` first. It asks the deployment whether `PRODUCTION_ENV_URL` is set:

| `env-mode` output | Shape | What to do |
| --- | --- | --- |
| `two-env` | Test + production | Follow the full workflow, including `import-schema` and the final `sync-production` |
| `single-env` | One deployment | Skip `import-schema`, `prod-*` and `sync-production`; work directly in `envUrl` |

Do not infer the shape from a failed `import-schema`. The backend also fails it with a clear "Production environment is not configured" message, but `env-mode` is the authoritative, non-destructive check.

### Two-environment details

- **Test environment**: the Ontomato deployment at `envUrl`. This skill imports definitions and test data there, generates and debugs MetricViews and Actions there, and pages call its interfaces.
- **Production environment**: another Ontomato deployment, read only until the final sync. The test environment's backend reaches it through the environment variable `PRODUCTION_ENV_URL` (the production **backend** URL, such as `http://prod-host:18087`). An open-source production deployment needs no login, so leave `PRODUCTION_ENV_USER` and `PRODUCTION_ENV_PASSWORD` empty. `import-schema`, the `prod-*` commands and `sync-production` go through the test backend to production; the script never calls production directly. Production must run the same Ontomato version as the test environment.

**`import-schema` wipes data in the current test domain.** It drops and recreates the current domain's namespace and all its classes and replaces the domain's whole ontomap with the production class and relationship definitions. Run it only against a dedicated test deployment, never against a deployment with business data.

## Prerequisites

- The deployment is running and you have its frontend base URL, such as `http://host:3000`.
- `env-mode` returns `two-env` or `single-env`. For `two-env`, the test backend has `PRODUCTION_ENV_URL` set and has been restarted.
- Node.js 18 or newer. The script uses only Node built-ins.

Every script call goes through the test environment's frontend: `<envUrl>/api/data-query/<backend path>`.

## Configure the Ontomato URL

The script reads `application.yml` beside itself as simple `key: value` lines. Use unquoted values and full-line comments. Use the frontend base URL (including a deployment proxy prefix when needed), without `/api/data-query` or a browser `#` route. Keep the configuration private, especially enterprise credentials.

Set `envUrl` in `application.yml` to the frontend URL of Ontomato, without an API path or browser route:

```yaml
envUrl: http://host:3000
```

When the environment variable `ONTOMATO_URL` is set, it takes precedence over `envUrl`, so one setting serves every installed Ontomato skill.

This is the public-edition client: it sends no enterprise login credentials and has no `login` command. An authenticated enterprise deployment needs the matching enterprise package and authorized identity.

## Commands

Run `node ontomato.mjs [--lang <tag>] <command>` from this directory, or pass the script path. JSON may be an argument or `@file`. `--lang` goes into the `Accept-Language` header and sets the language of generated content and error messages; it defaults to `en`.

```
node ontomato.mjs dataset-desc
node ontomato.mjs classes
node ontomato.mjs schema <class> [<class> ...]
node ontomato.mjs relationships <class> [<class> ...]
node ontomato.mjs env-mode
node ontomato.mjs import-schema
node ontomato.mjs prod-distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs prod-query @query.json
node ontomato.mjs prod-knowledge [--max <n>] <question>
node ontomato.mjs import-test-data testData.zip
node ontomato.mjs vector-upload <class> <attribute> <object-id> --text <text|@file>
node ontomato.mjs vector-upload <class> <attribute> <object-id> --file <path> --text <description|@file>
node ontomato.mjs vector-delete <class> <attribute> <object-id> <path>
node ontomato.mjs distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]
node ontomato.mjs execute-dsl @query.json
node ontomato.mjs metric-view generate [--save] <description>
node ontomato.mjs metric-view execute <id> [<param json|@file>] [--binding id]
node ontomato.mjs metric-view find <class> [<question>]
node ontomato.mjs metric-view get <id>
node ontomato.mjs metric-view save @metricView.json
node ontomato.mjs metric-view delete <id>
node ontomato.mjs action generate|execute|find|get|save|delete ...
node ontomato.mjs action execute <id> [<param json|@file>] [--file <path> ...]
node ontomato.mjs action re-explain [--missing] [--id <id> ...]
node ontomato.mjs sync-production --action <id> [--action <id> ...] --metric-view <id> [--metric-view <id> ...] [--confirm]
node ontomato.mjs ask "How many orders were placed last month?"
```

| Command | Backend call | Environment | Returns |
| --- | --- | --- | --- |
| `dataset-desc` | `GET /admin/getDatasetDesc` | test | Business description of the whole dataset |
| `classes` | `GET /admin/getAllClassNames` | test | Class names |
| `schema` | `POST /admin/getSchemaByClassName` | test | Per class: description, then each enabled attribute's name, type, primary-key flag and description |
| `relationships` | `POST /admin/getRelationshipByClassNames` | test | Relationships that start or end at the classes: source class, relationship type, target class, description |
| `env-mode` | `GET /testEnv/mode` | local | `two-env` or `single-env` |
| `import-schema` | `GET /testEnv/importSchema` | production → test | Rebuilds the current test domain from the production class and relationship definitions (see the warning above) |
| `prod-distinct-values` | `POST /productionEnv/queryDistinctAttrValue` | production | Distinct values of a `varchar` or `text` attribute |
| `prod-query` | `POST /productionEnv/queryData` | production | DSL result JSON |
| `prod-knowledge` | `POST /productionEnv/queryBusinessKnowledge` | production | Business knowledge related to the question |
| `import-test-data` | `POST /testEnv/importData` | test | Uploads a test data file and writes it |
| `vector-upload` | `POST /vectorResource/upload` | test | Uploads text or attachment resource and binds to object attribute |
| `vector-delete` | `POST /vectorResource/delete` | test | Deletes specified vector resource of an object |
| `distinct-values` | `POST /admin/queryDistinctAttrValue` | test | Same as `prod-distinct-values` |
| `execute-dsl` | `POST /dsl/executeV1` | test | DSL result JSON |
| `metric-view ...` / `action ...` | `/metricView/*`, `/action/*` | test | See below |
| `action re-explain` | `POST /action/re-explain` | test | Regenerates missing or stale Action explanations; prints success/skipped/failure counts |
| `sync-production` | `POST /productionEnv/sync` | test → production | Without `--confirm`: the exact plan, no writes. With `--confirm`: per-interface sync result |
| `ask` | Ontology `POST /ontology/retrievals` | test | Retrieval reference, PI state and authorized dataset files |

- After `import-schema`, `dataset-desc`, `classes`, `schema` and `relationships` return the production definitions.
- `distinct-values` / `prod-distinct-values`: `--like` filters values; without `%` the pattern is wrapped as `%pattern%`. Without `--limit` at most 100 values are shown. Use them to find the exact stored value before writing an `=` or `in` condition.
- `schema` may include `vector` attribute type, representing files or text resources attached to an object, maintained by vector upload interfaces, not supporting equality or range comparisons, only semantic retrieval via DSL vector conditions.
- A non-2xx response prints the status and body and exits non-zero. A JSON body with `success: false` prints its message and exits non-zero.

## Workflow

Read the existing ontology and reusable interfaces first: identify the objects to display, relationships to query and business operations to execute. `env-mode` answers only topology. Use read paths for existing business data; import/reset data only within the explicitly designated disposable test scope.

1. `env-mode`. If it returns `single-env`, skip steps 2 and 8 and work directly in `envUrl`.
2. `import-schema` to bring the production definitions into the test environment.
3. `dataset-desc`, `classes`, `schema` and `relationships` to learn the dataset; `prod-knowledge` for business knowledge the application depends on; `prod-distinct-values` and `prod-query` (with a `limit`, to keep results small) to see what real production data looks like.
4. Write a test data zip in the format below and load it with `import-test-data`; vector resources are declared inline in `data.json` (their files packed under `files/`) and imported automatically; check the result with `distinct-values` and `execute-dsl`.
5. Generate the interfaces the pages need with `metric-view generate` / `action generate`, and debug them with `execute`. Once you understand the structure, editing the definition from `get` and running `save` is usually faster than generating again from natural language.
6. For a full test pass on the designated disposable dataset, restore the agreed baseline with `import-test-data` so earlier Action writes do not confuse the checks (re-importing clears the vector resources of classes present in the file and re-attaches the ones in the zip).
7. Build the pages on the tested MetricViews and Actions; see [Calling interfaces from a page](#calling-interfaces-from-a-page).
8. In `two-env`, run `action re-explain --missing`, then sync the interfaces the pages use to production with `sync-production`. Dry run first, show the user the exact list, and wait for explicit confirmation before running with `--confirm`; see [Sync interfaces back to production](#sync-interfaces-back-to-production).
9. Deploy the application code to production with the customer's web server or hosting process.

## Test data

Test data should be varied and typical enough to cover the cases the application must handle, but small. It is uploaded as a **zip archive** with this layout:

```
- data.json          the object and relationship data
- files/             the files referenced by vector attributes
  - file1.suffix
  - ...
```

`data.json` keeps the same top-level structure; a `vector` attribute's value is an array of `{"path": "...", "text": "..."}` entries, where `path` is the file's relative path inside the zip (e.g. `files/photo.jpg`) and `text` is the content used to generate the embedding:

```json
{
  "objDatas": [
    {
      "className": "/namespace/class1",
      "rows": [
        {"id": "c1", "attr1": "East", "attr2": 3.5, "photo": [{"path": "files/c1.jpg", "text": "a bright ward"}]}
      ]
    }
  ],
  "relDatas": [
    {"relationName": "relationship type", "sourceObjId": "source primary key value", "targetObjId": "target primary key value"}
  ]
}
```

Before writing anything, the backend checks the archive's structure, the rows, the references and the vector files and text, and rejects the whole file, with the reason, on the first violation:

- `className` must be an existing class in the test environment, written as `classes` returns it.
- A row may contain only the class's **enabled** attributes (the ones `schema` lists).
- Every row must have a non-empty primary key value. The primary key is the attribute `schema` marks as primary key; when a class has none, `import-schema` makes its first enabled attribute the primary key.
- Primary key values must be unique across the whole file, across classes as well.
- `relationName` must be an existing relationship type. `sourceObjId` must be the primary key value of a row of the relationship's source class in this file, and `targetObjId` of a row of its target class.
- A `vector` attribute's value must be an array of `{"path": "...", "text": "..."}` entries (or empty/omitted). Each `path` must point to an existing, non-empty file under the archive's `files/` directory whose name has a 1–16 character alphanumeric extension (it becomes the stored resource's suffix), and `text` must be non-empty. The file is stored as the vector resource and `text` is embedded; for string resources (txt/doc/pdf…) `text` is the verbatim string content, and for video/audio `text` is the transcription/description produced by a speech-to-text model — the backend does not transcribe media, so the caller must supply that text in `data.json`.
- The archive must contain a `data.json` at its root.
- On import, every class that appears in the file is emptied along with its associated vector resources and then written (objects first, then their vector resources); classes not in the file are left alone.
- Vector write and storage are supported on PostgreSQL, MySQL, SQL Server, DuckDB, Neo4j, Elasticsearch, and OpenSearch; performing vector write operations on GaussDB will explicitly report an unsupported error.
- Production environments do not expose vector upload or delete interfaces; vector links returned by `prod-query` point directly to the production environment, while test environment vector resources must be prepared by testers using the above interfaces.

The import is not atomic: an error while writing (for example embedding or storage) is reported with its reason, but whatever was already cleared or written stays as it is. Fix the cause and run `import-test-data` again.

## Write effects and completion

| Operation | Actual effect and verification |
| --- | --- |
| Read ontology/data, `find` / `get` | Use current definitions/results to identify reusable capabilities; a successful call is not yet a business answer. |
| `import-schema` / `import-test-data` | Replaces or clears the documented test scope; it is not a read-only preview or a general production-database migration command. |
| `generate` / `save` / `delete` | `generate` without `--save` only generates. Saving/deleting changes capability definitions, not execution of an Action. Edit an existing definition from `get` and preserve unrelated fields. |
| `metric-view execute` / `action execute` | The former queries; the latter actually executes the defined business operation. A test-named endpoint does not imply no writes. Read the definition/explanation and execute within the authorized business scope. |
| `vector-upload` / `vector-delete` | Upload appends a resource and writes the object reference; delete removes both. Class/attribute/object must belong to the current ontology. Pass original bytes with `--file`; `--text` is the embedding input, not an instruction for the backend to transcribe the file. |
| `sync-production` | Copies only selected interface definitions, not data, pages, knowledge or the ontomap. Follow the exact-plan confirmation rule below. |

Completion requires checking the actual business result and page calls, not just generation, saving or HTTP 200. Resource bindings depend on context, class/attribute names, object keys and paths; renaming or switching sources does not automatically migrate them. Identify a missing definition/binding and handle it within the authorized scope rather than bypassing the capability contract with direct database writes.

## MetricView parameter bindings

A MetricView is one dynamic calculation with an owned `bindings` collection.
Each binding has an ID, name, description, named `parameters` object and
`matchQuestions`. It has no separate publication state or lifetime. Edit this
collection on the dynamic metric and save it; omit a new binding's ID so the
server assigns it. Omitted bindings preserve the saved collection; an explicit
empty array removes them. Definition edits apply to every binding and are
rejected if they leave bindings invalid. The retired GENERAL/STATIC `type`
field is not accepted on writes; old data conversion is a separate upgrade task.
Execute with `--binding <id>` to use stored values, or supply explicit parameters
for dynamic execution. Do not override a binding's values. Export and production
sync include the whole metric and its bindings, not standalone fixed metrics.

## MetricViews and Actions

A MetricView is a read-only query interface and an Action is a write interface. Their commands and structure are the same; the examples use MetricView (replace `metric-view` with `action`).

- `generate [--save] <description>`: describe in natural language what the interface should do; prints the generated definition. With `--save` it is saved once generated.
- `execute <id> [<params>]`: calls the interface. Params are a JSON object keyed by `function.parameters[].name`; omit them for an interface without parameters. A MetricView returns rows. An Action returns its execution result (`result`, `spendTime`); when it fails, the script prints the reason and exits non-zero. An Action that takes files gets each one through `--file <path>`. A `TYPE_VECTOR` parameter takes an object such as `{"className": "...", "attrName": "...", "text": "...", "fileId": "...", "uploadFile": "0"}`: `uploadFile` is the zero-based position of its file among the `--file` options, `fileId` is needed only to update or delete an existing file, and `text` may be left out when deleting.
- `find <class> [<question>]`: published interfaces related to a class; with a question, the 10 most relevant by meaning. Each entry has `id`, `name`, `logic`, `parameters` and `returnDef`.
- `get <id>`: the full definition.
- `save <definition>`: saves a definition; the body is the JSON `get` prints. With an `id` it updates that interface (the `id` must exist); without one it creates a new interface. Built-in system interfaces cannot be changed.
- `delete <id>`: deletes the interface.

The core of a definition is `function`: `logic` says in natural language what the interface does, `parameters` are its inputs (`name`, `type`, `description`, `sample`), `code` is the program that runs, and `returnDef` describes the returned structure.

> **Action code and vector attributes:** an Action's `code` is a Python write function. Its object writes use `/writeFunctionOperation/insert` and `/writeFunctionOperation/update`, which write **only non-vector attributes** — `insert` silently ignores any vector attribute and `update` raises an error. Write vector attributes only through the vector primitives `appendVector` / `updateVector` / `deleteVector`, never through `insert`/`update`.

## Sync interfaces back to production

Only in `two-env`. The pages call interfaces that currently exist only in the test environment, so those interfaces must exist in production before the application is deployed there.

`sync-production` copies the named MetricViews and Actions by id to production, where they are upserted: a definition with the same id is overwritten, unrelated production interfaces are left alone. It does not copy data, pages, business knowledge or the ontomap.

### Mandatory confirmation

This command writes to production. The agent must not decide to run it on its own:

1. Run the command **without** `--confirm`. It prints the exact ids and names, writes nothing, and exits non-zero.
2. Show that plan to the user, state that same-id interfaces in production will be overwritten, and ask for explicit confirmation.
3. Run again with `--confirm` **only after** the user explicitly approves this specific list. A general instruction to "finish the app" or silence does not approve a specific plan. Reuse an explicit approval already given for this exact unchanged plan.
4. If the list changes, repeat the dry run and ask again.

```bash
# Dry run: show the plan to the user and wait.
node ontomato.mjs sync-production --action <id> --metric-view <id>

# Only after the user explicitly confirms this exact list:
node ontomato.mjs sync-production --action <id> --metric-view <id> --confirm
```

After a successful sync, verify the definitions in production with the read-only `prod-*` commands.

## Action explanations

Every Action stores a server-generated structured explanation (`codeSegments` and `businessMeaning`). It is bound to the action code by `codeHash` and `explanationVersion`:

- `save` regenerates the explanation when the code changes or the stored explanation is missing; a failed generation is returned as an error instead of silently saving an empty explanation.
- `action re-explain [--missing] [--id <id> ...]` regenerates explanations in the current environment. `--missing` skips actions whose explanation already matches the current code.
- After bulk creating or importing Actions, run `action re-explain --missing` in the test environment before `sync-production`.
- `sync-production` refuses Actions whose explanation is missing or does not match the current code. The dry run lists them under `missingExplanations`.

## Calling interfaces from a page

A page calls the interfaces through the test environment's frontend, the same path the script uses:

```
POST <envUrl>/api/data-query/metricView/execute
Content-Type: application/json
Accept-Language: en

{"id": "<MetricView id>", "param": {"param1": "xxx", "param2": 12.3}}
```

An Action is called with a form (`multipart/form-data`), not a JSON body:

```
POST <envUrl>/api/data-query/action/execute
Content-Type: multipart/form-data
Accept-Language: en

id     <Action id>
param  {"param1": "xxx", "param2": 12.3}    the parameters as one JSON string
file   <file>                                optional, repeatable
```

A `TYPE_VECTOR` parameter takes an object such as `{"className": "...", "attrName": "...", "text": "...", "fileId": "...", "uploadFile": "0"}`: `uploadFile` is the zero-based position of its file among the `file` parts, `fileId` is needed only to update or delete an existing file, and `text` may be left out when deleting.

The response is `{"success": true, "data": ...}`, or `{"success": false, "message": "..."}` on failure.

If a page needs to upload or delete vector resources of an object, call via frontend forwarding:

- Upload resource (multipart/form-data):
  `POST <envUrl>/api/data-query/vectorResource/upload`
  Form fields: `content` (required, description text used for vector generation), `className`, `attrName`, `objectId`; if attaching a file, pass `file` (must not be empty) and specify extension in `suffix` (alphanumeric only, 1-16 chars; defaults to txt when no file attached). The target object must already exist in the test environment (otherwise upload fails without saving file or record). On success returns `{"success": true, "data": {"id": "...", "path": "<index_name>/<id>.<suffix>", "content": "...", "className": "...", "attrName": "...", "objectId": "..."}}`, where `data` is the saved resource record and `data.path` is the relative path `<index_name>/<id>.<suffix>` to be passed as `path` when deleting.
- Delete resource (application/json):
  `POST <envUrl>/api/data-query/vectorResource/delete`
  Request JSON body: `{"className": "...", "attrName": "...", "objectId": "...", "path": "<data.path from upload>"}`. On success returns `{"success": true}`.
- Resource download and display:
  Vector fields returned by query interfaces (MetricView or DSL) are formatted as `[{"path": "<full_download_url>", "text": "..."}]`, where `path` is automatically constructed by the backend as an accessible URL prefixed with the system's `cardBaseUrl` configuration (`<cardBaseUrl>/vectorResource/resource/<path>`).

## Natural-language questions

`ask` hands a question to Ontomato, which plans and runs the queries itself. Use it to look at data ad hoc, not as a page interface. It often takes several minutes; set the command timeout long enough for the whole run.

## DSL query reference

Read this package’s [DSL reference and complete examples](references/dsl.md) when writing `execute-dsl` or `prod-query` requests. Use the ontology objects and relationships already read. `graph` is a query expression, not a requirement for a graph database; SQL adapters implement those relationships using the ontomap’s join fields.
