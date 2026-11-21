# Build a panel application

Follow the [Product Layer and Application Composition Standard](https://infohub.eloyzh.de/o/standard-66842053) and the current SDK guide. Use current product records. Keep business logic and permission checks with the resource owners. Use the deployment, domain and authorized business scope already established with the user. Obtain technical names, IDs, parameters and relationships from the platform through its discovery commands and owner interfaces.

Start with the [Vue panel skill and complete example](references/panel-authoring/SKILL.md). When planning how to
bring an existing application onto the platform, use the [application decomposition skill](references/app-standard/SKILL.md).

## Connection and workspace

Run `node <skill>/ontomato.mjs <command>`. JSON arguments accept inline JSON or `@file`; use `--lang <tag>` for the response language.

- Inside the platform, the runtime provides `ONTOMATO_WORKBENCH_URL`, `ONTOMATO_ONTOLOGY_URL`, the current credentials and `ONTOMATO_WORKSPACE_ID`. Edit the mounted `work/` directory directly. Do not import this directory back into itself, execute `git commit`, or write credentials into it. The runtime makes one commit after a changed run, using the first line of the user request; an unchanged run produces no commit.
- Outside the platform, set `ONTOMATO_URL` to the browser entry, including any deployment prefix. The public edition is anonymous. The enterprise adapter accepts `ONTOMATO_TK` or `ONTOMATO_API_KEY`, or the login configured in `application.yml`. Edit a complete local source tree, create a workspace, then import the tree with an explicit commit message.

A workspace is the application source tree. Business definitions remain in Java; do not copy them into it as a second source of truth. Keep downloaded documentation and scratch files outside the source tree. Errors are returned directly; report the actual cause and fix within the authorized scope.

## Panels and application uses

For a management page, start with the [complete example and wiring recipes](references/management-pages.md) or run `panel scaffold`.

1. Use `panel type <type-id>` for the owner's reads and operations. Use `sdk read docs/components.md` for each component's data, configuration, outputs and events in the current SDK. Inspect existing projections and application uses. Reuse existing records and ask the owner for any missing business capability or named read.
2. Write the Vue panel source. Declare its projections and public typed state in `panel.json` as `{manifest, content?}`. Use `recipes.md` for the assistant's common tasks and optional `content.messages` for translations. Use Vue's own state and events for local interactions.
3. Run `panel check <workspace directory>` to validate the panel source, declarations and references.
4. Submit the selected projections, panels and application uses with `panel register`, then open the application's declared entry. Use an application ID and route you control.

When converting a platform page that needs a new owner read, operation or official component, use the [platform development examples](references/platform-development.md).

Create short members from the reads listed by `panel type`. For customer ontology views backed by an existing projection, reuse its registered ID. Use the corresponding form and save operation for types that publish those declarations.

| Command | Result |
| --- | --- |
| `sdk read docs/components.md` | Current SDK component guide with data, configuration, outputs and events |
| `sdk read components.json` | The same current SDK's machine-readable component catalogue |
| `panel type <type-id> [--read <name>]` | Read signature with its result schema. With no filter, list the type's reads and operations. |
| `panel delete application\|panel <id>` | Delete a trial application or panel through its owner |
| `panel projection <id>`, `panel get <id>` | Authorized current projection or panel, including its revision |
| `panel applications`, `panel uses <applicationId>` | Java navigation catalog and visible use relations |
| `panel scaffold <type> <new directory> [--id <application id>] [--operation <id>] [--batch <id>]` | Draft a Vue management panel from the type table. Select single and batch buttons by owner operation ID. |
| `panel check <directory> [--material <file>] [--sdk-dir <release directory>]` | Check the panel source and declaration with the current SDK schemas, and resolve registered references using the author's access. With an installed release directory, check offline and list unresolved references. |
| `panel register <directory> [--material <file>]` | Register a panel from its workspace sources, including its inline projections |
| `panel register <JSON or @file>` | Register selected current definitions and application uses under the author's permissions |

### Write projections inside the panel

In `panel.json`, define each new projection directly in `manifest.members`. For the chosen official component,
open its section in `sdk read docs/components.md`. Use `panel type <type-id>` and `--read <name>` for the
owner's read signatures, result shapes and operations. A member uses the parts that apply to its component.

| What to fill | What registration derives and what to change |
| --- | --- |
| **Component.** Set `component` to the name in the SDK catalogue. | `componentId` is the qualified SDK identifier. Picking a different component changes its available data names, settings and ports. |
| **Data source.** Set `type` or connect the object state via `target`. For each component datum in `data`, choose an owner read with an accepted result and bind its read parameters as needed. | Stored `data` expands to names with `source`, `read` and `params`. The owner type, object target, read and bindings determine those fields. |
| **Component settings.** Use the component's Configuration section for `config` keys and values. | Stored `config` takes those settings. For a component with an operation setting, the tool derives `config.operation` from the selected owner's operation. |
| **Operation.** Use the type table's full `operation` ID. Set `target` for an object target and `draft` when the operation reads a form draft. | Stored `operations` identifies the owner operation and target. Where required, the placement gains `readOperationInputs` for its draft and parameters. Changing the operation or its bindings changes these fields. |
| **State connections.** Map the component ports and named read parameters to declared fields using `state`. | The tool derives projection `inputs` and `outputs` from the state types, selected owner type and component ports. Changing bindings or their types can change those fields and the member's placement connections. |

Run `panel projection <id>` after registration to inspect the resulting projection. Use the
[member field reference](references/panel-authoring/FIELDS.md) for the short form and its optional fields.

```json
{
  "component": "ObjectList",
  "type": "platform:AgentDefinition",
  "data": {"rows": "list"},
  "state": {"selected": "selected"}
}
```

In `registration.json`, put one item in `panels`, with its `id`, `mode` and `input` containing `name`,
`description` and `visibility`. For updates, put the current panel `revision` on the item. Keep the manifest,
layout and instructions in the workspace files. Run `panel check <directory>` and `panel register <directory>`
with the same workspace and registration material.

The first successful domain projection write saves its UUID as `id` on the member in `panel.json`. The tool
uses it as the registered member's `target.projectionId`. Keep it when renaming or moving that member.
New projections default `name` and `description` to the member key and take the panel's initial sharing scope.
Set a member's `name` or `description` explicitly to change those catalogue fields. Later sharing follows the
projection's grants. To reuse a registered projection, specify `target.projectionId`. Every use of a shared
projection sees its updates.

In `registration.json`, each panel or application item is `{id,mode,input}` with `mode` set to `create` or `update`.
For workspace registration, keep the panel definition in `panel.json`, `panel.html`, `panel.mjs` and optional
`recipes.md`. The tool sends the expanded projection and panel records.

- Projection and panel updates carry the owner-returned current `revision` on the item alongside `mode`. Creation omits it. Only the chosen records should appear in the material. Updating a shared definition affects every use of that record.
- Application `input` contains `entry: {path, renderer: "panels"}` and `panelUses`. Create with an ID starting with `app-`, plus `declaration` and `entryAccess`. For a domain-member application, use `entryAccess: ["domain-member"]` and `access: {kind: "domain-member"}` on a use open to the domain. Each use has `id`, `pageKey`, `panelId`, `path` and `access`, with optional localized `names` and `defaultAgent`. Domain app paths start with `/applications/<applicationId>/`. Use the application's real `{permissionCode}` for a restricted use. Omit `defaultAgent` to use the general assistant. To choose a default, use `defaultAgent: {kind: "id", id}` or `{kind: "preset", agentKind}` after that agent has selected the panel’s skill. An update replaces the use set, so preserve the uses required by the app. In `mode: "update"`, include `input.declaration` with any changed `names`, `descriptions` or `icon`. Registration reads the existing identity and writes it through the owner only when it differs. Omit identity fields to keep their current values. If you supply a localized map, supply its full set of translations. The platform owns built-in paths and derives skills from use access.

The command submits projections, panels and uses in that order. It prints each completed item and exits nonzero at the first failure. On a stale revision, compare the owner's current definition with the requested change before preparing a new update.

### Replace a built-in page

1. **Move the panel source.** Put `panel.json`, `panel.html`, `panel.mjs` and any `recipes.md` from the tested
   trial in the original page's owning package under `resources/builtin-panels/<directory>`. Keep one panel
   item in `registration.json` with a stable `builtin-product-` ID and its `input.name` and
   `input.description`. Application entries belong in the owning application's declaration.
   Remove trial projection IDs from inline members in the copied `panel.json` so the checker can allocate
   platform IDs. For reused projections, use a packaged projection ID or supply an inline definition
   backed by platform types and owner reads. Pass domain objects through the panel's runtime state.
   Use formal built-in addresses for internal links in `panel.html`, `panel.mjs` and `recipes.md`. The checker
   reports the file, line and column of any `/applications/app-…` address.
2. **Assign the projection IDs.** Point `SDK_RELEASE` to the installed SDK version directory containing
   `sdk.json`, and run the local check with the copied panel directory as `PANEL_DIR`:

   ```sh
   node "$SKILL/ontomato.mjs" panel check "$PANEL_DIR" --builtin --sdk-dir "$SDK_RELEASE"
   ```

   Commit the IDs written to `panel.json`. Preserve those IDs on later edits. The Workbench image build
   checks the built-in application entries against the bundled panels. Node registers the platform records
   from the bundle on startup.
3. **Switch the original entry and remove the old page in one change.** Add the use to
   `declaration.panelUses` in the owning app's declaration. Find Java-owned apps in the Java package's
   `src/main/resources/applications/` directory and Workbench-owned apps in
   `packages/workbench-server/src/services/applications/builtins.ts`. Keep the original `path` and
   `access.permissionCode`. Give the use its stable `id` and `pageKey`, and set `panelId` to the packaged panel ID.
   Carry over its menu name and default agent where present. Remove the old route registration, renderer
   and any page component and imports with no remaining callers. The panel use serves the original address.
   Keep the owner reads, operations and permissions used by the panel or by other entries.
4. **Verify and clean up the trial.** On 128 after deployment, open the original address with its existing
   permission and verify that the panel and its page skill work. With an account lacking the original
   permission, check that the entry denies access and that the owners deny reads and operations when the
   panel is used from another entry the account can open. Then delete the exact trial application and its
   trial panel using the commands below.

### Delete a trial application or panel

Delete a trial application first to remove its entry references. Then delete a panel by its exact registered ID.

```sh
node "$SKILL/ontomato.mjs" panel delete application <application-id>
node "$SKILL/ontomato.mjs" panel delete panel <panel-id>
```

The panel owner also removes editable projections used only by that panel and reports their IDs. A referenced panel
is protected by the owner's in-use check. Released or shared definitions stay under the owner's normal permissions.

### Fix panel check and registration errors

Run `panel check <directory>` before registering. It reads `registration.json` in that directory by default.
Use `--material <file>` to select a different file. The online check uses the current component catalogue and
owner type table to expand new projections. It looks for references in the material first, then in the domain.
With `--sdk-dir`, complete local material can be checked offline. New short members require the online type
table, and unresolved registered references appear in `unchecked`.

- **404 `PRODUCT_UNAVAILABLE`** names a panel or projection that is missing in the current domain. When a
  projection is also absent from the material, `panel check` reports its ID before registration. Correct the
  reference or include the projection definition in the material. A panel save with a missing projection fails
  before saving that panel.
- **403 `PRODUCT_FORBIDDEN`** on an author lookup means an existing record requires a use Grant. Ask the
  record owner to grant access or choose a projection that the current author can use.
- **A member error** identifies the declaration to fix. Check the component's catalogue entry, the owner's read
  or operation signature, and the state named in that member.

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
| `action generate [--save] --sample <JSON or @file> <definition JSON or @file>` | Prepare and reset an isolated sample, execute the Action, get the owner's explanation reference and return the accepted definition |
| `metric-view save <definition>`, `action save <definition>` | Save once and return the saved definition, including new IDs |
| `metric-view publish <id>`, `action publish <id>` | Read the full definition, set `status` to `PUBLISHED`, save and read it back |
| `metric-view delete <id>`, `action delete <id>` | Delete the interface |

Prefer an existing interface. To create one, read `context` for its kind and write the definition yourself. For a MetricView, embed an `OPERATION_READ` Function with a complete `queryPackage`. When editing, start from `metric-view get` and carry the actual bindings you intend to keep. For an Action, embed an `OPERATION_WRITE` Function with the Python protocol and explicit typed parameters described by the owner. Declare the classes and records needed for the Action in `--sample`. Java executes the Action in its own sandbox.

Run `generate` with that definition. Java checks the actual code or query package and effective parameters before accepting the result. Correct failed tests and submit the updated definition. Pass `--save` only when authorized to persist the accepted definition. Ordinary `save` remains available for human-authored edits. `action re-explain [--missing] [--id <id> ...]` refreshes an existing Action's explanation.

In an App Builder conversation, authoring uses the current run callback and the attached workspace's active build-test. Start one with `test start` before authoring. In the standalone suite, authoring opens and closes an explicit window with the current user's credentials. Pass `--workspace <id>` to use that workspace's active build-test. Without a workspace, standalone authoring uses the authorized live read scope and Action writes still go to its sandbox.

A definition without an ID creates an asset; with an ID it updates that asset. Use the returned ID, never a same-name search. A MetricView's `bindings` belong to that metric: omit them to preserve existing bindings, use `[]` to remove them. The retired GENERAL/STATIC `type` field is not accepted.

`metric-view execute <id> [<parameter JSON>] [--binding <id>]` reads data. `action execute <id> [<parameter JSON>] [--file <path> ...]` performs the business write; execute only within the authorized scope. Supply parameter values by the names in `function.parameters`. A binding supplies its saved values. Action files use multipart uploads. A vector parameter uses `{className, attrName, text, fileId, uploadFile}` as applicable; `uploadFile` is the zero-based file position. Vector writes use the platform's vector operations, not ordinary object insert/update.

## Agent delegation

In a platform conversation, use the native `agent` tool or `node "$SKILL/ontomato.mjs" agent <command>`.
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
| `action` / `metric-view` `generate` | Required authored definition JSON. Action also requires `--sample <JSON or @file>`. The command tests and accepts the definition. Pass `--save` to persist the accepted definition. |
| `action` / `metric-view` `find/get/save/publish/delete` | find requires a class, optional question defaults to omitted. get/publish/delete require ID. save takes the full definition object, with the embedded Function. publish saves that definition as PUBLISHED; it does not bypass asset admission. |
| `action` / `metric-view` `execute` | Required ID; JSON parameters default to `{}` only for zero-parameter assets. Every declared key must be present. Explicit null is accepted; `""` and `0` are preserved. Missing keys fail with `Missing parameter: <name>`. MetricView `--binding` supplies its complete saved parameter object and cannot be overridden. |
| `action re-explain` | Optional repeated IDs; `--missing` defaults false. Results identify individual failures. |
| `vector-upload`, `vector-delete` | Required class, attribute and object ID; upload requires text and optionally file, delete requires resource path. Vector fields are rejected by ordinary object insert/update. |
| `sdk current/read` | current has no body. read requires one file path relative to the current SDK release. |
| `panel check` | Requires an authoring directory. Optional `--material` supplies registration JSON and `--sdk-dir` selects an installed SDK release for offline checks. The command reports structural errors and unresolved references without writing to the platform. |
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

Attachments are relative to that sample. Keep sample files in `test-data/`. Start with `test start --workspace <id>` (the built-in agent already has ONTOMATO_WORKSPACE_ID); `test status` and `test stop` use the same workspace entry. No sample is collected from live data. A new start ends and cleans the previous context before preparing a fresh ID. Once a round has expired or ended, the user may also restart it from the notice in the preview: that is the same start, preparing the sample at the same path again as the workspace holds it now, so read `test status` rather than assume the context you started is still the current one.

Action/MetricView execute, execute-dsl, distinct-values and vector commands bind the workspace's current Java context once for that command. Missing, preparing, failed, ended or expired contexts fail; requests never switch to live data. Delegation in a build-test context is rejected with HTTP 422; it cannot dispatch live work. Metadata discovery and asset editing keep their existing APIs. Verify live behavior in the registered panel under the intended user permissions. A conversation ending does not stop its test context. An interface that does not declare test support refuses a headed request with BUILD_TEST_UNSUPPORTED; do not retry without the header. Definition reads, parameter forms and identity checks remain available.

`test status` and `test stop` succeed when the workspace has no test context, returning `{workspaceId, contextId: null, status: "NONE"}`. This is a normal absence result, not a failed request and not permission to use live data.
