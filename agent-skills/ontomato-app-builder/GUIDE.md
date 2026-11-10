# Build a hosted application

Pages use the exact platform SDK version, read published MetricViews and execute Actions. Business logic belongs in Functions owned by Java. Use the deployment, domain and authorized business scope already established with the user; obtain technical names, IDs, parameters and relationships from the platform. Do not invent them or write directly to the database.

## Connection and workspace

Run `node <skill>/ontomato.mjs <command>`. JSON arguments accept inline JSON or `@file`; use `--lang <tag>` for the response language.

- Inside the platform, the runtime provides `ONTOMATO_WORKBENCH_URL`, `ONTOMATO_ONTOLOGY_URL`, the current credentials and `ONTOMATO_WORKSPACE_ID`. Edit the mounted `work/` directory directly. Do not import this directory back into itself, execute `git commit`, or write credentials into it. The runtime makes one commit after a changed run, using the first line of the user request; an unchanged run produces no commit.
- Outside the platform, set `ONTOMATO_URL` to the browser entry, including any deployment prefix. The public edition is anonymous. The enterprise adapter accepts `ONTOMATO_TK` or `ONTOMATO_API_KEY`, or the login configured in `application.yml`. Edit a complete local source tree, create a workspace, then import the tree with an explicit commit message.

A workspace is the application source tree. Business definitions remain in Java; do not copy them into it as a second source of truth. Keep downloaded documentation and scratch files outside the source tree. Errors are returned directly; report the actual cause and fix within the authorized scope.

## Discover and save business capabilities

| Command | Result |
| --- | --- |
| `dataset-desc`, `classes` | Current domain and available object classes |
| `schema <class> ...`, `relationships <class> ...` | Technical attributes, types and actual relationship mappings |
| `distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]` | Values for exploring the current data |
| `execute-dsl <json or @file>` | Ad hoc query; use the bundled [DSL reference](references/dsl.md) |
| `function list [<filter json or @file>]` | Full Function definitions; optional `operation` and `className` filters |
| `function get <id>`, `function save <definition>`, `function delete <id>` | Read, save or delete a Function; save returns its definition including ID |
| `metric-view find <class> [<question>]`, `action find <class> [<question>]` | Published interfaces related to the object |
| `metric-view get <id>`, `action get <id>` | Full definition with the Function and its parameters |
| `metric-view generate [--save] <description>`, `action generate [--save] <description>` | Server-generated definition; `--save` persists it |
| `metric-view save <definition>`, `action save <definition>` | Save once and return the saved definition, including new IDs |
| `metric-view publish <id>`, `action publish <id>` | Read the full definition, set `status` to `PUBLISHED`, save and read it back |
| `metric-view delete <id>`, `action delete <id>` | Delete the interface |

Prefer an existing interface. For new read logic, use an `OPERATION_READ` Function with the existing `queryPackage` structure and expose it through a MetricView. Prefer `metric-view generate --save` or saving the embedded Function together through `metric-view save`; an existing shared Function may be referenced by ID. Read back full definitions when editing so parameters and existing bindings are preserved. Function itself has no publication status and no publish endpoint. Pages never execute a read Function directly.

For write logic, use `action generate` and `action save` with an `OPERATION_WRITE` Function. Start write Functions from the program returned by `action generate` and preserve its protocol header; programs with an unsupported protocol are rejected on save. Java owns Action explanations and parameter rules. This agent already owns the conversation: do not launch the manager's Action-creation conversation or duplicate its draft lifecycle. Action save returns the persisted definition and generates the explanation when necessary. `action re-explain [--missing] [--id <id> ...]` explicitly refreshes explanations.

A definition without an ID creates an asset; with an ID it updates that asset. Use the returned ID, never a same-name search. A MetricView's `bindings` belong to that metric: omit them to preserve existing bindings, use `[]` to remove them. The retired GENERAL/STATIC `type` field is not accepted.

`metric-view execute <id> [<parameter JSON>] [--binding <id>]` reads data. `action execute <id> [<parameter JSON>] [--file <path> ...]` performs the business write; execute only within the authorized scope. Supply parameter values by the names in `function.parameters`. A binding supplies its saved values. Action files use multipart uploads. A vector parameter uses `{className, attrName, text, fileId, uploadFile}` as applicable; `uploadFile` is the zero-based file position. Vector writes use the platform's vector operations, not ordinary object insert/update.

## Read the current SDK, then write the page

