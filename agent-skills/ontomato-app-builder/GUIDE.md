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
| `distinct-values <class> <attribute> [--like <pattern>] [--limit <n>]` | Values from the current build-test sample |
| `execute-dsl <json or @file>` | Query the current build-test sample; use the bundled [DSL reference](references/dsl.md) |
| `function list [<filter json or @file>]` | Full Function definitions; optional `operation` and `className` filters |
| `function get <id>`, `function save <definition>`, `function delete <id>` | Read, save or delete a Function; save returns its definition including ID |
| `metric-view find <class> [<question>]`, `action find <class> [<question>]` | Published interfaces related to the object |
| `metric-view get <id>`, `action get <id>` | Full definition with the Function and its parameters |
| `metric-view generate [--save] <description>`, `action generate [--save] <description>` | Server-generated definition; `--save` persists it |
| `metric-view save <definition>`, `action save <definition>` | Save once and return the saved definition, including new IDs |
| `metric-view publish <id>`, `action publish <id>` | Read the full definition, set `status` to `PUBLISHED`, save and read it back |
| `metric-view delete <id>`, `action delete <id>` | Delete the interface |

Prefer an existing interface. For new read logic, use an `OPERATION_READ` Function with the existing `queryPackage` structure and expose it through a MetricView. Prefer `metric-view generate --save` or saving the embedded Function together through `metric-view save`; an existing shared Function may be referenced by ID. Read back full definitions when editing so parameters and existing bindings are preserved. Function itself has no publication status and no publish endpoint. Pages never execute a read Function directly.

For write logic, use `action generate` and `action save` with an `OPERATION_WRITE` Function. Generation usually takes one to several minutes and can take longer; do not wrap it in a short timeout or switch to a handwritten program while it is still running. When a business requirement specifies a parameter type, include each parameter's name and exact `TYPE_*` in the `action generate` description (for example `newAge: TYPE_NUMBER`), even if the target attribute is stored as text. Start write Functions from the program returned by `action generate` and preserve its protocol header; programs with an unsupported protocol are rejected on save. Java owns Action explanations and parameter rules. This agent already owns the conversation: do not launch the manager's Action-creation conversation or duplicate its draft lifecycle. Action save returns the persisted definition and generates the explanation when necessary. `action re-explain [--missing] [--id <id> ...]` explicitly refreshes explanations.

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

Discovery returns `version`, `publicBasePath`, `sdkBasePath`, `manifestPath`, `docsPath` and `referencePath` from this image's build. Read the manifest, guide, reference and relevant examples of this version. Write HTML and ES modules using its local Vue, Element Plus, ECharts and Ontomato modules. Use the SDK's MetricView and Action APIs and refresh after writes. Draw charts, Markdown, code, content previews and Action forms with the platform's own components, as the guide shows: `<e-chart>` in `context.chartTheme`, `<markdown-view>`, `<code-editor>` for code and data as written such as JSON, `<table-preview>` with `parseCsv` for CSV and TSV, `<html-preview>` for an HTML document, and `<form-fields>` on `context.actions.form`. They look like the platform and follow its light and dark themes. Do not create a chart with ECharts itself, render Markdown another way, show code in a textarea or `<pre>`, parse CSV yourself or hand-build an Action's fields; import `echarts` only for the helpers an option uses. Follow its host integration for theme and language; use only context APIs and modules actually present in this version. The chart theme already keeps category labels from running into each other, so give the option the categories and their values and leave `axisLabel` alone: never set its `interval` to `0` to force every label out, and when the names are long and the slots narrow, change the chart (a horizontal bar chart gives each name its own row) or cut or wrap that one chart's labels through its own `axisLabel` (`width` with `overflow`, or a `formatter`), instead of restating a rule for every chart.

Every page reports what its reader looks at with `context.setPageContext({ page, selection })`, as the SDK guide describes: once when the page starts, with `selection: null`; whenever the reader moves to another page or tab of the app; and whenever they select a business object or clear the selection. `page` is the app's own name for the page in view, as the reader sees it. `selection` is `null` or the selected object as `{ className, primaryKey, name }`: its ontology class name from the platform, its primary key as text, and the name readers know it by. Keep the selection as the page's own state, set by the reader's clicks; do not scan the DOM, post messages between frames or describe the page in another format. A published app's call has no effect. While the builder's workspace panel is open, the user's message ends with a line naming what they look at: the preview with the app's page and the selected object (class, name and primary key), a file, or a commit. "This" or "this row" in the request means that.

