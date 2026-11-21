# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html`. Put the template inside `<div id="app">`. Place a
declared member with `<projection slot="detail"></projection>`. The slot names the key in `manifest.members`.
Use Vue attributes, events, `v-if` and `v-for` for
interactions. Adapt the layout to the container width. The host draws the page title and back control.
Panel CSS positions member containers. Design variables style components inside them.

Declare projections using the [member fields](FIELDS.md) and declare public typed state in `panel.json`.
Keep page-local state in Vue. An object state
such as `selected` stores `{className, primaryKey}`. Enable `deepLink` when the address should restore the selection.
For a page-header event with a `labelKey`, set `deepLink: true` on every state field the event changes so the
assistant can open the same state by address.
Use `recipes.md` for tasks the assistant needs to know how to do.

Use the required `panel.mjs` to mount the Vue page as in the [agent directory module](../../examples/vue-agent-directory/panel.mjs).
The platform runs panels directly. Read [runtime imports and setup](RUNTIME.md#imports-and-application-icons)
and the current SDK guide with `node "$SKILL/ontomato.mjs" sdk read docs/index.md`. For component behavior,
configuration and ports, use `sdk read docs/components.md`. The repository's
`packages/apps-sdk/src/panel/mount.ts` implements the legacy iframe runtime.

Use the platform’s interface components directly in the template: `<markdown-view>`, `<code-editor readonly>`
for code viewing, `<e-chart>`, `<table-preview>`, `<html-preview>` and `<form-fields>`. Import only `vue` and
`@ontomato/sdk/panel` in the module. For feedback after an operation, call
`usePanelContext().notify({ kind, text })` via the context captured in setup. For a message that stays on the page,
use `<el-alert>`.

For translations, put flat message keys under locale tags in `panel.json`'s `content.messages`. For example,
`{"en":{"panel.greeting":"Hello, {name}"}}` is a message table. Use `t("panel.greeting", { name })` in the
template and `usePanelContext().t` in `setup()`. The direct runtime supplies the template function.
Use the flat `panel.name` key for the panel title, for example
`{"zh-CN":{"panel.name":"治理报告"},"en":{"panel.name":"Governance report"}}`. The host uses an entry's menu name
when present. Otherwise it uses the panel name in the reader's locale, then the platform's default locale and the
name in `registration.json`. Keep the entry's menu metadata for entries that belong in the menu.

## Open a panel at a specific state

Choose the target fields marked `deepLink` and use the [address and child-state contracts](RUNTIME.md#state-in-an-address).
Run `node "$SKILL/ontomato.mjs" panel uses <destination-app-id>` to get the destination use's registered `path`.
Use its path with the encoded state on `usePanelContext().navigate`, captured during setup. The
[generated capability-map address example](RUNTIME.md#state-in-an-address) opens the type view at a selected class.
Give `URLSearchParams` raw JSON once. For a browser link in the workbench shell, put the same route after `#`.
See [open events and navigation](RUNTIME.md#open-events-and-navigation) when wiring a button to an entry.

## Read declared data

Before designing a view, inspect its read with `panel type <type-id> --read <name>`. For example, run
`node "$SKILL/ontomato.mjs" panel type platform:Action --read definition` for `actionDefinition`. Read its
`resultSchema` next to `result`, and use `params` and `requiredParams` for inputs. Omit `--read` to list the
type's reads and the operations with their effect, target, batch support and input schema.

Use the [generated member fields](FIELDS.md) to connect each component's named datum to an owner read and
its parameters. Bind an output by its port name in the short member's `state` map, with the declared panel
state field as its value. Place an official component when it fits the view. For a custom Vue view, choose `PanelData`
and consume each datum with [the SDK read hooks](RUNTIME.md#reads-and-operations) in synchronous setup,
before any `await`. Use the return states
to show loading, missing inputs, empty data, denied access or an error in the view. Read each ready value
according to the type table's result shape.

## Connect a graph and its relations

Run `node "$SKILL/ontomato.mjs" sdk read docs/components.md` and use the `OntologyGraph` and `ObjectRelations`
sections for each component's datum names, accepted result types, `config`, outputs and events. Inspect named
reads with `panel type <type-id> --read <name>`. Declare the shared [graph selection type](RUNTIME.md#graph-selection)
in `manifest.state`. In new members, map component ports to that field using the member's `state` map. For example,
`OntologyGraph` can write `selectedNode` and `ObjectRelations` can write `selected` to the same state field.

Mount the graph and list as `<projection slot="graph"></projection>` and
`<projection slot="relations"></projection>` when those are the member keys. Use the
[Vue setup reference](RUNTIME.md#vue-setup) for reads or actions added in page code.

## Select a child record and read from its parent

A knowledge governance question belongs to its report's `issues` collection. Use the
[child-object field and value shapes](RUNTIME.md#child-objects) for the question selection, and a separate report
object state for the parent's reads. Set the read member's `target` to the report state. The `issues` read
returns the report's questions, so the selected child's key identifies the row to display. For the report's
`sourcePage` read, bind the required `source` parameter to the selected source ID using
[the member data field](FIELDS.md). A link to a selected question carries both the report and question state.

## Invoke declared owner operations

Use the owner's full operation ID in the member declaration. Bind the target to the selected object or to a
checked list for an operation that supports batches. The official button uses the owner's label. For a custom
control, call the [SDK operation hook](RUNTIME.md#usepaneloperation) in synchronous setup and supply the fields from its admitted
`inputSchema`. The operation result comes through the same platform flow as the page header and assistant. For writes such
as save or delete, use only the platform's confirmation and impact details required by the owner.

## Save a form or hand off a draft

An `ObjectForm` projection binds one owner operation whose kind is `form.save`. The component sends `call.input`
with `values`, the `revision` from the owner form when present, and `submittedFields` as JSON Pointer strings.
Fields omitted from `submittedFields` remain unchanged.
A custom save control passes the same current form values through the [SDK operation hook](RUNTIME.md#usepaneloperation).

A populated object input edits that record. An empty input opens creation when the owner supports it and the
projection has the same type's `createForm` read. The successful create selects the returned object.

For child creation, use `ObjectForm.config.fixedFields` as shown in the current SDK guide
(`sdk read docs/components.md`). The owner validates these read-only field values at each save.

Keep the form mounted with `v-show` so it can receive drafts while the detail is open. The example watches
`instance.draft` to open the editor once its form has accepted a draft. Switch back to view mode on `saved` or
`discarded`. The save event carries the saved object as `{className, primaryKey}`. A failed save keeps the editor open.

```html
<projection slot="form" v-show="mode === 'edit'"
  @saved="mode = 'view'" @discarded="mode = 'view'"></projection>
```

For an assistant draft, first read the owner form and copy `save.draftOperation` into the artifact's `operation`.
Use the application's `pageKey`, the owner's object ID and only the changed field values in `form`:

```json
{
  "pageKey": "example-vue-agent-directory-manage",
  "operation": "platform:AgentDefinition.save",
  "target": {"id": "<selected agent ID>"},
  "form": {"name": "Review assistant"}
}
```

Use an empty `target` for creation. Publish the draft as a run artifact, such as `outputs/drafts/edit.page-draft.json`.
Append these query values to the panel's use path in the `#/...` portion of its address:

```js
const query = new URLSearchParams({
  draftSessionId: sessionId,
  draftRunId: runId,
  draftPath: "outputs/drafts/edit.page-draft.json",
});
const draftRoute = `#${usePath}?${query}`;
```

Use the session and run that wrote the draft, and pass the raw artifact path once to `URLSearchParams`.
See [draft links and instance state](RUNTIME.md#draft-links-and-instance-state) for when a form takes the draft.

For a chart from a dashboard card, declare `component: "MetricChart"` and `sourceCard: {dashboardId, cardId}`.
Connect the chart inputs in `state`. If the owner has not registered that card, `panel check` lists its inputs as
unchecked. `panel register` asks the card owner to register the chart and uses the returned projection ID.

## Open the page composer

Add a `ConversationEntry` member when the page needs a named assistant or opening line. Use the generated
[`agent` and `prefill` fields](FIELDS.md) and place the member with `<projection>`. The reader sends the message
from the opened composer.

## Register and open

Write each new projection directly in `manifest.members`. Run `panel check <directory>` and
`panel register <directory>` with the same `registration.json` metadata. Registration writes the projection UUID
as the member's `id` in `panel.json`. Keep it when rearranging or renaming the member. Use `target.projectionId`
to reuse an existing projection.

Start new application IDs with `app-`. Give every application use a `pageKey` unique within its domain.
For a trial app open to its domain, set `entryAccess: ["domain-member"]` and each public use's
`access: {kind: "domain-member"}`. For a restricted trial, declare a permission owned by that app, such as
`app:app-my-management-page:view`, and use it in `entryAccess` and `access.permissionCode`.
Set the use's localized `names` for the title beside conversations. The panel name supplies the fallback title.
Choose `declaration.icon` from the [platform icon IDs](RUNTIME.md#imports-and-application-icons).

Omit the use's `defaultAgent` for the general assistant in a trial. Set `{kind: "id", id}` or
`{kind: "preset", agentKind}` when that agent already selects this panel's skill and appears in the page
input box's candidates. Keep the general assistant while the preset's owner wires up its skill. When replacing
a built-in page, retain its existing default-agent behavior.

For an application delivery list, declare only extra `packages`, `agents` and `skills`. The platform derives the
panel and projection dependencies from registered uses.

Use the [agent directory example](../../examples/vue-agent-directory/panel.html) for the complete layout and owner
form wiring. Give your own panel and use their own IDs. The example opens at `/applications/app-example-vue-agent-directory/manage`.
Exercise the page and run the [assistant check](SKILL.md#check-the-assistant-from-the-page).

## When a panel looks wrong

Open the same registered entry without draft or state query parameters first. In the browser, keep the
Network log while reloading and read the first relevant failure and its response. Use the console's first
error for a Vue or module failure. Keep the browser's storage and cookies intact.

- **Blank panel or `panel-host-error`.** Start with the alert, console, the panel's
  `GET /api/product-panels/<id>` (or `/snapshot` on a recheck), and the SDK asset requests. Use
  `panel uses <app-id>` to verify the path and bound panel, `panel get <panel-id>` for its manifest and revision,
  and `panel projection <id>` for a member's registered definition. Compare with the workspace and run
  `panel check <directory>`. If the definition loads and the module fails, check the import rules, Vue template
  and member slots.
- **List is empty or waiting.** Find that member's `POST /api/product-panels/read` by `memberPath` and `dataName`.
  Compare `inputs` and `runtimeParams` with `panel type <type-id> --read <name>`. Missing required inputs can
  leave it awaiting with no request. If the owner returns no rows, check the selection, filters and reader's
  data access. If it returns rows, check the slot and the component's accepted result shape.
- **Draft does not fill or shows `Required`.** Inspect `GET /api/assistant/sessions/<session-id>/runs/<run-id>/page-draft?path=…`,
  then the form's `POST /api/product-panels/read`. Match the producing run and artifact, the entry's
  `pageKey`, and the target owner's `save.draftOperation`. A successful draft read confirms that the artifact
  loaded. Follow the form read's response to see whether the owner accepted the proposal. Keep the form
  mounted while waiting for `instance.draft`.

A field or path named by `panel check` points to the material to fix. For a rejected request, use its response
to distinguish missing records, denied access and invalid values. If the registered material matches the
current SDK and owner contract but a conforming request still fails, report the first failing response or console
error, entry and member IDs, panel revision and the release from `sdk current` to the platform or owner team.

## What the assistant receives

The platform builds page context from the registered entry's title and address and the current object and
child-object selections in declared panel state. A selection supplies the type and ID, including a child's
parent and collection, plus a display name when the page already knows it. The assistant uses the panel's
declared reads to obtain current fields for that selection.

Put page-specific instructions in `recipes.md` beside the panel files. Registration includes them as
`content.recipes`. The platform derives the panel skill from its declared reads, state, forms and operations
and these recipes. The composer sends the current registered use so the platform can admit that skill for the
reader. Verify this through the [page input box](SKILL.md#check-the-assistant-from-the-page).
