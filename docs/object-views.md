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
or checks whether it is present. Action components open the published Action's form
from the data engine (`/action/form`), with the configured bindings as the fields'
initial text; read-only parameters keep their bound values. The data engine
interprets what is typed (JSON for numbers, lists, objects and datasets; text and
times as typed), and the dialog submits the parameters it answers through the
existing Action endpoint, then refreshes object data and query components.

A chart component stores a chart file and the one MetricView it draws. The file is a
`.chart.json` document (`packages/contracts/chart-data.md`): it holds the presentation,
its bindings and its display settings, and its dataset declares the columns it draws
with no row snapshot. The MetricView identity is the component's `resourceId`; its
parameter values are the component's `ViewBinding`s, so they bind the current object
and interaction variables.

`@ontomato/foundation-ui/chart`'s `MetricChart` draws the component. The view reads the
MetricView's declared output columns once for the identity and its current rows for the
object and parameters, and hands both to the component; opening the view, opening
another object or changing a parameter only reads that MetricView again. No skill runs
in the page, and the Manager neither selects nor executes one: the domain skill list
serves the capability overview only, and its gateway must route `/skills` under the
API base to the workbench (container setting `WORKBENCH_ORIGIN`;
`deploy/docker-compose.yml` sets it to `http://ontomato:3000`, and the image default is
`http://data-agent:3000`). MetricView reads still go directly to the data engine.

A metric output that lacks a column the file draws, or that the file's shape rejects,
shows the platform chart component's reason instead of a chart. Partial results follow
the existing rule: the runtime refuses an incomplete MetricView read rather than
drawing half a chart.

## Save and publish

Save draft creates an immutable revision without changing the published page. Save
and publish creates a revision and updates the published pointer. Previous revisions
can be loaded into the editor or republished directly. Concurrent saves use the last
loaded revision as a precondition; conflicts require reloading rather than silently
overwriting another editor's work. Full and panel views are keyed by domain, object
type and form factor.

Data browser titles and detail actions open the full object view. Graph inspection
provides an Open Object View entry. Runtime routes use
`/browser/views/<encoded-class-name>?key=<encoded-primary-key>`; editing uses
`/ontology/objects/<encoded-class-name>/view`. Legacy `/views/...` links redirect to these routes.
The runtime belongs to Object Browser access; the editor belongs to ontology-modeling access.
Without a published configuration, the runtime generates a property-list view.
The builder edits the full document, matching stable's final unified full-view behavior. The storage API retains
the `panel` form key for existing data. Preview identity changes only after the requested object finishes loading.
Navigation through the Manager checks for unsaved editor changes. Runtime variable
state survives object-data refreshes and is reset when the actual object changes.

## Component sizing

New widgets use type-specific defaults: metrics and actions/buttons occupy 4 of 12 columns; inputs and charts use
6 columns; text, properties, tables and linked records use 12. Existing saved spans and heights are preserved.
Text, properties, metrics, inputs and buttons grow with their content; the editor only exposes height for charts,
tables and linked records. Charts default to 320px and tables/linked records to a 360px maximum viewport. Chart loading,
empty, error and rendered states share one height owned by the visualization container, rather than stacking iframe
minimum heights. Cards in the same grid row stretch to the same outer height. Their content remains top-aligned;
compact controls keep their standard dimensions and charts retain their configured viewport height.

Settings use 32px inputs/selects and 28px minimum action buttons. Parameter addition stacks its input and button to
preserve readable labels. Dimension controls stack below 260px of settings content width. Runtime layouts collapse
to one column below 600px; between 601 and 800px, only compact metric cards retain their configured spans. Internal
spacing follows Manager 16/12/8/4px roles and cards use the shared 8px radius.

## Implementation boundaries

- `packages/contracts/src/object-views.ts`: typed documents, validation and bindings.
- `packages/ontology-manager/src/object-views`: editor, runtime and widget execution.
- Chart drawing belongs to `@ontomato/foundation-ui/chart`: the component fills the stored file from the MetricView
  output and draws it in the platform's theme. The Manager passes the file, the declared columns and the current rows
  and implements nothing of its own; no skill is invoked for a stored chart.
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
