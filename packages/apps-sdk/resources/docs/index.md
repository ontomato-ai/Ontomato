# Ontomato apps SDK {{version}}

Follow the [Product Layer and Application Composition Standard](https://infohub.eloyzh.de/o/standard-66842053) when composing a panel application. Use the component catalogue and contracts of the SDK release the platform serves. The hosted ProductAsset and frozen release examples below apply to maintenance of existing hosted applications.

Panel applications compose registered projections using the deployment's current SDK. Each projection names its
owner-provided data and operations. A panel provides the layout, typed state and optional recipes. The platform renders
a panel without a module directly and supplies the current data. For maintenance of an existing hosted source application,
see [Page skeleton](#page-skeleton).

This directory is the one SDK release the platform serves, at `/apps-sdk/current/`. An upgraded platform serves its own
release there: every page and panel runs on the release of the platform that shows it.

## What is in this release

| Path | Content |
| --- | --- |
| `sdk.json` | The version, the product, the module files, the stylesheet, the check module and the versions of the libraries |
| `docs/index.md` | This guide |
| `docs/reference.md` | The API of every `@ontomato/sdk` module, generated from their sources |
| `components.json`, `docs/components.md` | Base components and their ports for this exact SDK |
| `node/panel-check.mjs` | The platform's own declarations of panel sources, as one Node module: a check of a panel's declaration and projections before it is registered runs these |
| `docs/element-plus.web-types.json` | Element Plus's own metadata for every component of the bundled version: attributes, events, slots |
| `examples/basic.html` | Platform context, Element Plus, a chart in the platform's theme, a Markdown text, a CSV text in the code editor previewed as a table, and an HTML document in a sandboxed frame |
| `examples/metric-action.html` | A published MetricView in a table and a chart, or its result as read-only JSON, the selected row as page context, then an Action through its form and a fresh read through the template ref of `<metric-view-data>` |
| `examples/chat.html` | A conversation with one of the platform's agents |
| `examples/product-asset.html` | Embed and reload an existing shared product asset in a custom app |

## Modules

| Import | Content |
| --- | --- |
| `vue` | Vue, the build with the template compiler; the only Vue of the page |
| `element-plus` | Element Plus, complete: the default export installs every component, the named exports include `ElMessage`, `ElMessageBox` and `ElLoading` |
| `echarts` | ECharts, complete, for the helpers an option uses: `import * as echarts from "echarts"`. Draw with `<e-chart>` |
| `@ontomato/sdk` | `connectAppContext()`, the MetricView and Action clients, and `<metric-view-data>` |
| `@ontomato/sdk/chart` | `EChart`, `<e-chart>`: the chart the platform draws its own charts with |
| `@ontomato/sdk/markdown` | `MarkdownView`, `<markdown-view>`: Markdown as the platform reads it |
| `@ontomato/sdk/form` | `FormFields`, `<form-fields>`: a form as its owner declares it, such as an Action's, and `formFieldKey` |
| `@ontomato/sdk/code` | `CodeEditor`, `<code-editor>`: code and structured text such as JSON, editable or read-only |
| `@ontomato/sdk/preview` | `TablePreview`, `<table-preview>`: a table of text cells, with `parseCsv` for CSV and TSV; `HtmlPreview`, `<html-preview>`: an HTML document in a sandboxed frame |
| `@ontomato/sdk/chat` | The platform's conversation components, `createAssistantClient` and `useShellLabels` |
| `@ontomato/sdk/panel` | `definePanel`, `mountPanel` and `Projection` for the panel host |
| `@ontomato/sdk/graph` | `G6GraphCanvas` and `OntologyGraph`: interactive G6 graphs; large, so import only where a page draws one |

The chart, Markdown, form, code and preview components are the ones the platform's own pages use, so an app looks and
behaves like them. Import each module where the page needs it; a page loads only the modules it imports.

The versions of Vue, Element Plus and ECharts are in `sdk.json`. Use only these modules: the page must not load
scripts, styles or fonts from the internet, because many installations have no internet access.

## Compose a panel

A panel is page code — a Vue template, its style and its script — and a declaration of the projections it uses and the
state it makes public. The platform runs the panel's code in its own page.

Choose official components and ports from [the catalogue](components.md). A projection names an owner read, its
source and parameters, and the component which renders the result. Map each member's inputs and outputs to the
panel's typed state. Mark state intended for the address with `deepLink`. Keep business rules in the owning capability.

| Workspace file | Content |
| --- | --- |
| `panel.html` | The page: the Vue template inside `#app`, placing members with `<projection slot="…">`, and an optional `<style>` that applies inside this panel only |
| `panel.mjs` | The page's script: its component, mounted with `mountPanel` |
| `panel.json` | `{manifest, content?}`. Use `manifest.members` for the members and `content.messages` for optional translations |
| `recipes.md` | Optional task guidance |

```html
<div id="app" class="tasks">
  <h2>{{ t("tasks.title") }}</h2>
  <projection slot="list"></projection>
  <projection v-if="selected" slot="details"></projection>
</div>
<style>
  .tasks { display: grid; gap: 16px; }
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

Declare `list` and `details` in `manifest.members` with the actual `target.projectionId`, and give typed inputs for the
declared owner read, such as the state that selects an object. The panel's own code reads and sets public state with
`instance.state`, and runs a member's operations with `usePanelOperation` (below). Use the deployed component
catalogue to check which fields the component exposes. For translations, use locale tags, flat message keys and named
placeholders such as `{name}` in `content.messages`; the template reads them with `t(…)`.

A member's component tells the page what happened through its events, which the template listens to on
`<projection>`; what the page shows next is the page's code to decide. An `ObjectForm` emits `saved` with the object it
saved or created, and `discarded` when the reader throws away what it held — for example, back to the details:

```html
<projection slot="form" @saved="mode = 'view'" @discarded="mode = 'view'"></projection>
```

A form the page opens under a parent — a new attribute in the class it shows, a relationship from its two ends — fixes
the fields that parent decides. The owner's form does not know which page it is in and may offer them as choices, so
the page names them in the `ObjectForm` projection's `config.fixedFields`, by the owner's JSON Pointer path, each from a
field of the panel's state (`{"state": "selected"}`, the value it holds; add `"path"`, a JSON Pointer into that value,
to take a part of it, such as an object reference's `/primaryKey`) or a value written there (`{"literal": "Device"}`).
The form shows them read-only, follows the state they come from, and submits them with every save; the owner checks
them as any other value. While the state holds nothing (no class chosen), the field is the owner's to edit as usual:

```json
{ "config": { "fixedFields": { "/className": { "state": "selected", "path": "/primaryKey" } } } }
```

### Draw a part yourself

When no official component draws a part the way the page needs, the panel draws it itself. Declare a member whose
projection uses `@ontomato/sdk:PanelData`: it draws nothing and takes any data the projection names, under names of
your choosing. Read each datum in the page's code with `usePanelData(member, name)`:

```js
import { computed, ref } from "vue";
import { mountPanel, usePanelData, usePanelOperation } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const cursor = ref(null);
    // The member's `rows` datum (an owner's query), with the cursor and page size as the page's own run-time values.
    const rows = usePanelData("board", "rows", () => ({ cursor: cursor.value, size: 20 }));
    const items = computed(() => (rows.value.status === "ready" ? rows.value.value.rows : []));
    const next = () => { cursor.value = rows.value.value?.nextCursor ?? null; };
    // The operation acts on the object the member's target input is bound to in the panel's state.
    const approve = usePanelOperation("board", "approve");
    return { rows, items, next, approve };
  },
});
```

`usePanelData` reads the way every member's data is read: by the projection's read and its mappings, through the
platform, as the reader. It answers `loading`, `awaiting` (an object or a required parameter has no value yet; nothing
is read), `ready` with `value`, `empty`, `forbidden` or `error` with `message`. It reads again when the panel state the
member binds changes, when the run-time values you pass change, and when an operation reports that what it shows
changed. Values you pass yourself are run-time parameters, which the platform checks against the catalogue and the
read.

The member's operations are the ones its projection names under `operations.<name>`. Run one from the page's code
with `usePanelOperation(member, name)`, called in setup like `usePanelData`: its `operation` is the owner's description
while the owner admits it now — an action on an object once the object is chosen — and `null` otherwise, and `run(input?)`
runs it exactly as the page's header and an agent do (a write is confirmed where its owner asks; a read answers what it
read, or saves the file it sent):

```js
const approve = usePanelOperation("board", "approve");
// <el-button :disabled="!approve.operation.value" @click="approve.run()">{{ approve.operation.value?.label }}</el-button>
```

To open another of the platform's pages, call `usePanelContext().navigate(address)` with an address such as
`/agents/chat?agentId=…`; when the platform cannot open it, the page says why and the call rejects with that reason.
Never call the platform's business endpoints from the page.

Run the App Builder skill's `ontomato panel check` on the workspace directory. It uses the current release's
declarations. Register the requested projections, panel and application uses through their owners, then open the
application's declared entry.

## Page skeleton

Put the stylesheet and the import map of the platform's SDK into the page's `<head>`, before any module script:

```html
{{head}}
```

The paths start at the platform's root. When the platform is deployed under a path prefix, such as `/wenshu`, every
`/apps-sdk/...` path starts with that prefix: take it from `sdkBasePath` of `GET /api/apps-sdk/current`, which is
`/wenshu/apps-sdk/current`. A hosted application's page is published with these links, so it always loads the SDK of
the platform that serves it.

The stylesheet gives the page the platform's text and background: its font, size, line height, text colour and page
background, in both the light and the dark theme. Don't set them on `body` again; style only what is your page's own.

The platform may float its own controls over the foot of the page: in the builder's full preview, the composer covers
its bottom. Once the app context connects, the stylesheet keeps that much room after the page's content, so its end
scrolls clear. A page whose content scrolls inside its own container instead puts the platform's class on that
container: it adds the room after the container's content, and adds nothing when nothing floats over the page.

```html
<div class="results shell-dock-room">…</div>
```


```html
<div id="app" v-cloak>
  <el-button type="primary" @click="count++">Clicked {{ count }} times</el-button>