```sh
node <skill>/ontomato.mjs sdk current
node <skill>/ontomato.mjs sdk read sdk.json
node <skill>/ontomato.mjs sdk read docs/index.md
node <skill>/ontomato.mjs sdk read docs/reference.md
node <skill>/ontomato.mjs sdk read examples/<example from the docs>
```

Discovery returns `version`, `publicBasePath`, `sdkBasePath`, `manifestPath`, `docsPath` and `referencePath` from this image's build. Read the manifest, guide, reference and relevant examples of this version. Write HTML and ES modules using its local Vue, Element Plus, ECharts and Ontomato modules. Use the SDK's MetricView and Action APIs and refresh after writes. Draw charts, Markdown, code, content previews and Action forms with the platform's own components, as the guide shows: `<e-chart>` in `context.chartTheme`, `<markdown-view>`, `<code-editor>` for code and data as written such as JSON, `<table-preview>` with `parseCsv` for CSV and TSV, `<html-preview>` for an HTML document, and `<form-fields>` on `context.actions.form`. They look like the platform and follow its light and dark themes. Do not create a chart with ECharts itself, render Markdown another way, show code in a textarea or `<pre>`, parse CSV yourself or hand-build an Action's fields; import `echarts` only for the helpers an option uses. Follow its host integration for theme and language; use only context APIs and modules actually present in this version.

Every page reports what its reader looks at with `context.setPageContext({ page, selection })`, as the SDK guide describes: once when the page starts, with `selection: null`; whenever the reader moves to another page or tab of the app; and whenever they select a business object or clear the selection. `page` is the app's own name for the page in view, as the reader sees it. `selection` is `null` or the selected object as `{ className, primaryKey, name }`: its ontology class name from the platform, its primary key as text, and the name readers know it by. Keep the selection as the page's own state, set by the reader's clicks; do not scan the DOM, post messages between frames or describe the page in another format. A published app's call has no effect. While the builder's workspace panel is open, the user's message ends with a line naming what they look at: the preview with the app's page and the selected object (class, name and primary key), a file, or a commit. "This" or "this row" in the request means that.

The returned paths already include the deployment prefix. HTML module and stylesheet URLs use `sdkBasePath` exactly once; never embed the internal workbench address or fetch modules from a CDN. `sdk read` automatically uses the agent's reachable URL. The version's examples may show root deployment paths: apply `publicBasePath` when writing them into the application. Documentation belongs in the agent's scratch location, not the released directory.

## Workspace history and publication

| Command | Purpose |
| --- | --- |
| `workspace list [<page JSON>]`, `workspace create <name>`, `workspace get <id>` | Discover/create a workspace and read HEAD and active run |
| `workspace rename <id> <name>`, `workspace delete <id>` | Rename or remove the workspace |
| `workspace tree <id> [<query JSON>]`, `workspace content <id> <path> [<commit>]` | Inspect working or committed files |
| `workspace commits <id> [<page JSON>]` | Commit IDs and messages; page uses `offset`/`limit` |
| `workspace sessions <id> [<query JSON>]` | Conversations with timestamps and latest run; page uses `cursor`/`limit` |
| `workspace diff <id> <from> <to or working>` | Inspect the patch |
| `workspace restore <id> <commit>` | Restore old files by creating a new commit, preserving history |
| `workspace import <id> <directory> --message <text>` | External agent: replace the complete tree and return its commit; `.git` is excluded |
| `workspace publish <id> <commit> <declaration JSON>` | Publish an explicit existing commit |
| `workspace releases <id>` | Export records with app, release and commit IDs |
| `workspace rollback <id> <releaseId> <declaration JSON>` | Move the Java publication reference without changing source history |

The declaration uses `{names, descriptions, icon, groups, permissions}`; names and descriptions use the platform's language keys. Reuse an existing application's declaration when publishing another version. Java `GET /platform/applications/<appId>` is authoritative for the current release; the newest export record is not proof of successful publication. The existing identity and business permissions apply to every operation.

Publish only a commit that already exists. When files were changed in this run, finish the run first, then publish through the platform drawer or in a later run. Never call a dirty tree HEAD the new version. End with the actual result and workspace-relative file links so the host can show the changed source. Runtime supplies the run's commit separately; do not guess it from a reply or from another run's HEAD.

## Explicit external deployment operations

The following existing commands are for an explicitly requested test/production workflow; they are not prerequisites for the built-in builder. `env-mode` reports topology. `import-schema` imports the production ontology into a configured test deployment; `import-test-data <zip>` writes test data. `prod-distinct-values`, `prod-query` and `prod-knowledge` read production. `import-schema` drops and recreates the target domain's data namespace and changes its data-permission grants; use it only for an explicitly authorized dedicated test domain. Do not import, clear or rebuild business data automatically.

