# Ontomato apps SDK {{version}}

Follow the Product Layer and Application Composition Standard when composing a panel application. Use the component
catalogue and contracts of the SDK release the platform serves.

Panel applications compose registered projections using the deployment's current SDK. Each projection binds a
universal component to a declared read function or write operation — never directly to raw business endpoints. A panel
provides layout, typed public state, wiring between projections, and optional recipes. The platform runs panels directly
and supplies the current data under the reader's permissions.

This directory is the one SDK release the platform serves, at `/apps-sdk/current/`. An upgraded platform serves its own
release there: every panel runs on the release of the platform that shows it.

## What is in this release

| Path | Content |
| --- | --- |
| `sdk.json` | The version, the product, the module files, the stylesheet, the check module and the versions of the libraries |
| `docs/index.md` | This guide |
| `docs/reference.md` | The API of every `@ontomato/sdk` module, generated from their sources |
| `docs/components.md` | Compact grouped overview of panel-usable components (one line each, linking to per-component pages) |
| `docs/components/<Name>.md` | Full single-page reference for one component (data ports, configuration, slots, events) |
| `docs/components/ui-primitives.md`, `docs/components/theme-tokens.md` | `<sdk-*>` UI primitives, `v-sdk-*` directives, and `--sdk-*` theme tokens |
| `components.json` | Machine-readable component, UI primitive (`uiPrimitives`, `uiDirectives`) and theme token (`themeTokens`) catalogue |
| `node/panel-check.mjs` | The platform's own panel validation module run by `ontomato panel check` before registration |
| `node/package-components.mjs` | The standalone Node tool that generates a component package's catalogue from its declared components and Vue source |

## Modules and panel template tags

A panel's module (`panel.mjs`) imports only `vue` and `@ontomato/sdk/panel`. Never import third-party UI libraries
(such as `element-plus`) or load remote scripts, styles, or fonts from the internet.

Use the platform's data-free interface components directly as template tags in `panel.html` (no script import needed):

- **Page header**: `<page-header>` (pure presentational header with `title`, `description`, `back-label`, `#actions`, and `:draft` wired to `usePanelFormDraft`).
- **UI primitives & directives**: `<sdk-*>` tags (`<sdk-button>`, `<sdk-input>`, `<sdk-dialog>`, `<sdk-drawer>`, `<sdk-tag>`, `<sdk-tabs>`, …) and `v-sdk-*` directives (`v-sdk-loading`, `v-sdk-infinite-scroll`, `v-sdk-popover`). See `docs/components/ui-primitives.md` for the full list.
- **Data-free display widgets**: `<markdown-view>`, `<code-editor readonly>`, `<e-chart>`, `<table-preview>`, `<html-preview>`, `<form-fields>`.

## Compose a panel

A panel is Vue page code — a template and scoped CSS (`panel.html`), a script (`panel.mjs`), a declaration
(`panel.json`), and optional `recipes.md` — run directly by the platform inside the application entry's content box.

### Boundaries