</div>
<script type="module">
  import { createApp, ref } from "vue";
  import ElementPlus from "element-plus";
  import { connectAppContext } from "@ontomato/sdk";

  const context = await connectAppContext();
  createApp({ setup: () => ({ count: ref(0) }) }).use(ElementPlus).use(context).mount("#app");
</script>
```

Templates written in HTML follow the browser's rules before Vue reads them:

- Close every component tag: `<el-table-column prop="name"></el-table-column>`, never `<el-table-column />`.
- Write component names, attributes and events in kebab-case: `<metric-view-data :metric-view-id="id">`,
  `@row-click="select"`.
- Bind everything that is not a plain string with `:`, such as numbers, booleans, arrays, objects and functions.
- Hide the template until Vue has mounted it with `v-cloak` and `[v-cloak] { display: none; }`.

## The platform context

### Reuse product assets before custom source

Pages expressible as product assets are edited as the same assets by people and Agents. Custom source is for additional interaction and can embed the platform's current renderer:

```html
<product-asset :context="context" asset-id="actual-product-id" :revision="refreshRevision"></product-asset>
```

Import `ProductAsset` from `@ontomato/sdk` and register it in the Vue app's `components`. Pass the context returned by `await connectAppContext()`. `asset-id` references an existing asset; changing `revision` remounts the pinned definition. Declare all such IDs in the committed `ontomato.products.json`. In sandbox applications the shell renders the product in a platform-owned container aligned with the SDK placeholder. Published child revisions remain frozen until an explicit release upgrade. The component reports unavailable assets and unsupported hosts rather than substituting another page.

Product embedding is live-only. A build-test preview rejects the mount before rendering, so it cannot fall back to real data; use authoring commands for asset changes and a published app for embedding verification. `context.mountProductAsset(element, id)` is the equivalent imperative API and returns a disposer that must run before removing its container.

`await connectAppContext()` connects the page to the shell through a transferred message port. New published source apps run in an opaque sandbox and cannot read the shell's DOM or credentials. Call it once before creating the Vue app. The synchronous `createAppContext()` remains for compatible same-origin previews. `app.use(context)` installs the platform's words, Element Plus's language and the
`<metric-view-data>` component.

- `context.locale` and `context.theme` follow the platform while the app is open. The SDK keeps `<html lang>` and the
  `dark` class of `<html>` in step, and Element Plus, `<markdown-view>` and `<code-editor>` follow both. Use Element
  Plus's CSS variables, such as `var(--el-bg-color)` and `var(--el-text-color-primary)`, for your own styles, so they
  follow too.
- `context.chartTheme` is the theme the platform's own charts are drawn in, for the mode it shows now: give it to every
  `<e-chart>` and the chart follows the platform's light and dark themes.
- `context.user` is the signed-in user, for display only. It is `null` in the open-source edition.
- Every request carries the current user's credential; the open-source edition sends none. The server decides every
  permission: an app sees and changes only what its user may. When the sign-in expires, the shell takes over.
- `context.navigate(path)` opens a platform page in the shell, such as `context.navigate("/ontology/assets/metrics")`.
- `context.setPageContext({ page, selection })` tells the platform what the reader looks at; see the next section.
- `context.products` reads and edits the same product assets as the Manager and App Builder. `list()`, `get(id)` and
  `home()` return assets; `save(id, {name, description, visibility, document}, revision)` creates at revision 0 or updates
  an existing revision. `copy(id, name)` creates a private copy, `useHome(id, homeRevision)` applies a page/template and
  `delete(id, revision)` refuses assets in use. Discover the current asset document before editing; business logic stays
  in published MetricViews and Actions. A shared component uses the reader's identity and grants no data access.
  These authoring calls are unavailable in a build-test preview. Navigate to `/products/<pageAssetId>` to render a
  declarative page in the platform's shared runtime.
- An app reaches the platform only through the SDK: `context.metricViews` to read, `context.actions` to change data and
  `createAssistantClient(context)` for conversations. Other platform paths are internal and change between versions.

## What the reader looks at: page context

`context.setPageContext({ page, selection })` tells the platform which page of the app the reader is on and which
business object they selected on it. Where the platform shows the app beside its agent, such as the app builder's
preview, the reader's messages carry it, so "this order" or "this row" in a request means that object. Elsewhere,
a published app included, the call has no effect, so an app calls it the same way everywhere.

- `page` is the app's own name for the page in view, as the reader sees it: its title, or the label of the open tab.
- `selection` is `null`, or the selected object: `className` is its ontology class by the class's name, `primaryKey`
  its primary key as text, and `name` what the reader calls it, such as an order number.

Call it when the page starts, with `selection: null`; when the reader moves to another page of the app; and whenever
they select an object or clear the selection. It throws a `TypeError` unless `page` and every field of `selection` are
non-empty strings, so pass a number as `String(value)`.

```js
const PAGE = "Overdue orders";
context.setPageContext({ page: PAGE, selection: null });

