# Ontomato apps SDK {{version}}

An app is a set of static files, HTML and ES modules, that the platform hosts at `/apps/<app>/` and shows inside its
shell in a same-origin frame. There is no build step: the page loads this SDK from its version directory through an
import map, and Vue compiles the templates written in the HTML.

This directory is one exact version. It never changes, and it stays installed when the platform is upgraded, so an app
keeps the behaviour of the version it names.

## What is in this version

| Path | Content |
| --- | --- |
| `sdk.json` | The version, the product and the source commits it was built from, the module files, the library versions |
| `docs/index.md` | This guide |
| `docs/reference.md` | The API of `@ontomato/sdk` and `@ontomato/sdk/chat`, generated from their sources |
| `docs/element-plus.web-types.json` | Element Plus's own metadata for every component of the bundled version: attributes, events, slots |
| `examples/basic.html` | Platform context, Element Plus and an ECharts chart |
| `examples/metric-action.html` | A published MetricView in a table and a chart, then an Action and a fresh read |
| `examples/chat.html` | A conversation with one of the platform's agents |

## Modules

| Import | Content |
| --- | --- |
| `vue` | Vue, the build with the template compiler; the only Vue of the page |
| `element-plus` | Element Plus, complete: the default export installs every component, the named exports include `ElMessage`, `ElMessageBox` and `ElLoading` |
| `echarts` | ECharts, complete: `import * as echarts from "echarts"` |
| `@ontomato/sdk` | `createAppContext()`, the MetricView and Action clients, and `<metric-view-data>` |
| `@ontomato/sdk/chat` | The platform's conversation components, `createAssistantClient` and `useShellLabels` |

The versions of Vue, Element Plus and ECharts are in `sdk.json`. Use only these modules: the page must not load
scripts, styles or fonts from the internet, because many installations have no internet access.

## Page skeleton

Put the stylesheet and the import map of this version into the page's `<head>`, before any module script:

```html
{{head}}
```

The paths start at the platform's root. When the platform is deployed under a path prefix, such as `/wenshu`, every
`/apps-sdk/...` path starts with that prefix: `/wenshu/apps-sdk/...`. Use one version on a page; never mix two.

```html
<div id="app" v-cloak>
  <el-button type="primary" @click="count++">Clicked {{ count }} times</el-button>
</div>
<script type="module">
  import { createApp, ref } from "vue";
  import ElementPlus from "element-plus";
  import { createAppContext } from "@ontomato/sdk";

  const context = createAppContext();
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

`createAppContext()` connects the page to the shell around it. Call it once, before creating the Vue app; it throws when
the page is not inside the shell. `app.use(context)` installs the platform's words, Element Plus's language and the
`<metric-view-data>` component.

- `context.locale` and `context.theme` follow the platform while the app is open. The SDK keeps `<html lang>` and the
  `dark` class of `<html>` in step, and Element Plus follows both. Use Element Plus's CSS variables, such as
  `var(--el-bg-color)` and `var(--el-text-color-primary)`, for your own styles, so they follow too.
- `context.user` is the signed-in user, for display only. It is `null` in the open-source edition.
- Every request carries the current user's credential; the open-source edition sends none. The server decides every
  permission: an app sees and changes only what its user may. When the sign-in expires, the shell takes over.
- `context.navigate(path)` opens a platform page in the shell, such as `context.navigate("/ontology/assets/metrics")`.
- An app reaches the platform only through the SDK: `context.metricViews` to read, `context.actions` to change data and
  `createAssistantClient(context)` for conversations. Other platform paths are internal and change between versions.

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
the parameters change. It draws nothing itself: its default slot receives `data`, `loading`, `error` and `reload`, and
the page puts a table, a chart or a figure in it. Show `error` yourself.

```html
<metric-view-data :metric-view-id="metricViewId" :parameters="{ region }" v-slot="{ data, loading, error, reload }">
  <el-alert v-if="error" type="error" :title="error.message" :closable="false"></el-alert>
  <el-table v-else v-loading="loading" :data="data ?? []">
    <el-table-column prop="name" label="Name"></el-table-column>
  </el-table>
</metric-view-data>
```

## Changing data: Actions

An app changes business data only by executing Actions. The platform's ontology service lists them under Actions, with
each one's id and parameters.

```js
await context.actions.execute({ id: "<Action id>", parameters: { orderId: "SO-1001", quantity: 4 } });
```

Name every parameter the Action declares and give each value its declared type: a number as a number, a list as an
array. The server checks the user's permission and the values again, and the promise rejects with its message when it
refuses. Read the MetricViews that show the changed data again afterwards, for example with `reload()` from
`<metric-view-data>`.

## Charts

ECharts is the complete library. Create a chart on an element after it is mounted, call `setOption` when the data
changes, `resize` when the element's size changes and `dispose` when it goes away. Pass `"dark"` as the theme while
`context.theme` is dark, and create the chart again when the theme changes. `examples/basic.html` does all four.

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

- `x.y.z` is a released SDK. `x.y.z-dev.g<commit>` is a development build of the platform, named by the commits it
  was built from.
- A version directory never changes, and installing a newer platform keeps the older versions. To move an app to a
  newer SDK, change the version in its stylesheet link and import map, then test the app again.
