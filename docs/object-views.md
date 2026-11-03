# Configurable Object Views

Object Views provide a type-level layout editor and a published runtime for individual
ontology objects. The Ontology Manager owns the interface. The data engine stores view
revisions, so the standalone Manager uses the same `/api/data-query` connection as its
other features.

## Open the builder

Select **Configure Object View** on an object type's definition page, or **Configure
view** in the data browser. Full and panel layouts have independent versions. Select
a section, add components from the palette, select a component to configure it, and
drag components between sections to reorder them. Width uses a twelve-column grid.
The arrow controls provide a keyboard-accessible alternative to dragging.

Available components are text, properties, metrics, tables, bar/line charts, linked
objects, variable inputs, event buttons and Action forms. Tabs and sections group
components. Use Preview and Load object to inspect a real instance before publishing.
Actions are disabled in editor previews.

## Bind data and interactions

Bindings read a fixed value, a property of the current object, or a variable path.
For example, `id` reads the current object's primary-key property; a variable path
such as `selected.product_id` reads a field of a table's selected row. Paths traverse
own properties; bindings do not evaluate JavaScript.

Metric, table and chart components can execute a published MetricView. Add parameter
bindings using the MetricView's parameter names. A result path selects a nested value
from its response; leave it empty for an array response. Metrics display the first
row's value field. Charts use the label and value fields. Tables can also bind directly
to an array variable. Set their selection variable to drive downstream components.

Linked object components choose a relationship and direction and query fifty rows at
a time through the existing permission-aware DSL endpoint. They support selection
variables and opening linked instances. Table components can open an object using a
configured target type and primary-key field.

Input components write variables. Buttons refresh data, set a variable from a binding,
or open another object. Conditional visibility compares a binding with a fixed value
or checks whether it is present. Action components load the published Action's
parameters into a dialog and apply configured bindings as defaults. Submitting uses
the existing Action endpoint and refreshes object data and query components.

Charts execute the template's enabled visualization Skill through the workbench
`/api/skills/:id/render` endpoint and embed its returned HTML. Skill selection and
execution use the current domain and credentials. The Manager never imports server
Skill code. Its gateway must route `/skills` and `/echart` under the API base to
the workbench (container setting `WORKBENCH_ORIGIN`; `deploy/docker-compose.yml` sets it to
`http://ontomato:3000`, and the image default is `http://data-agent:3000`).
MetricView reads still go directly to the data engine.

Point maps select the `leaflet` visualization Skill and `leaflet-map` chart type.
Bind a MetricView returning location rows, set latitude/longitude fields explicitly,
and select a readable label field. An optional numeric value field scales markers.
Coordinates must use WGS-84 for the Esri World Topographic basemap; geographic labels
alone are not coordinates. Map resources use authenticated Skill resource URLs and
the basemap requires browser network access to `server.arcgisonline.com`. Demo locations should include
their provenance and coordinate precision in the data and view description.

The `echarts` Skill renders bar, line, donut and timeline presentations. Timeline
uses label, date and optional description fields; undated events remain visible.
The `network-graph` Skill renders relationship data as `{nodes, links}` and must be
enabled in the domain. Nodes use `id`, `label`, `group`; links use `source`, `target`,
`label`. Graph exploration is provided by the Skill's own interactions.

## Save and publish

Save draft creates an immutable revision without changing the published page. Save
and publish creates a revision and updates the published pointer. Previous revisions
can be loaded into the editor or republished directly. Concurrent saves use the last
loaded revision as a precondition; conflicts require reloading rather than silently
overwriting another editor's work. Full and panel views are keyed by domain, object
type and form factor.

Data browser rows open panel views, with an entry to the full view. Graph inspection
provides an Open Object View entry. Manager paths use
`/views/<encoded-class-name>?key=<encoded-primary-key>` and `&edit=true` for editing;
the host remains responsible for exposing that path through its navigation.
Without a published configuration, the runtime generates a property-list view.
Panel configuration opens the panel editor with the current object available for
preview. Preview identity changes only after the requested object finishes loading.
Navigation through the Manager checks for unsaved editor changes. Runtime variable
state survives object-data refreshes and is reset when the actual object changes.