// The table's row-click handler: a second click on the selected row clears the selection.
function toggle(row) {
  selected.value = selected.value === row ? null : row;
  context.setPageContext({
    page: PAGE,
    selection: selected.value && { className: "Order", primaryKey: String(row.id), name: row.orderNo },
  });
}
```

`examples/metric-action.html` reports the row selected in its table.

## Reading data: published MetricViews

An app reads business data only through published MetricViews. The platform's ontology service lists them under Metric
Views, with each one's id, parameters and the shape of its result.

```js
const rows = await context.metricViews.read({ id: "<MetricView id>", parameters: { region: "East" } });
```

`parameters` are merged over the defaults the MetricView declares, so `{}` reads it with its defaults. The result is what
the MetricView returns, often an array of row objects. A result the data engine could only return in part is an error,
never a silent partial list.

`<metric-view-data>` binds a MetricView by property. It reads when it appears and again whenever the id or the values of
the parameters change. It draws nothing itself, and hands one state, `data`, `loading`, `error` and `reload`, to two
places:

- The template draws from its default slot: put a table, a chart or a figure in it, and show `error` yourself.
- The page's script reaches the same state through a template ref. `reload()` on the ref reads the MetricView again,
  such as after an Action changed the data, wherever the Action's form is on the page; `data`, `loading` and `error` on
  the ref are the slot's values, so the script needs no copy of its own.

The `parameter-texts` property accepts user-entered text that the platform converts according to each parameter's type;
invalid text fails that read with the platform's error message.

```html
<metric-view-data ref="orders" :metric-view-id="metricViewId" :parameters="{ region }"
  v-slot="{ data, loading, error }">
  <el-alert v-if="error" type="error" :title="error.message" :closable="false"></el-alert>
  <el-table v-else v-loading="loading" :data="data ?? []">
    <el-table-column prop="name" label="Name"></el-table-column>
  </el-table>
