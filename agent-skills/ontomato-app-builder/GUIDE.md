# Build a panel application

**Application IDs start with `app-`. Put application and entry paths under `/applications/<app-id>/`.**

Run these through `node "$SKILL/scripts/ontomato.mjs"`.

```text
sdk current
sdk read docs/components.md
sdk read docs/components/<Name>.md
panel type <id> [--read <name>]
panel check <dir>
```

Use `sdk current` for release information and `panel type` for object types. There is no `sdk list` or top-level `read ObjectType`.

Follow the [Product Layer and Application Composition Standard](references/app-standard/references/standard.md) and the current SDK guide. Use current product records. Keep business logic and permission checks with the resource owners. Use the deployment, domain and authorized business scope already established with the user. Obtain technical names, IDs, parameters and relationships from the platform through its discovery commands and owner interfaces.

Start with the [Vue panel skill](references/panel-authoring/SKILL.md) and choose a matching [page template](references/templates/README.md). When moving an already-built page into the product layer, read [Migrating an existing page into the product layer](references/migrate-existing-page.md) alongside the [application decomposition skill](references/app-standard/SKILL.md).

Use the [panel authoring recipes](SKILL.md#what-you-want-to-do--where-to-look) (`references/panel-authoring/recipes/`) for lists, headers, file uploads and dialog forms,
[member fields](references/panel-authoring/FIELDS.md) for bindings and controls, and
[panel runtime](references/panel-authoring/RUNTIME.md) for hooks, overlays and assistant interaction.

## Connection and workspace

Run `node <skill>/scripts/ontomato.mjs <command>`. JSON arguments accept inline JSON or `@file`; use `--lang <tag>` for the response language.

- Inside the platform, the runtime provides `ONTOMATO_WORKBENCH_URL`, `ONTOMATO_ONTOLOGY_URL`, and a session credential. The CLI resolves the session's workspace through Workbench when a command needs it. Edit the mounted `work/` directory directly. Do not import this directory back into itself, execute `git commit`, or write credentials into it. The runtime makes one commit after a changed run, using the first line of the user request; an unchanged run produces no commit.
- Outside the platform, set `ONTOMATO_URL` to the browser entry, including any deployment prefix. The public edition is anonymous. The enterprise adapter accepts `ONTOMATO_TK` or `ONTOMATO_API_KEY`, or the login configured in `application.yml`. Edit a complete local source tree, create a workspace, then import the tree with an explicit commit message.

A workspace is the application source tree. Business definitions remain in Java; do not copy them into it as a second source of truth. Keep downloaded documentation and scratch files outside the source tree. Errors are returned directly; report the actual cause and fix within the authorized scope.

## Panels and application uses

For a management page, pick a [page template](references/templates/README.md) (prefer
[two-entry-catalog-detail](references/templates/two-entry-catalog-detail/README.md) for multi-column catalogs with
full-width detail), read the [management page wiring recipes](references/management-pages.md), or run `panel scaffold`.

1. **Discover read functions and operations.** Run `panel type <type-id>` and compare result shapes with official
   component data ports in `sdk read docs/components.md` (overview) and `sdk read docs/components/<Name>.md` (single page).
   - For customer ontology classes (e.g. `Student`, `Order`), projections only bind read and write functions —
     `bindsElement` indicates applicable ontology element types, while every actual binding must go through a
     projection's declared read or operation (binding a class alone is rejected). Bind the platform's generic read
     functions (`query`, `record`, `form`, `createForm` shown under `panel type <class>`), MetricViews for
     filtered/calculated reads (declare `sourceObjectTypes` so writes auto-refresh metrics), and Actions for writes
     (including object-targeted Actions for edits and top-level targetless Actions with `target: { source: "none" }`
     for object creation and global operations).
   - For `platform:*` types (e.g. `platform:Relationship`, `platform:Application`), bind their built-in platform reads
     and management operations.
2. **Respect boundaries and lookup order.**
   - **Hierarchy**: platform sidebar → default app menu or a [frame for shared state](references/templates/app-frame/README.md) →
     current entry panel → nested panels, projections, and data-free SDK UI primitives.
   - **Components first**: follow the four-step order — (1) official defaults, (2) `config` (`ObjectList` `columns` /
     `valueMap` / `rowActions`, `ObjectSummary`, `ObjectHeader`, `ObjectForm` `presentation` / `groups` / `actions`,
     `OperationButton` `hideWhenUnavailable`), (3) standard Vue slots (`#cell-<key>`, `#actions`, `#row-detail`,
     `#field-<dotPath>`) with a slot-only domain component in `manifest.components` or nested `<projection :inputs="{ target: ref }">`,
     (4) a dedicated domain component only as a last resort.
   - **Panels lay out and wire**: write layout in normal HTML, CSS (`@container`), and Vue (no layout components). Place
     `<page-header>` at the top of `panel.html` when needed and wire edit Save/Discard with `usePanelFormDraft("form")`.
     Use `panelAddress(path, state)` for flat named URL query parameters (never mark dialog/edit toggles with
     `deepLink: true`), `<sdk-*>` tags, `v-sdk-*` directives, `--sdk-*` tokens, `usePanelOutput` / `usePanelOutputs` for
     read-only component outputs, and `usePanelContext().notify()`. Never read raw business record fields in the panel,
     never compute business calculations in panel/component code, never call `fetch`/`XMLHttpRequest`, and never write
     `el-*` tags, `--el-*` tokens, `v-loading`, or `element-plus` imports.
3. Run `panel check <workspace directory>` to validate the panel source, declarations, and references.
4. Keep the source commit, preview it in Application Builder, and use the page to publish after user confirmation.

Create short members from the reads listed by `panel type`. For views backed by an existing projection, reuse its
registered `target.projectionId`.

| Command | Result |
| --- | --- |
| `sdk read docs/components.md` | Compact grouped overview of panel-usable components (one line each, linking to per-component single pages) |
| `sdk read docs/components/<Name>.md` | Full single-page reference for one component (data ports, configuration, expanded types, outputs, slots, events) |
| `sdk read docs/components/ui-primitives.md`, `docs/components/theme-tokens.md` | `<sdk-*>` UI primitives, `v-sdk-*` directives, and `--sdk-*` theme tokens |
| `sdk read components.json` | The same current SDK's machine-readable component, UI primitive (`uiPrimitives`, `uiDirectives`) and theme token (`themeTokens`) catalogue |
| `sdk icons` | Icon choices for applications from the current SDK |
| `component list` | List visible domain-registered components in the current domain |
| `component read <id>` | Read one domain-registered component's declaration, source and current revision |
| `component register <directory> [--revision <number>]` | Register (create) or update (with `--revision`) a single domain component from `component.json`, `component.html` and optional `component.mjs` |
| `panel type <type-id> [--read <name>]` | Read signature with its result schema. With no filter, list the type's reads and operations. |
| `panel type --all` | The visible author type table as JSON, for offline checks |
| `panel delete application\|panel <id>` | Delete a trial application or panel through its owner |
| `panel projections [--q <text>] [--component <componentId>] [--object-type <typeId>] [--scope all\|mine\|shared] [--sort updated\|name] [--limit <n>] [--cursor <token>]` | Search and filter authorized projections across the full visible catalogue before paging, by keyword, component ID, and bound object type |
| `panel projection <id>`, `panel get <id>` | Authorized current projection or panel, including its revision |
| `panel applications`, `panel uses <applicationId>` | Java navigation catalog and visible use relations |
| `panel scaffold <type> <new directory> [--id <application id>] [--operation <id>] [--batch <id>]` | Draft an application with catalog and detail panels from the type table. Select single and batch buttons by owner operation ID. The returned `entry` is the catalog path. |
| `panel check <application-root> [--sdk-dir <release directory>]` | Check application source using the current SDK and resolve registered references using the author's access. With an installed release directory, check offline and list unresolved references. |

### Custom components

Use official SDK components and `config` first. When a dedicated custom component is truly needed, register a single
domain component with `node "$SKILL/scripts/ontomato.mjs" component register <directory>` (which assigns
`domain-component:<uuid>` into `component.json`, inspectable via `component list` / `component read <id>`). Declare it
under `manifest.components` in `panel.json` and place it directly inside an official component's Vue slot (see the
[end-to-end Vue slots, built-in row actions, and domain component example](references/panel-authoring/recipes/list-slots-and-row-operations.md)).
Third-party component package installation is not currently available to authors (`sdk package <name>` is read-only
inspection only; there is no author package upload endpoint).

