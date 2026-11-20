# Build a panel application

Follow the [Product Layer and Application Composition Standard](https://infohub.eloyzh.de/o/standard-66842053) and the current SDK guide. Use current product records. Keep business logic and permission checks with the resource owners. Use the deployment, domain and authorized business scope already established with the user. Obtain technical names, IDs, parameters and relationships from the platform through its discovery commands and owner interfaces.

When planning how to bring an existing application onto the platform, start with the [application decomposition skill](references/app-standard/SKILL.md).

## Connection and workspace

Run `node <skill>/ontomato.mjs <command>`. JSON arguments accept inline JSON or `@file`; use `--lang <tag>` for the response language.

- Inside the platform, the runtime provides `ONTOMATO_WORKBENCH_URL`, `ONTOMATO_ONTOLOGY_URL`, the current credentials and `ONTOMATO_WORKSPACE_ID`. Edit the mounted `work/` directory directly. Do not import this directory back into itself, execute `git commit`, or write credentials into it. The runtime makes one commit after a changed run, using the first line of the user request; an unchanged run produces no commit.
- Outside the platform, set `ONTOMATO_URL` to the browser entry, including any deployment prefix. The public edition is anonymous. The enterprise adapter accepts `ONTOMATO_TK` or `ONTOMATO_API_KEY`, or the login configured in `application.yml`. Edit a complete local source tree, create a workspace, then import the tree with an explicit commit message.

A workspace is the application source tree. Business definitions remain in Java; do not copy them into it as a second source of truth. Keep downloaded documentation and scratch files outside the source tree. Errors are returned directly; report the actual cause and fix within the authorized scope.

## Panels and application uses

For a management page, start with the [complete example and wiring recipes](references/management-pages.md) or run `panel scaffold`.

1. Use `sdk read components.json` and `sdk read docs/components.md` to see the current release's official components and their inputs and outputs. Inspect the actual ontology resources, projections and application uses. Reuse existing records and ask the owner for any missing business capability or named read.
2. Write the Vue panel source. Declare its projections and public typed state in `panel.json` as `{manifest, content?}`. Use `recipes.md` for the assistant's common tasks and optional `content.messages` for translations. Use Vue's own state and events for local interactions.
3. Run `panel check <workspace directory>` to validate the layout, declarations and references.
4. Submit the selected projections, panels and application uses with `panel register`, then open the application's declared entry. Use an application ID and route you control.

When converting a platform page that needs a new owner read, operation or official component, use the [platform development examples](references/platform-development.md).

For instances of customer ontology classes, bind the detail to the owner's `record` read and use a registered Action for changes. For platform resources with owner-declared forms, use the corresponding form and save operation.

| Command | Result |
| --- | --- |
| `sdk read components.json` | Official components and ports in the current SDK |
| `panel projection <id>`, `panel get <id>` | Authorized current projection or panel, including its revision |
| `panel applications`, `panel uses <applicationId>` | Java navigation catalog and visible use relations |
| `panel scaffold <type> <new directory> [--id <application id>] [--operation <id>] [--batch <id>]` | Draft a Vue management panel from the type table. Select single and batch buttons by owner operation ID. |
| `panel check <directory> [--material <file>] [--sdk-dir <release directory>]` | Check the layout and declaration with the SDK parser, and resolve registered references using the current viewer's access. With an installed release directory, check offline and list unresolved references. |
| `panel register <directory> [--material <file>]` | Register a panel from its workspace sources, including its inline projections |
| `panel register <JSON or @file>` | Register selected current definitions and application uses under the author's permissions |

### Write projections inside the panel

In `panel.json`, put a new projection in `manifest.members.<key>.target.projection`. Use the same component,
named data, input and output declarations, operation bindings and config as a separately registered projection. Keep state bindings
on the member. For example, a member named `agents` can use this target:

```json
{
  "projection": {
    "componentId": "@ontomato/sdk:ObjectList",
    "data": {
      "rows": {"source": {"type": {"kind": "PlatformObjectType", "id": "platform:AgentDefinition"}}, "read": "list", "params": {}}
    }
  }
}
```

In `registration.json`, put one item in `panels`, with its `id`, `mode` and `input` containing `name`,
`description` and `visibility`. For updates, put the current panel `revision` on the item. Keep the manifest,
layout and instructions in the workspace files. Run `panel check <directory>` and `panel register <directory>`
with the same workspace and registration material.

The first successful projection write saves its ID as `target.projection.id` in `panel.json`. Keep that ID when
renaming or moving the member. Keep the existing ID in source when editing a projection already registered for this
panel. On creation, name and description default to the member key and the sharing scope follows the panel.
Registration uses the existing projection's revision when updating it. Other panels can reference the ID with
`target.projectionId`, subject to the usual projection permission.

Registration material has up to three arrays, `projections`, `panels` and `applications`. Each item is `{id,mode,input}` with `mode` set to `create` or `update`.

- For projections, `input` describes the official component, its inputs, outputs, named data and configuration. Build the named reads from the actual owner declarations for the target. Use the editable definition metadata `name`, `description` and `visibility`.
- For panels, `input` contains the workspace manifest and content, together with `name`, `description` and `visibility`. Use `panel.html` as `content.html`, any `recipes.md` as `content.recipes`, and carry any `content.messages` from the descriptor. The deployment supplies the current SDK.
- Projection and panel updates carry the owner-returned current `revision` on the item alongside `mode`. Creation omits it. Only the chosen records should appear in the material. Updating a shared definition affects every use of that record.
- Application `input` contains `entry: {path, renderer: "panels"}` and `panelUses`. Creation includes `declaration` and `entryAccess`. For a domain-member application, use `entryAccess: ["domain-member"]` and `access: {kind: "domain-member"}` on a use open to the domain. Each use has `id`, `pageKey`, `panelId`, `path` and `access`, with optional localized `names` and `defaultAgent`. Domain app paths start with `/applications/<applicationId>/`. Use the application's real `{permissionCode}` for a restricted use. When a use needs a default agent, use `defaultAgent: {kind: "id", id}` with its actual definition ID or `{kind: "preset", agentKind}` for an existing preset. An update replaces the use set, so preserve the uses required by the app. The platform owns built-in paths and derives skills from use access.

The command submits projections, panels and uses in that order. It prints each completed item and exits nonzero at the first failure. On a stale revision, compare the owner's current definition with the requested change before preparing a new update.

### Fix panel check and registration errors

Run `panel check <directory>` before registering. It reads `registration.json` in that directory by default.
Use `--material <file>` to select a different file. An online check looks for each referenced projection in
the material first, then in the current domain. `--sdk-dir` checks local material and reports any references
that still need an online check in `unchecked`.

- **404 `PRODUCT_UNAVAILABLE`** names a panel or projection that is missing in the current domain. When a
  projection is also absent from the material, `panel check` reports its ID before registration. Correct the
  reference or include the projection definition in the material. A panel save with a missing projection fails
  before saving that panel.
- **403 `PRODUCT_FORBIDDEN`** on an author lookup means an existing record requires a use Grant. Ask the
  record owner to grant access or choose a projection that the current author can use.
- **A field error** names the record ID and field and explains what to fix. For example, if `data` is missing
  from a projection, fill in `data` for that projection and run the check again.

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