</metric-view-data>
```

```js
setup() {
  const orders = ref(null); // Vue fills it through ref="orders"
  async function execute(parameters) {
    await context.actions.execute({ id: ACTION_ID, parameters });
    await orders.value.reload();
  }
  return { orders, execute };
}
```

## Changing data: Actions

An app changes business data only by executing Actions. The platform's ontology service lists them under Actions, with
each one's id and parameters.

```js
await context.actions.execute({ id: "<Action id>", parameters: { orderId: "SO-1001", quantity: 4 } });
```

Name every parameter the Action declares and give each value its declared type: a number as a number, a list as an
array. The server checks the user's permission and the values again, and the promise rejects with its message when it
refuses. Afterwards, read the MetricViews that show the changed data again: in the script that executed the Action,
call `reload()` on the template ref of each `<metric-view-data>` that shows it.

### An Action's form

Where the reader fills in the parameters, let the Action's own form ask for them: the data engine decides which fields
an Action has and how the text typed into them becomes typed values, and `<form-fields>` from `@ontomato/sdk/form`
draws them as the platform's own pages do. Do not build the inputs yourself.

1. `context.actions.form({ id })` answers `{ fields, values }`: the fields in order and the text they start with. Pass
   `parameters: { orderId: "SO-1001" }` to start fields with values the page already knows, such as the selected row's
   key, and `readOnlyParameters: ["orderId"]` for those the reader sees but does not change; give the same names to
   `<form-fields>` as `read-only`.
2. Draw the fields inside `<el-form label-position="top">` and keep what they hold as the page's state: `input` gives a
   field's key and its new text, `choose` the field and the chosen value.
3. On submit, `context.actions.form({ id, values })`, with the same `parameters` and `readOnlyParameters` as on opening,
   answers what the fields hold: either `errors`, each naming its field by a pointer such as `/values/quantity`
   (`formFieldKey(error.field, "/values/")` is the key), or the typed `parameters`.
4. With `parameters`, `context.actions.execute({ id, parameters })` executes the Action.

```html
<el-form label-position="top" @submit.prevent="submit">
  <form-fields :fields="fields" :values="values" :errors="errors" :disabled="busy" choose-placeholder="Choose"
    @input="(key, value) => (values[key] = value)" @choose="(field, value) => (values[field.key] = value)">
  </form-fields>
  <el-button type="primary" native-type="submit" :loading="busy">Execute</el-button>