`sync-production --action <id> ... --metric-view <id> ...` prints an exact plan and writes nothing without `--confirm`. Show the selected assets and same-ID overwrite effects; use `--confirm` only after approval of that exact plan. The operation copies only the selected interfaces, not pages or business data. Normal application publication uses `workspace publish`.

`vector-upload <class> <attribute> <objectId> [--file <path>] --text <text or @file>` and `vector-delete <class> <attribute> <objectId> <path>` operate on an existing object's resources. Keep these writes within the requested business scope. `ask <question>` is an ad hoc ontology query, not a page API.

## Command input and failure contract (5.0)

Positional names, IDs, paths, questions and descriptions are strings. Arguments shown without brackets are required; bracketed arguments are optional. JSON input is parsed once, without converting a JSON string to an object or taking the first member of an array. A missing field or wrong type fails with the owner's field name and correction; the command exits nonzero and preserves that message. An import can report per-item success/failure; check its `failures`, not just the HTTP status.

| Commands | JSON/body types and defaults |
| --- | --- |
| `dataset-desc`, `classes`, `env-mode`, `import-schema` | No body; use the established current domain. import-schema is an explicitly authorized destructive external operation as described above. |
| `schema`, `relationships` | At least one class name, sent as `classNames: string[]`. |
| `distinct-values`, `prod-distinct-values` | Class and attribute required; `like` defaults to `""`; omitted limit uses the endpoint's default, an explicit limit must be a finite number. |
| `execute-dsl` | Required DSL JSON, using the DSL endpoint's documented syntax. |
| `prod-query` | Required single nonempty DSL object, sent as `{dsl: object}`; arrays and serialized objects are rejected. |
| `prod-knowledge` | Required question; optional finite numeric `--max` becomes `max_result`, otherwise omitted for the server default. |
| `function list/get/save/delete` | list filter defaults to `{}`; get/delete require an ID. save requires a Function object; READ uses queryPackage, WRITE uses Python v2 code. Parameter names/types/descriptions must have their declared JSON types. No boolean parameter type is added. |
| `action` / `metric-view` `generate` | Required description → `question: string`; `persistence` is false unless `--save` is given. Invalid generated fields fail by name; no successful asset is fabricated. |
| `action` / `metric-view` `find/get/save/publish/delete` | find requires a class, optional question defaults to omitted. get/publish/delete require ID. save takes the full definition object, with the embedded Function. publish saves that definition as PUBLISHED; it does not bypass asset admission. |
| `action` / `metric-view` `execute` | Required ID; JSON parameters default to `{}` only for zero-parameter assets. Every declared key must be present. Explicit null is accepted; `""` and `0` are preserved. Missing keys fail with `Missing parameter: <name>`. MetricView `--binding` supplies its complete saved parameter object and cannot be overridden. |
| `action re-explain` | Optional repeated IDs; `--missing` defaults false. Results identify individual failures. |
| `sync-production` | At least one explicit Action or MetricView ID. dryRun defaults true in CLI and HTTP. `--confirm` sends Boolean false; HTTP null or non-Boolean dryRun fails. |
| `import-test-data` | Required readable ZIP file, multipart `file`; server owns its object/vector validation. |
| `vector-upload`, `vector-delete` | Required class, attribute and object ID; upload requires text and optionally file, delete requires resource path. Vector fields are rejected by ordinary object insert/update. |
| `sdk current/read` | current has no body. read requires one relative path, or exact version plus relative path; no version is guessed from an installed application. |
| `workspace list/commits/sessions/tree` | Optional page/query JSON defaults to `{}`. IDs are required except for list. Page/query fields are checked by the workspace HTTP schema. |
| `workspace create/get/rename/delete/content/diff/restore` | Required string positional arguments listed above; content's omitted commit reads the working tree. No body defaults invent missing IDs or commits. |
| `workspace import/publish/releases/rollback` | Required workspace ID; import needs a directory and explicit message, publish needs commit and declaration object, rollback needs release ID and declaration object. releases has no body. |
| `ask` | Required question; uses the shared analyst client's request contract. It does not execute an Action. |

Python write helpers use single object dictionaries and arrays of dictionaries as documented in `query_runtime.py`. A where is a nonempty condition object, never a list; invalid conditions fail before object queries or vector/file cleanup. `appendVector`/`updateVector` require nonempty text; with fileBase64 omitted or null, Java explicitly stores that text as a UTF-8 attachment. With fileBase64 supplied, it must be base64 file bytes; text remains required for embedding. There is no empty-file fallback when both are missing.