The returned paths already include the deployment prefix. HTML module and stylesheet URLs use `sdkBasePath` exactly once; never embed the internal workbench address or fetch modules from a CDN. `sdk read` automatically uses the agent's reachable URL. The version's examples may show root deployment paths: apply `publicBasePath` when writing them into the application. Documentation belongs in the agent's scratch location, not the released directory.

## Product assets and personal home

Start with reusable product assets. If the requested page fits the product document contract, create or edit those same assets through the authoring CLI; manual editing and Agent editing must converge on the same asset IDs. Use custom source only for interactions the asset contract cannot express. Do not reproduce an existing configured page in HTML.

Custom source embeds existing assets with the SDK's `ProductAsset` component:

```js
import { createAppContext, ProductAsset } from '@ontomato/sdk';
const context = createAppContext();
// Register ProductAsset in components and render:
// <product-asset :context="context" asset-id="actual-asset-id"></product-asset>
```

Declare embedded IDs in `ontomato.products.json`. `revision` may be incremented to reload the shared asset after an edit. Embedded content uses the shell's product runtime, current identity and theme, not a copied definition. Embedding is unavailable in build-test previews and fails explicitly; author assets with the CLI, then verify embedding in a published app. Missing assets remain errors; do not silently replace them with a generated HTML copy.

Product parameters are default inputs and interaction preferences. Business windows, thresholds, legal values and operation eligibility must be defined and validated by capabilities, never solely by a page's literals, options or read-only fields. Deleting the page must not delete a business rule. Object views bind properties and relationship results to published MetricViews; pass the selected object using `{source:"context",path:"primaryKey"}` (or `className`). Legacy direct reads and `visibleWhen` business conditions must be migrated before saving or publishing the view.

Before source publication or rollback, commit both `ontomato.products.json` (an empty `assetIds` array explicitly declares no product assets) and `ontomato.product-review.json`:

```json
{"schemaVersion":1,"checks":{"capabilityReads":true,"actionWrites":true,"noBusinessRules":true,"disposablePresentation":true}}
```

Review the actual source before setting these checks: all business reads use published MetricViews, all writes use Actions, no business calculation/threshold/eligibility rule lives only in source, and removing the application preserves business semantics. Formatting, selection, loading and error feedback remain presentation logic. This committed declaration is a delivery check, not static proof about arbitrary JavaScript.

Reuse templates without replacing the user's home: `product create-page <template-id> <name>` creates a new private page with the template's layout and component references. The SDK exposes the same operation as `context.products.createPage(id, name)`. Use the returned ID to assemble an application and declare it in the product manifest. `product use-home` instead replaces the current personal home configuration.

`product create-dashboard <name>` creates a dashboard through its existing owner service and registers a product reference, returning `data.id` and `data.productAssetId`. The SDK's `context.products.createDashboard(name)` returns the product asset. Reuse an existing dashboard when appropriate. The Manager's dashboard creation uses this same path. Add content through the existing dashboard authoring workflow rather than embedding SQL or duplicating the definition in product storage.

Product responsibilities: `widget` is one presentation/interaction unit; `widget-group` contains `widgets` limited to text, metric, table and chart; `operation-panel` contains `widgets` and must include at least one published Action entry. Use a display group for pure KPI cards, not an operation panel. Both group types keep their layout and can be edited one child at a time in the manual editor. Product MetricViews return a row array: leave `resultPath` empty; do not bind a substitute dataset. Bind every MetricView parameter without a declared default. Local variable bindings need an input, table selection or button in the same composition. Product chart renderers currently support ECharts bar, line and donut; use object views for the existing specialized visualizations. Product get returns recursive caller-visible dependencies and indirect product parents; it does not expand internal Object View or legacy dashboard definitions.

`object-view` is a reusable class-view reference: `{kind:"object-view",className:"<actual class>",form:"full",primaryKey:"<optional object key>"}`. The class view must already be published. Omit `primaryKey` to select objects at runtime; changing the object does not change the class view. Shared references omit the object selection. This is an adapter to the existing object-view service; it does not copy the class document into product storage. A chart widget's `chartType` (`bar`, `donut`, `line`) and field mapping can change while its MetricView `resourceId` stays the same. For a page, save its `children` and `workspace` together; the manual home editor uses this same asset API.