</el-form>
```

```js
import { FormFields, formFieldKey } from "@ontomato/sdk/form";

const form = await context.actions.form({ id: ACTION_ID, parameters: { orderId: row.id } });
fields.value = form.fields;
values.value = { ...form.values };

async function submit() {
  const answer = await context.actions.form({ id: ACTION_ID, parameters: { orderId: row.id }, values: values.value });
  errors.value = Object.fromEntries(answer.errors.map((error) => [formFieldKey(error.field, "/values/"), error.message]));
  if (answer.parameters) await context.actions.execute({ id: ACTION_ID, parameters: answer.parameters });
}
```

`examples/metric-action.html` executes an Action through its form.

## Charts

`<e-chart>` from `@ontomato/sdk/chart` draws a chart the way the platform draws its own. It draws the ECharts option it
is given in the theme it is given, creates the chart when it appears, follows the size of its element, applies every
new option and theme, and disposes of the chart when it goes away. The page only builds the option.

```html
<e-chart :option="option" :theme="chartTheme" :height="300"></e-chart>
```

```js
import { EChart } from "@ontomato/sdk/chart";

createApp({
  components: { EChart },
  setup() {
    const rows = ref([]);
    const option = computed(() => ({
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: rows.value.map((row) => row.region) },
      yAxis: { type: "value" },
      series: [{ type: "bar", name: "Orders", data: rows.value.map((row) => row.orders) }],
    }));
    return { option, chartTheme: context.chartTheme };
  },
}).use(ElementPlus).use(context).mount("#app");
```

- `option` is a complete ECharts option, and each new object redraws the chart: compute it from the data.
- `theme` is `context.chartTheme`, the platform's chart colours in its current mode; with it the chart follows the
  platform's light and dark themes. Do not set colours of your own unless a series means a fixed colour.
- The theme keeps the category labels readable by itself: it hides a label that would run into its neighbour, and it
  gives each label the space its slot has, so a roomy chart keeps every name whole. Give the option the categories and
  their values; do not set `axisLabel` yourself unless one axis needs a rule of its own, and never set its `interval`
  to `0` to force every label out, because the long ones then run into each other.
- When the names are long and the slots really are narrow, change the chart rather than force the labels: a horizontal
  bar chart (`yAxis` holds the categories, `xAxis` the values) gives each name a whole row, and a label that still needs
  cutting gets it from the chart's own rule: `axisLabel: { width: 120, overflow: "truncate" }` for an ellipsis, or
  `axisLabel: { formatter: (name) => name.replace(/(.{8})/g, "$1\n") }` to wrap it. Set that only on the chart whose
  slots need it, with the width of its own bars in mind.
- `height` is in pixels or any CSS length; the width follows the element's container.

Import `echarts` itself only for helpers an option needs, such as `new echarts.graphic.LinearGradient(...)`, never to
create a chart.

## Markdown

`<markdown-view>` from `@ontomato/sdk/markdown` draws a Markdown text as the platform reads it everywhere: GitHub
Flavored Markdown, a single line break stays a line break, raw HTML shows as written rather than running. It follows the
light and dark themes by itself.

```html
<markdown-view :content="description"></markdown-view>
```

```js
import { MarkdownView } from "@ontomato/sdk/markdown";
```

Use it for text that is written in Markdown, such as a description a MetricView returns or a note on the page; labels
and values stay plain text.

## Code

`<code-editor>` from `@ontomato/sdk/code` edits code and structured text as the platform's own editors do: line
numbers, folding, highlighting for its language and wrapped lines. Read-only, the text can still be selected, searched
with Ctrl/Cmd-F and copied. It follows the light and dark themes by itself.

```html
<code-editor v-model="script" language="python" :min-height="200"></code-editor>
<code-editor :model-value="JSON.stringify(result, null, 2)" language="json" readonly :min-height="120"></code-editor>
```

```js
import { CodeEditor } from "@ontomato/sdk/code";
```

`language` is `javascript`, `json`, `markdown`, `html`, `python` or `text`. Without it the text is highlighted as
JavaScript, so give `text` for any other text, such as CSV. Use it for code and for data shown as written, such as a
JSON value, editable or read-only; never a textarea or a `<pre>`.

## Content preview

`@ontomato/sdk/preview` shows content as the platform previews files.

`<table-preview>` draws a table of text cells, `{ columns, rows }`, with Element Plus: cells keep their spaces and line
breaks, and columns of numbers align right. `parseCsv(text)` reads a CSV text into such a table, its first record as
the columns, and `parseCsv(text, "\t")` reads TSV. Given `page-size`, the rows come a page at a time with the total
beside the pager. Other attributes, such as `max-height` and `empty-text`, go to the Element Plus table.

```html
<table-preview :table="table" :page-size="20"></table-preview>
```

```js
import { TablePreview, parseCsv } from "@ontomato/sdk/preview";

