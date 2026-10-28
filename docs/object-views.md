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
the workbench (container setting `WORKBENCH_ORIGIN`, default `http://data-agent:3000`).
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