## Application source

Use the same tree for a platform project and for local authoring with this skill. Start from one of the
[application templates](references/templates/README.md) or from `panel scaffold`.

```text
application.json
panels/
  <panelId>/
    panel.json
    panel.html
    panel.mjs     # optional
    panel.css     # optional, when the definition has a separate stylesheet
    recipes.md    # optional
projections/
  <projectionId>.json
```

- `application.json` contains the complete application definition. `declaration` contains localized `names`
  and `descriptions`, `icon` and `groups`. `entry` contains `path`, `renderer: "panels"`
  and optional `home`. Keep `panelUses`, and preserve `allowStandalone`, `framePanelId`,
  `theme` (theme overrides) and `delivery` whenever present. The host supplies the application ID from the
  project identity. Retain all declared values, including translations, so a source round trip preserves the definition.
- A panel's directory name is its ID. `panel.json` contains `name`, `description`, `visibility` and
  `manifest`, plus optional `template`, `theme` and `content.messages`. HTML, module, stylesheet and recipes
  travel as source files. `manifest.members` places a projection with `target: { projectionId: "…" }` or
  places a panel by ID. Use the [member field reference](references/panel-authoring/FIELDS.md) for bindings.
- Each owned projection has its registered definition in `projections/<projectionId>.json`, including its
  component, owner reads and operations, and input and output declarations as applicable. Place it by ID in the
  panel manifest. Use `panel projection <id>` to inspect an existing definition. The directory has no files
  when the application owns no projections.