const table = computed(() => parseCsv(csv.value));
```

Use it for text that is a table, such as CSV or TSV, rather than parsing it yourself. Rows a MetricView returns as
objects go straight into an `el-table`.

`<html-preview>` shows a whole HTML document in a frame. `sandbox` is required and states what the document may do:
`""` lets nothing in it run, `"allow-scripts"` runs its scripts apart from the page and the platform. Never add
`allow-same-origin` to `allow-scripts`: the document could then act on the platform as the reader. Give the frame its
height with a style.

```html
<html-preview :html="report" sandbox="" title="Report" style="height: 360px"></html-preview>
```

## Product releases, navigation and subscriptions

`context.mountProductAsset(element, assetId)` renders a dependency from the application's active release snapshot. Updating the asset in the editor does not upgrade an already published application.

Typed page navigation uses the target Page's declared ontology parameters:

```js
await context.navigate({pageId: "person-details", params: {selected: {className: "Person", primaryKey: "person-1"}}});
await context.navigate({objectViewId: "person-card", object: {className: "Person", primaryKey: "person-1"}});
```

The host validates values against the published Page or ObjectView and preserves the application identity. Page transitions follow the application's published Navigation when present. Object parameter paths expose only `className` and `primaryKey`.

Definition subscriptions are evaluated by the server. The callback receives a fired change event and performs a presentation effect:

```js
const stop = await context.subscribe(
  {kind: "definition", id: "my-alerts", parameters: {}, fields: ["id", "status"]},
  () => { metric.value?.reload(); },
  error => { subscriptionError.value = error.message; },
);
// Stop when the component is removed. Page exit also disposes context subscriptions.
onBeforeUnmount(stop);
```

Subscriptions currently use a ten-second server interval and short-lived in-process leases. A failed authorized query ends the subscription. A published membership Trigger is subscribed with `{kind: "trigger", id: "new-alerts", parameters: {}}`; the server returns `entered`, `left`, or `changed` events according to its definition. The SDK uses a host transport when provided; application code must use SDK clients for platform access.

## Conversations

`@ontomato/sdk/chat` exports the conversation components the platform itself uses. `<agent-chat-panel>` is one
conversation with one agent:

```js
import { AgentChatPanel, createAssistantClient, useShellLabels } from "@ontomato/sdk/chat";