- **Hierarchy**: platform sidebar → application menu / frame (use the platform's default application menu; do not hand-author custom frame panels yet) → current entry panel → nested panels and components.
- **Display belongs to universal components**: choose official components and `config` from [the catalogue](components.md). Check first whether the owner's read matches an official component's data port, use default rendering or `config` next, and author a formal component only as a last resort.
- **Business logic belongs to the capability layer**: calculations, formatting rules, and judgments belong to MetricViews (reads), Actions (writes), or platform-owned reads — not panel scripts or templates.
- **Projections only bind read and write functions**: the platform provides generic read functions parameterized by object class (list objects of a class, get one object by ID — exposed via `panel type <class>`), MetricViews for filtered/calculated reads, Actions for writes, and platform built-in reads/operations for `platform:*` types. Until generic display components bind MetricView results, calculated MetricView displays use `MetricChart` (registered from a dashboard card).
- **Panels only lay out and wire**: panels read projection outputs (selection, counts, labels, draft status) to coordinate visibility, navigation, titles, or follow-up inputs. Panels do not read record fields directly or compute business values; unsaved form drafts do not count as ontology data.

| Workspace file | Content |
| --- | --- |
| `panel.html` | The Vue template inside `<div id="app">`, placing members with `<projection slot="…">`, plus optional `<style>` scoped to this panel |
| `panel.mjs` | The panel's Vue script, mounted with `mountPanel` |
| `panel.json` | `{manifest, content?, theme?, template?}`. Declare `manifest.state` and `manifest.members`, plus optional `content.messages` for multi-locale text |
| `recipes.md` | Optional task guidance for the page assistant |

```html
<div id="app" class="tasks">
  <page-header :title="t('tasks.title')" />
  <div class="tasks-body">
    <projection slot="list"></projection>
    <projection v-if="selected" slot="details"></projection>
  </div>
</div>
<style>
  .tasks { display: flex; flex-direction: column; min-height: 100%; }
  .tasks-body { display: grid; gap: var(--spacing-md); padding: var(--spacing-lg) var(--page-gutter); }
</style>
```

```js
import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    return { selected: computed(() => instance.state.values.value.selectedTask) };
  },
});
```

Declare `list` and `details` in `manifest.members` as inline members or existing `target.projectionId` references, and
map component ports and read parameters to declared typed state in `manifest.state`. Mark state that should restore from
the URL with `deepLink: true`. For multi-locale panels, store flat message keys under locale tags in `content.messages`
and read them with `t(…)`; single-locale panels may write UI text directly or use `content.messages`.

A member's component reports events on `<projection>` for the panel to handle. For example, an `ObjectForm` emits
`saved` with the saved object (`{ className, primaryKey }`) and `discarded` when edits are discarded:

```html
<projection slot="form" @saved="mode = 'view'" @discarded="mode = 'view'"></projection>
```

When a form opens under a parent context — such as creating an attribute under a selected class — fix parent-determined
fields with `ObjectForm`'s `config.fixedFields` keyed by JSON Pointer path, sourcing each from panel state
(`{"state": "selected", "path": "/primaryKey"}`) or a fixed value (`{"literal": "Device"}`). The form renders them
read-only, keeps them synced with state, and submits them on save for owner validation:

```json
{ "config": { "fixedFields": { "/className": { "state": "selected", "path": "/primaryKey" } } } }
```

### Coordinate with declared outputs and operations

Prefer component outputs and events (`@saved`, `@navigate`, `usePanelOutput`, `usePanelOutputs`, `usePanelFormDraft`,
`state` bindings) to coordinate visibility, selection, navigation, and text-only slots. When a panel needs a
non-rendering member strictly to declare non-UI operations invoked through `usePanelOperation(member, name, options?)`
in synchronous `setup()`, use `@ontomato/sdk:PanelData`. Do not use `PanelData` to render business record fields in
`panel.html`.

```js
import { watch } from "vue";
import { mountPanel, usePanelContext, usePanelOperation, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const detailStatus = usePanelOutput("detail", "status");
    watch(detailStatus, (status) => {
      if (status === "empty") instance.state.set("selected", null);
    });
    const approve = usePanelOperation("review", "approve");
    return { approve };
  },
});
```

`usePanelOutput(member, name)` and `usePanelOutputs(member)` subscribe to declared read-only outputs published by a
projection's component or owner read (such as `status`, `label`, `total`, `filteredCount`, `dirty`, or owner-declared
scalar outputs).

`usePanelOperation(member, name, options?)` returns `{ operation, state, running, dispatching, run }`. `operation` is the
owner's description while currently admitted (otherwise `null`), and `run(input?)` runs the operation through the
platform's confirmation and permission flow. By default (`options.entry !== false`), calling `usePanelOperation` in a
component's synchronous `setup()` registers a mounted page action entry so custom buttons, switches, or menu items share
availability (`available`, `disabled`, `busy`), input normalization (`prepareInput`), confirmation verification, and
settlement (`onSettled`, `onError`) between human clicks and agent `page_action` calls. Pass `{ entry: false }` only
for non-UI automated background flows (such as credential renewal on mount).

To navigate to another registered entry (such as a separate detail entry built with `panelAddress("/path", { selected: id })` or `/agents/chat?agentId=…`),
call `usePanelContext().navigate(address)`. To show transient feedback ("Saved", "Exported", or an error), call
`usePanelContext().notify({ kind: "success" | "info" | "warning" | "error", text })`. Never call business HTTP endpoints
directly from panel code.

Run `ontomato panel check` on the workspace directory before registering, then register with `ontomato panel register`
and open the declared application entry.
