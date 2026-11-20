# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html`. Put the template inside `<div id="app">`. Place a
declared member with `<projection slot="detail"></projection>`. Use Vue attributes, events, `v-if` and `v-for` for
interactions. Panel CSS positions member containers. Design variables style components inside them.

Declare named projections and public typed state in `panel.json`. Keep page-local state in Vue. An object state
such as `selected` stores `{className, primaryKey}`. Enable `deepLink` when the address should restore the selection.
Use `recipes.md` for tasks the assistant needs to know how to do.

In the required `panel.mjs`, import the SDK, read panel state from the current context and call `mountPanel`.
The platform runs all panels directly. The repository's `packages/apps-sdk/src/panel/mount.ts` implements the
legacy iframe runtime. Use this skill and the current SDK guide as the only authoring references. Read the SDK
guide with `node "$SKILL/ontomato.mjs" sdk read docs/index.md`.

```js
import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    return {
      selected: computed(() => instance.state.values.value.selected),
      clearSelection: () => instance.state.set("selected", null),
    };
  },
});
```

Bind the list's `state.selected` and the detail's `target` to the same public state. The list updates that state
when the reader selects a record. The example uses the list's Vue selection event to return to view mode.
Use `@click="clearSelection"` on a control that should clear both the detail and the list's selection.

To open another platform page, get `usePanelContext().navigate` in synchronous `setup()` and call
`navigate(address)` from a Vue event. Use a platform route such as `/agents/chat?agentId=…`. If navigation fails,
the host shows the reason and the Promise rejects with the same reason.

## Read declared data

Run `node "$SKILL/ontomato.mjs" panel type platform:AgentDefinition` to inspect an owner's reads and operations.
Each named read lists its parameter names, `requiredParams` and the ID of its result schema. Find the matching
schema under `resultSchemas`. Each operation lists its effect, target, batch support and input schema.

For example, these two members share the public `selected` state:

```json
{
  "list": {
    "component": "ObjectList",
    "type": "platform:AgentDefinition",
    "data": {"rows": "list"},
    "state": {"selected": "selected"}
  },
  "detail": {
    "component": "PanelData",
    "target": "selected",
    "data": {"record": "record"}
  }
}
```

Use `type` for a type-wide read and `target` to read the object in a state field. The tool derives port types from
the component catalogue, the owner type and read signatures. It uses explicit `data.<name>.params` bindings first,
then state connections with the same parameter name, then allowed runtime parameters. Use
`{"read":"counts","params":{"by":{"literal":"status"}}}` for a named literal and `{"state":"search"}`
to bind a parameter explicitly to state.

Use an official component when it fits the view. Place its projection with `<projection slot="list"></projection>`.
For a custom Vue view, set the member's `component` to `"PanelData"`. It supplies data for your Vue template to render. Name each datum in `data` and call `usePanelData` synchronously inside the
component’s `setup()`, before any `await`. The example’s `detail` member declares `data.record`.

```js
import { usePanelData } from "@ontomato/sdk/panel";

const detail = usePanelData("detail", "record");
```

Use one call per datum. Pass runtime parameter values, such as pagination, in an optional reactive object, ref or
getter. Use parameter names accepted by the declared read. The SDK applies the projection's inputs and reads
under the reader's identity. State or runtime parameter changes trigger a new read. An `awaiting` result means a
required value is missing and the SDK waits to send the request.

Render `loading` while the read runs, `awaiting` as a prompt for the required input, `ready` with its `value`,
`empty` with an empty state, `forbidden` with an access message and `error` with the returned `message`.
After a successful write, the platform re-reads affected objects and types reported by the owner.

## Invoke declared owner operations

Set a member's `operation` to the full owner operation ID. For a single-object button, point `target` at the
selected object. To approve checked objects, point it at the checked list and use an owner operation that
supports batches.

```json
{
  "component": "OperationButton",
  "operation": "knowledge.approve",
  "target": "selected"
}
```

The official button displays the owner's label. For a custom Vue control, call
`usePanelOperation(member, localName)` inside the component's synchronous `setup()`, before any `await`.
The local name is the final segment of the owner's operation ID.

```js
import { usePanelOperation } from "@ontomato/sdk/panel";

// Inside setup(), for the member named "review".
const { operation: approve, run: approveSelected } = usePanelOperation("review", "approve");
```

The reactive descriptor is `null` until the operation is available for the current target. Use its `label`
and `inputSchema` for the control. In the Vue template, disable the button with `:disabled="!approve"`.
Call `approveSelected(input)` to run the same operation as the page header and assistant. The host presents
confirmation when required. Show the returned owner result or the reason the call rejects.

## Save a form or hand off a draft

An `ObjectForm` projection binds one owner operation whose kind is `form.save`. The component sends `call.input`
with `values`, the `revision` from the owner form when present, and `submittedFields` as JSON Pointer strings.
Fields omitted from `submittedFields` remain unchanged.
For a custom save control, pass the same current form values:

```js
// Declare this in setup(), then call run from the save handler.
const save = usePanelOperation("form", "save");
await save.run({
  values: { name: "Review assistant" },
  revision: 4,
  submittedFields: ["/name"],
});
```

A populated object input edits that record. An empty input opens creation when the owner supports it and the
projection has the same type's `createForm` read. The successful create selects the returned object.

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

Pass the raw artifact path once to `URLSearchParams`. Opening the link fills the owner form for the reader to save.

## Register and open

Write each new projection directly in `manifest.members`. Run `panel check <directory>` and
`panel register <directory>` with the same `registration.json` metadata. Registration writes the projection UUID
as the member's `id` in `panel.json`. Keep it when rearranging or renaming the member. Use `target.projectionId`
to reuse an existing projection.

Start new application IDs with `app-`. Give every application use a `pageKey` unique within its domain. Set the use's localized `names` for the display
title beside conversations. Use `panel.name` as its fallback. For an application delivery list, declare only extra
`packages`, `agents` and `skills`. The platform derives panel and projection dependencies from registered uses.

Use the [agent directory example](../../examples/vue-agent-directory/panel.html) for the complete layout and owner
form wiring. Give your own panel and use their own IDs. The example opens at `/applications/app-example-vue-agent-directory/manage`.
Exercise a read, an owner save and a draft from the registered use.