Before generating a configurable page, use `product types`, `product list` and `product home`. `product get <id>` returns the asset, derived references and visible parents. `product save <id> <json|@file>` takes `{name, description, visibility, document, revision}`; use a new UUID with revision 0 to create, or the returned ID and revision to edit. Read before editing and preserve unrelated fields. A stale revision fails with `PRODUCT_CONFLICT`: read again and merge the user's change. `product copy <id> <name>` makes a private independent copy. `product use-home <id> <current-home-revision>` copies a page or layout template into the reader's home. `product delete <id> <revision>` rejects referenced assets.

Documents have a fixed `kind`: `page` and `layout-template` contain `workspace` (the personal workspace configuration) and `children: [{assetId, column: "main"|"sidebar"}]`; `widget` contains `widget`; `operation-panel` contains `widgets`; `dashboard` contains `dashboardId`; `application` contains `applicationId`, optional `workspaceId`, and `children`. For real field defaults read an existing asset. Widget parameter bindings are `{source:"literal",value:...}` or `{source:"variable",path:"..."}`. Metric/table/chart widgets reference a published MetricView through `resourceId`; action widgets reference a published Action. No object reads, business predicates, SQL or DSL belong in a product document. Column names and declared parameters are validated against the interface. Shared pages/templates contain only shared product children; personal dashboards cannot be shared this way. Use shared MetricView widgets instead. Runtime results, conversations and business objects remain with their original services.

The SDK exposes `context.products.list/get/home/save/copy/useHome/delete` with the same contract. These calls are unavailable inside build-test preview; use the authoring CLI for product edits. For configurable interfaces, edit these assets instead of producing an unrelated HTML copy. A custom source application can call product APIs, but only its explicit product references participate in this dependency model; do not claim complete static analysis of arbitrary JavaScript.

## Workspace history and publication

When custom source uses product assets, include `ontomato.products.json` in the committed tree:
`{"schemaVersion":1,"assetIds":["<actual product ID>"]}`. The publisher validates these references and registers the application in the product catalog using its stable application ID. Rollback restores the references from that release's commit. Both publication and rollback require the manifest and review record described above. Use the SDK product API and `context.navigate("/products/<pageAssetId>")` to reuse a declarative page. Never copy the capability logic into source.

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

## Build-test vector operations



`vector-upload <class> <attribute> <objectId> [--file <path>] --text <text or @file>` and `vector-delete <class> <attribute> <objectId> <path>` operate on an existing object's resources. Keep these writes within the requested business scope. `ask` is unsupported for build tests.

## Command input and failure contract (5.0)

Positional names, IDs, paths, questions and descriptions are strings. Arguments shown without brackets are required; bracketed arguments are optional. JSON input is parsed once, without converting a JSON string to an object or taking the first member of an array. A missing field or wrong type fails with the owner's field name and correction; the command exits nonzero and preserves that message. An import can report per-item success/failure; check its `failures`, not just the HTTP status.

| Commands | JSON/body types and defaults |
| --- | --- |
| `schema`, `relationships` | At least one class name, sent as `classNames: string[]`. |
| `execute-dsl` | Required DSL JSON, using the DSL endpoint's documented syntax. |
| `function list/get/save/delete` | list filter defaults to `{}`; get/delete require an ID. save requires a Function object; READ uses queryPackage, WRITE uses Python v2 code. Parameter names/types/descriptions must have their declared JSON types. No boolean parameter type is added. |
| `action` / `metric-view` `generate` | Required description → `question: string`; `persistence` is false unless `--save` is given. Invalid generated fields fail by name; no successful asset is fabricated. |
| `action` / `metric-view` `find/get/save/publish/delete` | find requires a class, optional question defaults to omitted. get/publish/delete require ID. save takes the full definition object, with the embedded Function. publish saves that definition as PUBLISHED; it does not bypass asset admission. |
| `action` / `metric-view` `execute` | Required ID; JSON parameters default to `{}` only for zero-parameter assets. Every declared key must be present. Explicit null is accepted; `""` and `0` are preserved. Missing keys fail with `Missing parameter: <name>`. MetricView `--binding` supplies its complete saved parameter object and cannot be overridden. |
| `action re-explain` | Optional repeated IDs; `--missing` defaults false. Results identify individual failures. |
| `vector-upload`, `vector-delete` | Required class, attribute and object ID; upload requires text and optionally file, delete requires resource path. Vector fields are rejected by ordinary object insert/update. |
| `sdk current/read` | current has no body. read requires one relative path, or exact version plus relative path; no version is guessed from an installed application. |
| `workspace list/commits/sessions/tree` | Optional page/query JSON defaults to `{}`. IDs are required except for list. Page/query fields are checked by the workspace HTTP schema. |
| `workspace create/get/rename/delete/content/diff/restore` | Required string positional arguments listed above; content's omitted commit reads the working tree. No body defaults invent missing IDs or commits. |
| `workspace import/publish/releases/rollback` | Required workspace ID; import needs a directory and explicit message, publish needs commit and declaration object, rollback needs release ID and declaration object. releases has no body. |


