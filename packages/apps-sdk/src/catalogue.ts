import { defineComponentMeta, type ComponentMetadata } from "./components";

/*
 * Semantic metadata of the components this SDK version exports (overall design 3.1): what each means, what it binds,
 * the data it reads and the parameters it takes, and the state it hands over. The build generates `components.json` and
 * the catalogue document from this list. What a projection can do is the operations it names, not its component's.
 *
 * Only components this version actually exports may be declared, and the build checks that: a declaration for something
 * absent, or a public component with no declaration, fails it rather than shipping an undescribed component.
 */
export const components: readonly ComponentMetadata[] = [
  defineComponentMeta({
    componentId: "MetricViewData",
    module: "@ontomato/sdk",
    exportName: "MetricViewData",
    role: "presentation",
    meaning:
      "Reads one published MetricView and hands its result to the page's own template; the loading state and a failed read reach it as values, and it draws nothing itself.",
    effects: "Reads the MetricView through the data engine as the reader; it computes no metric of its own.",
    bindsElement: ["MetricView:*"],
  }),
  defineComponentMeta({
    componentId: "ProductAsset",
    module: "@ontomato/sdk",
    exportName: "ProductAsset",
    role: "presentation",
    meaning:
      "Embeds an existing product asset as the application's pinned release draws it; an unavailable asset or an unsupported host is reported instead of drawing another page.",
  }),
  defineComponentMeta({
    componentId: "EChart",
    module: "@ontomato/sdk/chart",
    exportName: "EChart",
    role: "presentation",
    meaning:
      "Draws one ECharts option in the platform's chart theme, following its light and dark modes; it computes no value and reads nothing itself. In a panel, write `<e-chart>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["MetricView:*", "Definition:*"],
  }),
  defineComponentMeta({
    componentId: "FormFields",
    module: "@ontomato/sdk/form",
    exportName: "FormFields",
    role: "control",
    meaning:
      "Draws a form exactly as its owner declares it — a choice as a select whose unavailable options stay listed with the reason, a text as an input or a large text box — in the owner's order and limits. In a panel, write `<form-fields>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["Action:*"],
  }),
  defineComponentMeta({
    componentId: "CodeEditor",
    module: "@ontomato/sdk/code",
    exportName: "CodeEditor",
    role: "control",
    meaning: "Edits code or structured text such as JSON, in the page's light or dark theme; it validates nothing. In a panel, write `<code-editor>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "MarkdownView",
    module: "@ontomato/sdk/markdown",
    exportName: "MarkdownView",
    role: "presentation",
    meaning: "Draws a text as the platform reads Markdown, in the page's light or dark theme. In a panel, write `<markdown-view>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "TablePreview",
    module: "@ontomato/sdk/preview",
    exportName: "TablePreview",
    role: "presentation",
    meaning: "Draws text cells as a table with paging; it reads no business meaning out of them. In a panel, write `<table-preview>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "HtmlPreview",
    module: "@ontomato/sdk/preview",
    exportName: "HtmlPreview",
    role: "presentation",
    meaning: "Draws a whole HTML document in a sandboxed frame; the document runs nothing outside that frame. In a panel, write `<html-preview>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "AgentChatPanel",
    module: "@ontomato/sdk/chat",
    exportName: "AgentChatPanel",
    role: "control",
    meaning:
      "Holds one conversation with one of the platform's agents and reports its session; the agent's own skills decide what it can do.",
    effects: "Sends the reader's messages to the agent service as the signed-in user and shows the run as it streams.",
  }),
  defineComponentMeta({
    componentId: "AgentShell",
    module: "@ontomato/sdk/chat",
    exportName: "AgentShell",
    role: "control",
    meaning:
      "The whole conversation surface of one agent: its column, the conversation and the page beside it. A panel that talks to an agent composes it rather than drawing a conversation of its own.",
    effects: "Sends the reader's messages to the agent service as the signed-in user.",
  }),
  defineComponentMeta({
    componentId: "ShellComposer",
    module: "@ontomato/sdk/chat",
    exportName: "ShellComposer",
    role: "control",
    meaning: "The input a reader types a message into, with what the message would carry; it sends nothing itself.",
  }),
  defineComponentMeta({
    componentId: "PageComposer",
    module: "@ontomato/sdk/chat",
    exportName: "PageComposer",
    role: "control",
    meaning: "The composer of a page shown full beside the conversation, with the page the message will carry.",
  }),
  defineComponentMeta({
    componentId: "ShellColumn",
    module: "@ontomato/sdk/chat",
    exportName: "ShellColumn",
    role: "presentation",
    meaning: "The conversation's own column: its agents and sessions, as the host lists them.",
  }),
  defineComponentMeta({
    componentId: "ShellNavBody",
    module: "@ontomato/sdk/chat",
    exportName: "ShellNavBody",
    role: "presentation",
    meaning: "The rows of the conversation column, with their counts and their state.",
  }),
  defineComponentMeta({
    componentId: "ShellDockRoom",
    module: "@ontomato/sdk/chat",
    exportName: "ShellDockRoom",
    role: "presentation",
    meaning: "The room the shell's own controls cover at the foot of a page, so the page's end scrolls clear.",
  }),
  defineComponentMeta({
    componentId: "AgentPicker",
    module: "@ontomato/sdk/chat",
    exportName: "AgentPicker",
    role: "control",
    meaning: "Chooses one of the agents the host serves; it grants nothing: the server decides what the reader may use.",
  }),
  defineComponentMeta({
    componentId: "AgentAvatar",
    module: "@ontomato/sdk/chat",
    exportName: "AgentAvatar",
    role: "presentation",
    meaning: "An agent's avatar, from its stored image or colour and its initial.",
  }),
  defineComponentMeta({
    componentId: "DatasetSelectionButton",
    module: "@ontomato/sdk/chat",
    exportName: "DatasetSelectionButton",
    role: "control",
    meaning: "Chooses a dataset to name in the conversation; it reads nothing and writes nothing.",
  }),
  defineComponentMeta({
    componentId: "ToolStep",
    module: "@ontomato/sdk/chat",
    exportName: "ToolStep",
    role: "presentation",
    meaning: "One tool call of a run: what was called, what it answered, and whether it failed.",
  }),
  defineComponentMeta({
    componentId: "Projection",
    module: "@ontomato/sdk/panel",
    exportName: "Projection",
    role: "presentation",
    meaning:
      "Stands where one projection of a panel is drawn: it reads that projection's current record by ID, draws the component the record names in this version's catalogue, and registers the ports the projection offers. A panel places it and names the slot; it never draws a projection itself.",
    effects: "Reads the projection's current definition through the platform as the reader, and again when that definition changes.",
  }),
  defineComponentMeta({
    componentId: "ObjectList",
    module: "@ontomato/sdk/base",
    exportName: "ObjectList",
    role: "control",
    meaning:
      "Lists the owner's records of the projection's type, compact or as a table (`columns`), from its `rows` datum (an owner's list or query read) or `objects` (ontology objects of a chosen type). What it offers follows the read and the placement: a search box when the read takes `search`, paging when it pages, checkboxes when the placement binds `checked`, and the status filter when it binds `status`; each is the list's own value unless the placement binds it to the panel's state. Clicking an item selects it (`selected`); search matches are highlighted, and a reference field is a link the page hears as `navigate`. Compact lists can cap a summary's visible lines with `subtitleLines`. A successful read with zero rows shows the empty message (`emptyText` can supply its message key). Missing required inputs show the waiting state.",
    effects: "Reads the bound type's list, query or ontology objects datum as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*"],
    // Either list shape draws the table, and an ontology type lists its declared objects instead: no single one of these
    // is what a placement must declare, so none is required.
    data: {
      // The list supplies unbound search and paging values at runtime; authored state bindings take precedence.
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["search", "cursor", "size", "page"] },
      objects: { results: ["panelOntologyObjects"], required: false, runtimeParams: ["search", "page"] },
    },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectSummary",
    module: "@ontomato/sdk/base",
    exportName: "ObjectSummary",
    role: "presentation",
    meaning:
      "Shows the few facts of one platform object a reader recognises it by, including owner-supplied highlight ranges, status tags and clickable object references. Which facts and in what order is the projection's display; what each holds is the object's own owner's.",
    effects: "Reads one object of the type the projection binds, as the reader.",
    bindsElement: ["PlatformObjectType:*"],
    data: { record: { results: ["panelRecord"], required: true } },
  }),
  defineComponentMeta({
    componentId: "ObjectForm",
    module: "@ontomato/sdk/base",
    exportName: "ObjectForm",
    role: "control",
    meaning:
      "Draws one object's form exactly as its owner declares it (fields, values, read-only rules, defaults), from its `form` datum for the object its edited input holds, or, with nothing chosen and a `createForm` datum, a new object's. It asks the owner again when a field the form depends on changes, saves through the owner's form save its projection names (only the fields the reader set), marks the fields the owner refuses, and takes an agent's draft for its object. Hidden owner fields have no control. Link a reference picker (or a graph choosing a list) to its owner field through `formField`: the form draws it in that field's place, so the owner's order and sections hold; a reference without one is shown as unavailable to edit. An owner may group its fields into `sections` (each a title and a hint, in order); the form draws them one after another with a list of them beside, and keeps Save and Discard in reach at the foot of the view. It says when it holds unsaved changes and asks before Discard throws them away. A page that opens it under a parent fixes the fields the parent decides with `fixedFields` (each from a panel state field or a literal): they show read-only and every save submits them. It tells the page `saved` (with the object) and `discarded`, and asks the reader before the panel moves it off unsaved changes.",
    effects: "Reads the owner's form and saves through the owner's own interface; it saves through the owner's form save its projection names.",
    bindsElement: ["PlatformObjectType:*", "Action:*"],
    // A form edits an existing record or creates a new one; which of the two a placement shows is its own choice.
    data: {
      // The form asks its owner again with the values it holds and the field that changed.
      form: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
      createForm: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
    },
  }),
  defineComponentMeta({
    componentId: "OperationButton",
    module: "@ontomato/sdk/base",
    exportName: "OperationButton",
    role: "control",
    meaning:
      "The button of one operation its projection names (`config.operation`, the projection's local name for it): it shows the owner's label and runs it on the object, or the checked objects, its target input holds.",
    effects: "Runs the named operation as the reader, as its owner admits it now.",
    bindsElement: ["PlatformOperation:*"],
    // The button reads no datum: its operation is the projection's, described by its owner as admitted now.
    data: {},
  }),
  defineComponentMeta({
    componentId: "ReferencePicker",
    module: "@ontomato/sdk/base",
    exportName: "ReferencePicker",
    role: "control",
    meaning:
      "Chooses the value of one reference field of a form in the same panel from the catalogue of the type the projection binds, writing the owner's own value (a skill's whole reference, a model's key) into that form, so the choice is saved, discarded and drafted with it. Declare the picker with `target.projectionId` and `formField: { slot, path }`, where `slot` is the form member and `path` is the owner's JSON Pointer; the form draws it in that field's place (or, with an optional `itemPath`, in each row of the array at `path`), wherever the panel mounts it. A choice the owner describes is offered with its description, and an empty value the owner names (a default followed) shows as that choice. The field controls single or multiple selection. `options` finds choices and `selected` resolves the values already in the form. A value the catalogue no longer offers stays listed, unavailable, with the owner's reason.",
    effects: "Reads the bound type's choices as the reader; it writes only the form field its slot's field port names.",
    bindsElement: ["PlatformObjectType:*"],
    // The catalogue it offers, and the held values it lists beside it: both are the member's own reads.
    data: {
      // The reader's search and page of choices, and the values the form holds now.
      options: { results: ["panelOptionList"], required: true, runtimeParams: ["keyword", "page"] },
      selected: { results: ["panelOptionList"], required: true, runtimeParams: ["values"] },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectGraph",
    module: "@ontomato/sdk/base",
    exportName: "ObjectGraph",
    role: "control",
    meaning:
      "Draws the records its `nodes` datum reads as a graph joined by the records its `edges` datum reads, each edge between the node keys its fields name at `edgeEnds`. Bound to a form field through `formField`, it chooses that field's list of node keys, drawn by the form in the field's place: a choice adds or removes a node, the nodes one edge away from a chosen one are marked, and one action adds them all; a line sums the choice up, a legend names the three looks, and a list offers the same choice by name. Otherwise it is the page's graph canvas on the platform's G6 canvas, shared by the ontology graph and visual modeling: a chosen node or edge is the panel's state of the type its datum reads (`selectedNode`, `selectedEdge`), a click on empty canvas lets both go, where the reader puts the nodes is kept per person (`positions`, a personal `node-positions` state) and drawn again from there, a node never placed is placed by its relations (the most connected first, each node one relation on in the next column) and nothing is written for it, and with `editable` a line drawn with Shift from one node to another hands the panel its two ends (`connectFrom`, `connectTo`) for the owner's new-edge form. Each edge is drawn with its record's label; edges between the same two nodes fan out. What the panel highlights (`highlightedNodes`, `highlightedEdges`: a path it found, a search's hits) stands out and the rest fades, without being chosen. The view opens on the chosen node, else the most connected, never smaller than names can be read at; a larger graph is panned. The canvas carries zoom in and out, fit, centring the chosen node, relayout (which lets the reader's places go) and a PNG of the view; names keep their size however far the reader zooms out, a name with no room being hidden until there is; the graph is fitted again once its container settles at a new size; and its zoom is a port (`zoom`), read and set by the page. The canvas fills the height of the box its member is placed in; give that box a height (in a flex column, `flex: 1` with `min-height: 0`), or nothing is drawn. Each node takes its category's colour of the platform palette when `nodeCategory` (a JSON Pointer into each node record's fields) and `categories` (the order of the colours) are configured; `nodeSize` and `labelSize` (screen pixels) draw the nodes and their names larger or smaller than the platform's own, and the placement leaves rows to fit them. It decides nothing about what the nodes stand for or who may read them.",
    effects: "Reads the node and edge types' lists as the reader; it writes the form field its slot's field port names, or the panel state its outputs bind, never the owner.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      nodes: { results: ["panelRecordList"], required: true },
      edges: { results: ["panelRecordList"], required: true },
    },
    // What the panel marks on the graph for the reader: drawn standing out, never chosen.
    inputs: {
      highlightedNodes: { kind: "list", items: { kind: "object", objectType: "@data:nodes" } },
      highlightedEdges: { kind: "list", items: { kind: "object", objectType: "@data:edges" } },
      // The zoom the page sets: the canvas zooms to it.
      zoom: { kind: "scalar", type: "number" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@data:nodes" },
      selectedEdge: { kind: "object", objectType: "@data:edges" },
      connectFrom: { kind: "scalar", type: "string" },
      connectTo: { kind: "scalar", type: "string" },
      positions: { kind: "node-positions" },
      // The zoom the canvas shows, to two decimals, as the reader zooms.
      zoom: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "MetricChart",
    module: "@ontomato/sdk/base",
    exportName: "MetricChart",
    role: "presentation",
    meaning:
      "Draws one chart as its source card draws it: the card's chart file (`template`) filled with a MetricView's output (`result`) for the card's saved parameters and the values the panel binds over them. The platform supplies both, and an output with no rows is the owner's empty answer. The projection keeps no drawing, query or data of its own.",
    effects: "Sends no request of its own: the platform reads the source card's template and the MetricView's output, both as the reader.",
    bindsElement: ["MetricView:*"],
    // The chart file and the output it is filled with: drawn once both are read.
    data: {
      template: { results: ["chartTemplate"], required: true },
      result: { results: ["metricOutput"], required: true },
    },
  }),
  defineComponentMeta({
    componentId: "GraphCanvas",
    module: "@ontomato/sdk/base",
    exportName: "GraphCanvas",
    role: "control",
    meaning:
      "Draws the nodes and edges it is given as a light SVG graph, each node in the tone its caller gives it and marked when its ID is among the selected ones, and hands back the selection a reader's choice results in and the part of the graph in view. What the nodes are, which may be chosen and what a choice implies are its caller's: it reads nothing and decides nothing about them.",
  }),
  defineComponentMeta({
    componentId: "G6GraphCanvas",
    module: "@ontomato/sdk/graph",
    exportName: "G6GraphCanvas",
    role: "control",
    meaning:
      "Draws the nodes and edges it is given with G6, for graphs a reader pans, zooms and drags: the graph canvas's interface, plus each node coloured by its category from the edition's palette, edges labelled, dashed or weighted as given, and invisible anchors for aggregated edges. It hands back the selection a reader's choice results in, the part of the graph in view, a double-click, a dragged node's new place and a click on empty canvas, and gives its caller the current positions and an image of the view. What the nodes are, what a choice means, and where positions and images are kept are its caller's: it reads and stores nothing.",
  }),
  defineComponentMeta({
    componentId: "OntologyGraph",
    module: "@ontomato/sdk/graph",
    exportName: "OntologyGraph",
    role: "control",
    meaning:
      "Draws an interactive G6 graph from the bound resource's graph source port: type mode arranges declared object types and relation kinds by layer with per-type readable counts and access statuses; instance mode starts from a node and expands one hop of neighbors on click, preserving complete object identities, highlighting drawn query matches, keeping layer filter and viewport as internal view state, distinguishing no-neighbors, owner-refused and read-failed outcomes, and exposing fit and relayout controls.",
    effects: "Reads the bound graph source's schema, counts, starting node and one-hop neighbors as the reader; writes only the panel's own selection state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // Expanding from a node is what the graph does; the three overview reads it shows when a placement supplies them.
    data: {
      schema: { results: ["panelGraphSchema"], required: false },
      counts: { results: ["panelGraphCounts"], required: false },
      start: { results: ["panelGraphStart"], required: false },
      // The node the reader expands, and the layers and relation kinds the graph shows now.
      neighbors: { results: ["panelGraphNeighbors"], required: true, runtimeParams: ["node", "layers", "relationKinds"] },
    },
    // What a placement hands the graph: how it draws, where instance mode starts, what is selected and what to highlight.
    inputs: {
      mode: { kind: "scalar", type: "string" },
      start: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] },
      selected: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] },
      selectedType: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
    },
    outputs: {
      selectedNode: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] },
      selected: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] },
      selectedType: { kind: "scalar", type: "string" },
      // The relation kinds drawn, read as well as written: a page's own kind filter and the graph follow one choice.
      visibleRelationKinds: { kind: "list", items: { kind: "object", objectType: "platform:OntologyRelationKind" } },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectRelations",
    module: "@ontomato/sdk/base",
    exportName: "ObjectRelations",
    role: "control",
    meaning:
      "Lists one-hop relations of the selected node from the bound resource's graph neighbors port, grouped by relation kind with distinct no-neighbors, owner-refused, read-failed and unavailable states, showing edge direction and stored/derived line semantics, and moving selection to a clicked peer node with its complete identity.",
    effects: "Reads the bound graph source's one-hop neighbors as the reader; writes only the panel's own selection state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // The node a reader moved to, when no state the author bound holds it.
    data: { neighbors: { results: ["panelGraphNeighbors", "panelRelationNeighbors"], required: true, runtimeParams: ["node"] } },
    outputs: { selected: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] } },
  }),
  defineComponentMeta({
    componentId: "SegmentedControl",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedControl",
    role: "control",
    meaning:
      "Switches one declared scalar panel state between mutually exclusive options supplied by the owner's `counts` datum (`[{key, label, count}]`) or static configuration. It binds no ontology element.",
    data: { counts: { results: ["panelGroupCounts"], required: false } },
    outputs: { value: { kind: "scalar", type: "string" } },
  }),
  defineComponentMeta({
    componentId: "TwoPaneLayout",
    module: "@ontomato/sdk/base",
    exportName: "TwoPaneLayout",
    role: "presentation",
    meaning:
      "Lays out two panes of one page side by side in one bordered block, the first at the platform's list width and the second taking the rest, stacking them where the panel is too narrow for both. It binds nothing.",
  }),
  defineComponentMeta({
    componentId: "SectionGroup",
    module: "@ontomato/sdk/base",
    exportName: "SectionGroup",
    role: "presentation",
    meaning:
      "One titled group of a page's content, with one line of what it is for and the platform's spacing and hairline between groups that follow one another. It binds nothing.",
  }),
  defineComponentMeta({
    componentId: "PathTree",
    module: "@ontomato/sdk/base",
    exportName: "PathTree",
    role: "control",
    meaning:
      "Arranges a flat list of slash-separated paths into a folder-first, name-sorted, default-expanded tree; clicking a folder only collapses or expands it, while clicking a file emits its key and highlights the active row. It reads nothing and carries no business rules.",
  }),
  defineComponentMeta({
    componentId: "SegmentedTextReader",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedTextReader",
    role: "control",
    meaning:
      "Displays offset-paged plain-text segments for a selected source with a close control and a More button when another offset exists, coordinating shared activeAnchor state so multiple placements on one page expand only one reader at a time.",
  }),
  defineComponentMeta({
    componentId: "ObjectTree",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTree",
    role: "control",
    meaning:
      "Shows one object's files — a skill package's, say — as a folder/file tree, from its `files` datum (an owner's records, one per file, at the path `pathField` gives, else the record's own key). Clicking a file selects it: `selected` is the file's key, which the placement can bind to the panel's state so another member (an ObjectTextReader's `record`) reads that file. Folders open and close; they are not selected.",
    effects: "Reads the owner's files as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*"],
    data: { files: { results: ["panelRecordList"], required: true } },
    outputs: { selected: { kind: "scalar", type: "string" } },
  }),
  defineComponentMeta({
    componentId: "ObjectTextReader",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTextReader",
    role: "presentation",
    meaning:
      "Shows an object's text read only, through its owner's reads. Sources read page by page: `sources` lists them as chips (one owner record per source), and `page` reads the chosen source's text one page at a time (an owner's query whose rows are the text's segments, `fields.text`, with `nextCursor` for the next page); the reader opens one source at a time and \"More\" reads the next page. One object's whole text: `record` reads it and the field `textField` names (`content` by default) is shown with its line breaks. Its outputs `activeSourceId` and `activeAnchor`, bound to the panel's state, are read as well as written: the page opens a source by writing it (and, for a reader with an `anchor`, that anchor), and readers sharing them on one page have only one open. Which sources it lists is the `sources` read's: an owner read of one issue's cited sources lists only those.",
    effects: "Reads the owner's sources, pages and records as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      sources: { results: ["panelRecordList"], required: false },
      // The chosen source and the page's cursor are the reader's own, unless the placement binds them.
      page: { results: ["panelRecordQuery"], required: false, runtimeParams: ["source", "cursor"] },
      record: { results: ["panelRecord"], required: false },
    },
    outputs: {
      activeSourceId: { kind: "scalar", type: "string" },
      activeAnchor: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ConversationEntry",
    module: "@ontomato/sdk/base",
    exportName: "ConversationEntry",
    role: "control",
    meaning:
      "Renders a generic button for a projection's declared conversationEntry. Clicking it asks the platform host to expand the page's composer with the declared agent target and optional prefill text without sending a message.",
    effects: "Requests the host to expand the page's composer with the projection's declared conversationEntry; performs no writes and never sends messages.",
    bindsElement: ["PlatformObjectType:platform:AgentDefinition"],
    // A button the host acts on: it reads nothing from the platform, and says so, so a placement may carry it as a member.
    data: {},
  }),
  defineComponentMeta({
    componentId: "CurrentEntry",
    module: "@ontomato/sdk/base",
    exportName: "CurrentEntry",
    role: "presentation",
    meaning:
      "Where an application's frame panel shows the entry the reader opened: write <current-entry member=\"content\"> in the frame's template for its member whose target is {fromPlatform: \"currentEntry\", candidates: {rule: \"applicationEntry\"}}. The content drawn there is the one the platform already admitted and runs, never started again here; the frame chooses where it goes, not which panel or with what inputs. The frame's code reads the entry shown and the menu the same resolution gave through usePanelContext().currentEntry and .entryMenu, to draw its menu and mark the entry; opening another entry goes through navigate. Outside an application's frame the place says it shows nothing; a member that is not the current entry is refused in its place.",
    effects: "Reads nothing and writes nothing: the platform places the admitted content.",
  }),
  defineComponentMeta({
    componentId: "PanelData",
    module: "@ontomato/sdk/base",
    exportName: "PanelData",
    role: "presentation",
    meaning:
      "Draws nothing: it hands the data its projection declares to the panel's own code, which reads each datum with usePanelData(member, name) and draws it in the page's own way. A projection names it for the part of a page the panel draws itself; the panel's own buttons run the projection's operations with instance.invoke.",
    // Any datum the projection names, under the author's own name, with any read result and the run-time values the
    // other components give; the read's own signature still bounds them. The catalogue test keeps these lists whole.
    data: {
      "*": {
        results: [
          "panelRecordList", "panelRecord", "panelRecordQuery", "panelGroupCounts", "panelApplicationMenu",
          "productProjectionList", "productPanelList", "productProjectionRecord", "productPanelRecord", "productProjectionUsedBy",
          "productPanelUsedBy", "productPanelMembers", "productCatalogueGrants", "applicationCatalogue", "applicationRecord", "applicationEntries",
          "panelFormDescription", "panelOperationDescriptor", "panelOptionList", "panelGraphSchema", "panelGraphCounts",
          "panelGraphStart", "panelGraphNeighbors", "panelOntologyObjects", "panelRelationNeighbors", "chartTemplate", "metricOutput",
          "sdkComponentDefinition", "actionDefinition", "actionExplanation",
          "scheduledTaskRunPage", "scheduledTaskRun",
        ],
        required: false,
        // What another component gives itself, and every parameter an owner's read declares in a fixed signature: the
        // page's own code may give any of them (a datum read for a class takes `className`).
        runtimeParams: [
          "by", "changedField", "className", "cursor", "defaultAppId", "keyword", "layers", "limit", "node", "page", "path", "rating", "relationKinds",
          "runId", "scope", "search", "section", "size", "sort", "source", "sourceType", "status", "template", "type", "values",
        ],
      },
    },
  }),
];