## Implementation boundaries

- `packages/contracts/src/object-views.ts`: typed documents, validation and bindings.
- `packages/ontology-manager/src/object-views`: editor, runtime and widget execution.
- Data engine `ObjectViewStore`: PostgreSQL tables `object_view` and
  `object_view_version`, created during normal service initialization.
- `/objectView/read`: published configuration; `/objectView/edit`: revision history;
  `/objectView/save`: append draft; `/objectView/publish`: select published revision.

## Reuse a published view in an application

### Native application APIs

Applications may consume published capabilities without embedding Manager UI.
`POST /objectView/contract` accepts `{view:{className,form,revision}}` and returns
the resolved revision, input definitions, read `regions`, and `operations`. Region
metadata includes key, label, kind, fields, field labels and value field; operation
metadata includes parameter types, bound identities and select options. No function
code or browser layout styling is included. Set an optional widget `key` (for example
`profile` or `maintainEducation`) in the builder for a stable application contract;
older documents use their existing widget IDs. Keys must be unique across the document.

```json
{
  "view": {"className":"/univ_demo/person","form":"full","revision":32},
  "object": {"primaryKey":"univ_demo_person:UN259015"},
  "regions": ["profile", "supervisionSummary"],
  "inputs": {}
}
```

Send this body to `POST /objectView/instance/read`. Only requested regions execute;
the result is `{revision,regions:{<key>:{success,value,message?}}}`. Properties use the
permission-filtered object record; query regions execute the published MetricView and
apply `resultPath`. Identical queries within a request are reused. Completeness markers
from MetricView execution are retained on each region. Query failures are isolated by
region. Native reads support properties, metrics, tables, chart data and text. Linked
object navigation, file parameters and bindings requiring interactive variables remain
in the full runtime for this first version. Query row limits/pagination remain defined
by the MetricView; the native API does not promise arbitrary pagination or totals.

`POST /objectView/instance/execute` uses the same view/object/inputs envelope plus
`operation` (capability key) and `parameters` (editable values). The server resolves
object/input/literal bindings, rejects overrides of read-only bindings, validates
parameter names and configured select options, then executes the published Action.
Visibility conditions are evaluated server-side. Cross-domain resources are rejected.
The original `/action/execute` permission is required in addition to the native endpoint;
read APIs similarly retain object and MetricView endpoint permissions.

Resolve the contract once and use its numeric revision for subsequent calls to avoid
mixing publications. A layout revision does not pin its underlying interface code.
The framework-neutral `@ontomato/contracts/object-view-client` exports
`createObjectViewClient` with a host-owned authenticated request function.

Object Views are addressable by object class and form (`full` or `panel`) in the
authenticated domain. Applications store a declaration rather than copying the layout:

```json
{
  "kind": "objectView",
  "view": { "className": "/crm/customer", "form": "full", "revision": "published" },
  "object": { "primaryKey": "customer-1024" },
  "inputs": { "period": "month" },
  "navigation": "host"
}
```

`revision: "published"` follows the current publication. A positive integer pins a
revision that has been published. Draft revisions cannot be resolved by this API.
The publication migration records the current published revision of existing views;
older revisions need to be republished once before they can be pinned. Revision numbers
are local to a deployment. Referencing a fixed layout does not freeze its object data,
MetricViews, Actions or Skills.

`POST /objectView/list` accepts an optional `className` and returns `data.views`,
with titles, input definitions, current published revisions and dependency lists.
`POST /objectView/resolve` accepts the declaration's `view` object and returns
`data.{className,form,revision,document,dependencies}`. Both use the current user's
domain. An explicit reference with no matching publication fails; it does not silently
substitute the Manager's default property view.

### Inputs and events

Documents can declare typed host inputs separately from internal interaction variables:

```json
{
  "inputs": {
    "period": {
      "type": "string",
      "description": "Reporting period",
      "required": true,
      "default": "month",
      "enum": ["month", "year"]
    }
  }
}
```

Supported types are `string`, `number` and `boolean`. Optional inputs may be null.
Unknown inputs, incorrect types, missing required values and values outside an enum
are rejected before rendering. Bind widgets with `{"source":"input","path":"period"}`.
The builder exposes input definitions and an input binding source; enum constraints
can be authored through the document API. Existing documents default to no inputs.