- Each panel and projection belongs to one application's source. A consuming application keeps the shared
  panel's ID in `panelUses`. A panel that consumes a shared projection uses its registered projection ID.
  Keep shared source files in the owner application's tree so its commits govern changes.

Each panel use has `id`, `pageKey`, `panelId` and `path`. Keep `id` stable when renaming or moving an entry
and keep the page key unique in the domain. Include localized `names` to display a use in the application menu.
Detail uses opened through navigation or a deep link can omit `names`. On first publication, set
`initialOpenEntryIds` to the IDs that domain members should be able to enter. An empty array starts the application
with restricted entries. Choose the icon with `sdk icons`.

### Check, preview, and publish

Run `panel check <application-root>` to check the source and its bindings. The checker resolves owned
definitions from the tree and shared references under the author's platform access. With `--sdk-dir` it
checks offline and reports references it could not resolve in `unchecked`. Use `--type-table` to also check
operations against the owner's declarations.

Review the candidate in Application Builder and retain the source commit. Use the page's registered Publish
operation to apply the commit. If the platform reports drift, use the registered Sync operation and resolve
any merge conflicts in source before publishing. The agent may request Publish or Sync under section 2.4.2.
The page submits the operation after the user confirms. Open the declared entry after publishing to verify the
result.

The checker can also read old single-panel roots containing `panel.json` and `panel.html`, with optional
`panel.mjs`, `panel.css`, `recipes.md` and legacy registration material. Use this mode for existing sources.
New apps and templates use the application tree above.