The platform injects the Python helper module when it executes a generated Action; it is not a file in this skill package. Use the program returned by `action generate` through the Action API rather than running it with local Python. Write helpers take object dictionaries and arrays of dictionaries. A where is a nonempty condition object, never a list; invalid conditions fail before object queries or vector/file cleanup. `appendVector`/`updateVector` require nonempty text; with fileBase64 omitted or null, Java explicitly stores that text as a UTF-8 attachment. With fileBase64 supplied, it must be base64 file bytes; text remains required for embedding. There is no empty-file fallback when both are missing.

## Business testing

Write `test-data/sample.json` in the workspace using the complete envelope below: `objDatas` contains groups of `{className, rows}`; each row is an object dictionary with its primary key and enabled attributes. `relDatas` and `vectorDatas` may be empty arrays. Use technical class and field names from `schema`; replace the example class and attributes to match the current ontology.

```json
{
  "objDatas": [{
    "className": "celestial_body",
    "rows": [
      {"id": "e2e-body-1", "name": "Sample A", "description": "Original A"},
      {"id": "e2e-body-2", "name": "Sample B", "description": "Original B"},
      {"id": "e2e-body-3", "name": "Sample C", "description": "Original C"}
    ]
  }],
  "relDatas": [],
  "vectorDatas": []
}
```

Attachments are relative to that sample. Sample files must stay inside test-data/ so publication can exclude the entire test-material directory. Start with `test start --workspace <id>` (the built-in agent already has ONTOMATO_WORKSPACE_ID); `test status` and `test stop` use the same workspace entry. No sample is collected from live data. A new start ends and cleans the previous context before preparing a fresh ID. Once a round has expired or ended, the user may also restart it from the notice in the preview: that is the same start, preparing the sample at the same path again as the workspace holds it now, so read `test status` rather than assume the context you started is still the current one.

Action/MetricView execute, execute-dsl, distinct-values and vector commands bind the workspace's current Java context once for that command. Missing, preparing, failed, ended or expired contexts fail; requests never switch to live data. ask is not supported for build tests. Metadata discovery and asset editing keep their existing APIs. To look at live data, publish the application for yourself first. A conversation ending does not stop its test context. An interface that does not declare test support refuses a headed request with BUILD_TEST_UNSUPPORTED; do not retry without the header. Definition reads, parameter forms and identity checks remain available.

Preview requires the SDK manifest's executionContext capability 1. Upgrade old workspace SDK references when the preview entry rejects them. Test samples are excluded from published application files.

## Upgrade workspace SDK references

When preview returns `BUILD_TEST_SDK_UPGRADE_REQUIRED`, run `sdk current` to obtain the required exact version. Update every old `/apps-sdk/<version>/` reference in the workspace, including the importmap, stylesheet links and any absolute module imports, to that current version. Use `sdk read sdk.json`, `sdk read docs/index.md` and `sdk read docs/reference.md` to check interface changes and adapt the page, then commit the workspace changes (inside the platform, finish the changed run so runtime commits it; externally, use the existing workspace import with an explicit commit message). This uses the existing source-editing workflow; there is no separate SDK upgrade command. Retry preview only after the references and interfaces have been updated.

`test status` and `test stop` succeed when the workspace has no test context, returning `{workspaceId, contextId: null, status: "NONE"}`. This is a normal absence result, not a failed request and not permission to use live data.