### Vue host

The package exports `OntomatoObjectView`, `ObjectViewEmbed` and its parser
`objectViewEmbedSchema`. In this workspace:

```vue
<script setup lang="ts">
import { OntomatoObjectView, objectViewEmbedSchema } from "@ontomato/ontology-manager";
import "element-plus/dist/index.css";
// context is the host's reactive ManagerHostContext, including API, credentials,
// locale, messages and presentation, as supplied to OntologyManager.
const declaration = objectViewEmbedSchema.parse({
  kind: "objectView",
  view: { className: "/crm/customer", form: "full" },
  object: { primaryKey: "customer-1024" },
  inputs: { period: "month" }
});
</script>

<template>
  <OntomatoObjectView :context="context" :declaration="declaration"
    @open-object="openCustomer" @action-completed="refreshCustomerList" />
</template>
```

The component loads the document and object and provides its own API/feedback context.
An API or credential change recreates that context. `loaded` reports `{revision, reference}`;
`open-object` reports `{className, primaryKey}`; `action-completed` reports `{id, reference}`;
`error` reports a message; `auth-failure` reports the existing 401/402 status.
The exposed `reload()` reloads the publication and object. Successful Actions refresh
object/query data. `navigation: "host"` leaves navigation to the host; `"local"` opens
linked objects inside the component, resolving their published views. Inputs are
retained for the original class and cleared when navigating to a different class.

### React, HTML and other hosts

Use the standalone Manager's base URL with
`?embed=object-view&parentOrigin=<encoded-host-origin>`. It renders only the view.
Use the deployment's existing authentication/session launch mechanism; this mode does
not introduce a separate authentication policy. The iframe checks both message origin
and `event.source === window.parent`.

```js
const frame = document.querySelector("iframe");
const managerOrigin = "https://ontology.example.com";
window.addEventListener("message", event => {
  if (event.origin !== managerOrigin || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.channel !== "ontomato.object-view" || message.version !== 1) return;
  if (message.type === "ready") {
    frame.contentWindow.postMessage({
      channel: "ontomato.object-view", version: 1,
      type: "configure", payload: declaration
    }, managerOrigin);
  }
});
```

Register the listener before assigning the iframe URL. Incoming messages are
`configure` (payload is the complete declaration) and `refresh` (remounts the view and
resets interaction state). Outgoing messages are `ready`, `loaded`, `open-object`,
`action-completed` and `error`, with the component event payloads above; iframe errors
use `{message}`. A URL-encoded JSON `declaration` parameter can supply the initial
configuration without messaging. Without `parentOrigin`, messaging accepts only the
Manager's own origin. Credentials must not be placed in the declaration.

### App Builder discovery and validation

The app-builder CLI supports:

```text
object-view list [<class>]
object-view get <class> [--form full|panel] [--revision <number>]
object-view validate <class> [--form full|panel] [--revision <number>]
object-view save @save-request.json
object-view publish @publish-request.json
```

`validate` reads the published document and checks referenced classes, published
MetricViews/Actions, parameter names and required MetricView bindings, and enabled
visualization Skills. It does not execute business operations. Its `valid` result is
a dependency check, not an end-to-end business acceptance test or an immutable dependency
lock. `get` provides the full definition for export; `save`/`publish` use the existing
optimistic revision API. Cross-environment imports must use the target deployment's
revision preconditions and verify its dependencies. The existing `sync-production`
command still synchronizes only MetricViews and Actions; Object View publication is
explicit in the target environment.

Object data, relationship reads, MetricViews and Actions use existing server-side
data permissions. The public edition follows its existing authenticated/anonymous
deployment policy. An enterprise host must include the new configuration endpoints
in its existing model-administration access policy before enabling editing there.

This initial builder supports scalar variable defaults, row selection objects and
component-level conditions. It does not yet include nested layout containers,
multi-step event workflows, object-set panel configuration, map/media/time-series
widgets, file-upload Action parameters or a general expression editor. Chart rendering
provides bar, line, donut, timeline and relationship graph views. Full and panel documents are configured
separately.