For built-in panel checks, see [platform development](references/platform-development.md#check-built-in-panels).

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
| `metric-view context`, `action context` | Authorized ontology, knowledge and the owner's current authoring guide |
| `metric-view generate [--save] <definition JSON or @file>` | Test the complete query package and its bindings, then return the owner-accepted definition |
| `metric-view save <definition>`, `action save <definition>` | Save once and return the saved definition, including new IDs (Action save returns immediately as `PENDING_REVIEW` and generates its code explanation in the background) |
| `action trial <id> [--sample <JSON or @file>] [--parameters <JSON or @file>]` | Run the saved Action in a single-call isolated data sandbox (`POST /action/trial`) and record the trial receipt for the current canonical digest |
| `action publish <id>` | Publish through the owner (`POST /action/setStatus`) once both the current code explanation and a passed trial for the current digest are present |
| `metric-view publish <id>` | Read the definition, set `status` to `PUBLISHED`, save and read it back |
| `metric-view delete <id>`, `action delete <id>` | Delete the interface |

Prefer an existing interface. To create one, read `context` for its kind and write the definition yourself.

For a MetricView, embed an `OPERATION_READ` Function with a complete `queryPackage`. When editing, start from `metric-view get` and carry the actual bindings you intend to keep. Run `metric-view generate` with that definition so Java tests the query package and bindings; pass `--save` only when authorized to persist the accepted definition.

For an Action, embed an `OPERATION_WRITE` Function with the Python protocol and explicit typed parameters described by the owner, and follow the single three-step lifecycle (`save` → `trial` → `publish`):

1. **Save draft (`action save`)**: saves immediately as `PENDING_REVIEW` without requiring a trial and generates the code explanation in the background. Omit `id` when creating; pass `id` only when updating an existing draft. Never publish by setting `status: "PUBLISHED"` through `/action/save`.
2. **Sandbox trial (`action trial`)**: single external trial entry (`POST /action/trial`) for an already saved Action. Supply `--sample` (`{objDatas, relDatas, vectorDatas}`) with sample rows for the target class and any classes the Action reads or writes, plus `--parameters` for runtime inputs; omitting `--sample` defaults to an empty sample (allowed for pure computation, refuses any data read/write and never touches live data). The server opens an isolated business-database sandbox, loads the sample, validates preconditions, executes the Action, records the receipt against the canonical digest `(domainId, codeHash, target {className, keyParameter}, parameters [{name, type, classNames}])`, and closes the sandbox automatically. Changing code, target class/key parameter, or parameter declaration invalidates prior trials and requires re-running `action trial`; changing only trial parameter values does not. Common trial refusals: `ACTION_NOT_FOUND`, `ACTION_TRIAL_INVALID`, `ACTION_TRIAL_FORBIDDEN`, `ACTION_TRIAL_SANDBOX_UNAVAILABLE`.
3. **Publish gate (`action publish <id>`)**: check `action get <id>` for non-empty `codeSegments` matching the current `codeHash` and `trialStatus === "passed"` (`queryById` / `queryList` also return `trialStatusLabel`, `lastTrialAt`, `lastTrialError`, `publishBlockedCode`, `publishBlockedReason`). If the explanation is still pending, wait briefly or run `action re-explain --missing --id <id>`. Publishing checks the explanation first (`ACTION_EXPLANATION_REQUIRED`) and then the latest trial for the current digest (`ACTION_TRIAL_REQUIRED` when never run or stale after edits; `ACTION_TRIAL_FAILED` when the latest trial failed).

In an App Builder conversation, MetricView authoring and `action context` use the current run callback and the attached workspace's active build-test (`test start`). In the standalone suite, `metric-view generate` opens and closes its authoring window with the current user's credentials (pass `--workspace <id>` to bind that workspace's active build-test). Action `save`, `trial`, and `publish` use the same owner endpoints identically inside and outside the platform.

A definition without an ID creates an asset; with an ID it updates that asset. Use the returned ID, never a same-name search. A MetricView's `bindings` belong to that metric: omit them to preserve existing bindings, use `[]` to remove them. The retired GENERAL/STATIC `type` field is not accepted.

`metric-view execute <id> [<parameter JSON>] [--binding <id>]` reads data. `action execute <id> [<parameter JSON>] [--file <path> ...]` performs the business write; execute only within the authorized scope. Supply parameter values by the names in `function.parameters`. A binding supplies its saved values. Action files use multipart uploads. A vector parameter uses `{className, attrName, text, fileId, uploadFile}` as applicable; `uploadFile` is the zero-based file position. Vector writes use the platform's vector operations, not ordinary object insert/update.

## Agent delegation

In a platform conversation, use the native `agent` tool or `node "$SKILL/scripts/ontomato.mjs" agent <command>`.
The script uses the current run's authority, with the same build-test restrictions as the native tool.

## Build-test vector operations

`vector-upload <class> <attribute> <objectId> [--file <path>] --text <text or @file>` and `vector-delete <class> <attribute> <objectId> <path>` operate on an existing object's resources. Keep these writes within the requested business scope. Agent delegation and retrieval are unavailable in build tests.

## Command input and failure contract (5.0)

Positional names, IDs, paths, questions and descriptions are strings. Arguments shown without brackets are required; bracketed arguments are optional. JSON input is parsed once, without converting a JSON string to an object or taking the first member of an array. A missing field or wrong type fails with the owner's field name and correction; the command exits nonzero and preserves that message. An import can report per-item success/failure; check its `failures`, not just the HTTP status.

| Commands | JSON/body types and defaults |
| --- | --- |
| `schema`, `relationships` | At least one class name, sent as `classNames: string[]`. |
| `execute-dsl` | Required DSL JSON, using the DSL endpoint's documented syntax. |
| `function list/get/save/delete` | list filter defaults to `{}`; get/delete require an ID. save requires a Function object; READ uses queryPackage, WRITE uses Python v2 code. Parameter names/types/descriptions must have their declared JSON types. No boolean parameter type is added. |
| `metric-view generate` | Required authored MetricView definition JSON. Use `metric-view generate --save` to persist a tested MetricView. |
| `action trial` | Required saved Action `<id>`, optional `--sample <JSON or @file>` (defaults to empty sample, pure computation only) and optional `--parameters <JSON or @file>`. Calls `POST /action/trial` and exits non-zero if `passed === false`. |
| `action` / `metric-view` `find/get/save/publish/delete` | find requires a class, optional question defaults to omitted. get/publish/delete require ID. save takes the full definition object, with the embedded Function. Action save returns immediately as `PENDING_REVIEW` and generates its code explanation in the background; `action publish` requires both a current explanation (`ACTION_EXPLANATION_REQUIRED`) and a passed trial for the current digest (`ACTION_TRIAL_REQUIRED` / `ACTION_TRIAL_FAILED`). Confirm `codeSegments` and `trialStatus: "passed"` via `action get <id>` before publishing through `/action/setStatus`. MetricView publish retains its definition-save path. |
| `action` / `metric-view` `execute` | Required ID; JSON parameters default to `{}` only for zero-parameter assets. Every declared key must be present. Explicit null is accepted; `""` and `0` are preserved. Missing keys fail with `Missing parameter: <name>`. MetricView `--binding` supplies its complete saved parameter object and cannot be overridden. |
| `action re-explain` | Optional repeated IDs; `--missing` defaults false. Results identify individual failures. |
| `vector-upload`, `vector-delete` | Required class, attribute and object ID; upload requires text and optionally file, delete requires resource path. Vector fields are rejected by ordinary object insert/update. |
| `sdk current/read` | current has no body. read requires one file path relative to the current SDK release. |
| `component list/read/register` | list takes no arguments; read requires one `domain-component:<uuid>` ID; register requires a directory with `component.json`, `component.html` and optional `component.mjs`, plus `--revision <n>` when updating an existing component. |
| `panel check` | Requires an authoring directory. For a legacy root `--material` supplies registration JSON. `--sdk-dir` selects an installed SDK release for offline checks. The command reports structural errors, third-party UI/token violations (`el-*`, `v-loading`, `--el-*`, `element-plus`), and unresolved projection or `manifest.components` references without writing to the platform. |
| `workspace list/commits/sessions/tree` | Optional page/query JSON defaults to `{}`. IDs are required except for list. Page/query fields are checked by the workspace HTTP schema. |
| `workspace create/get/rename/delete/content/diff/restore` | Required string positional arguments listed above; content's omitted commit reads the working tree. No body defaults invent missing IDs or commits. |
| `workspace import` | Use a workspace ID, directory and explicit commit message to import a panel source tree. |


The platform injects the Python helper module when it executes a generated Action; it is not a file in this skill package. Read the Python protocol and helpers with `action context`; execute through the Action authoring or business API. Write helpers take object dictionaries and arrays of dictionaries. A where is a nonempty condition object, never a list; invalid conditions fail before object queries or vector/file cleanup. `appendVector`/`updateVector` require nonempty text; with fileBase64 omitted or null, Java explicitly stores that text as a UTF-8 attachment. With fileBase64 supplied, it must be base64 file bytes; text remains required for embedding. There is no empty-file fallback when both are missing.

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

Attachments are relative to that sample. Keep sample files in `test-data/`. In a hosted conversation, `test start`, `test status`, and `test stop` use the workspace bound to the session. Pass `--workspace <id>` to select it explicitly, including when running the CLI independently. No sample is collected from live data. A new start ends and cleans the previous context before preparing a fresh ID. Once a round has expired or ended, the user may also restart it from the notice in the preview: that is the same start, preparing the sample at the same path again as the workspace holds it now, so read `test status` rather than assume the context you started is still the current one.

Action/MetricView execute, execute-dsl, distinct-values and vector commands bind the workspace's current Java context once for that command. Missing, preparing, failed, ended or expired contexts fail; requests never switch to live data. Delegation in a build-test context is rejected with HTTP 422; it cannot dispatch live work. Metadata discovery and asset editing keep their existing APIs. Verify live behavior in the registered panel under the intended user permissions. A conversation ending does not stop its test context. An interface that does not declare test support refuses a headed request with BUILD_TEST_UNSUPPORTED; do not retry without the header. Definition reads, parameter forms and identity checks remain available.

`test status` and `test stop` succeed when the workspace has no test context, returning `{workspaceId, contextId: null, status: "NONE"}`. This is a normal absence result, not a failed request and not permission to use live data.