const client = createAssistantClient(context);
const agents = (await client.listAgents()).filter((agent) => agent.enabled);
```

`createAssistantClient(context)` talks to the platform's agents as the current user: the user sees the same
agents and conversations as in the platform. Call `useShellLabels()` inside `setup()` for the conversation's words in
the platform's language. Give the panel's container a height; the panel fills it. `examples/chat.html` puts it
together. `<agent-shell>` is the platform's full conversation page with its column of conversations; see
`docs/reference.md` for both.

## Element Plus

`app.use(ElementPlus)` registers every component under its `el-` tag. For the attributes, events and slots of a
component, look up its tag, such as `el-table`, in `docs/element-plus.web-types.json`; it describes exactly the
bundled version. Messages and dialogs come from the named exports: `ElMessage.success("Saved")`,
`ElMessageBox.confirm(...)`.

## Versions

- `x.y.z` is a released SDK. `x.y.z-dev.<digest>` is a development build, named by a digest of the version's own
  content: a build with the same content has the same version, and any change makes a new one.
- A platform serves exactly one release, at `/apps-sdk/current/`, and the module files and the stylesheet there keep
  their names from one release to the next. An upgraded platform serves its own: test an app on it again.

### Explicit execution parameters (5.0)

`actions.execute({ id, parameters })` and MetricView execution require every declared parameter key. A missing key fails with `Missing parameter: <name>` before executing the program. Explicit `null` is permitted; `""` and `0` are preserved. Use `actions.form(...)` for platform forms: its `parameters` result already includes every field. Direct calls must supply the complete object themselves; clients do not invent defaults.

## Build-test previews

This SDK declares executionContext capability 1 in sdk.json. The same context.metricViews and context.actions clients use the preview frame's Java test context; published applications use their live target. No page code supplies a sandbox ID or manually adds an execution header. context.executionContext reports the host binding. Missing/expired/ended contexts fail with a preserved error code. Rebuild the preview frame to switch test contexts; never save a context ID or credential in application files. Upgrade old SDK references when the preview entry reports BUILD_TEST_SDK_UPGRADE_REQUIRED.

Build-test preview for hosted applications supports the MetricView and Action data clients. Assistant chat in that preview fails as BUILD_TEST_UNSUPPORTED. Candidate panels use the same test marker and the resources declared for their projections.

A request that carries the test header but reaches an interface that does not support test data fails with BUILD_TEST_UNSUPPORTED (HTTP 422) before it reads live business data. Definition, metadata, parameter and identity requests remain available. Do not remove the header and retry against live data.
