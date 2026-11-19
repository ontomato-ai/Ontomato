import { defineComponentMeta, type ComponentMetadata } from "./components";

/*
 * Semantic metadata of the components this SDK version exports (overall design 3.1): what each means, what it binds,
 * the parameters it takes, the state it hands over, and — for a control — the SDK client operations it publishes. The
 * build generates `components.json` and the catalogue document from this list; a panel's projections then take their
 * ports from the catalogue, so an operation's `handlerRef` is a declared client operation rather than a name read off a
 * button's label.
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
    outputs: ["data", "loading", "error", "reload"],
  }),
  defineComponentMeta({
    componentId: "ProductAsset",
    module: "@ontomato/sdk",
    exportName: "ProductAsset",
    role: "presentation",
    meaning:
      "Embeds an existing product asset as the application's pinned release draws it; an unavailable asset or an unsupported host is reported instead of drawing another page.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "EChart",
    module: "@ontomato/sdk/chart",
    exportName: "EChart",
    role: "presentation",
    meaning:
      "Draws one ECharts option in the platform's chart theme, following its light and dark modes; it computes no value and reads nothing itself.",
    bindsElement: ["MetricView:*", "Definition:*"],
  }),
  defineComponentMeta({
    componentId: "FormFields",
    module: "@ontomato/sdk/form",
    exportName: "FormFields",
    role: "control",
    meaning:
      "Draws a form exactly as its owner declares it — a choice as a select whose unavailable options stay listed with the reason, a text as an input or a large text box — in the owner's order and limits.",
    bindsElement: ["Action:*"],
    outputs: ["input", "choose"],
  }),
  defineComponentMeta({
    componentId: "CodeEditor",
    module: "@ontomato/sdk/code",
    exportName: "CodeEditor",
    role: "control",
    meaning: "Edits code or structured text such as JSON, in the page's light or dark theme; it validates nothing.",
    outputs: ["modelValue"],
  }),
  defineComponentMeta({
    componentId: "MarkdownView",
    module: "@ontomato/sdk/markdown",
    exportName: "MarkdownView",
    role: "presentation",
    meaning: "Draws a text as the platform reads Markdown, in the page's light or dark theme.",
  }),
  defineComponentMeta({
    componentId: "TablePreview",
    module: "@ontomato/sdk/preview",
    exportName: "TablePreview",
    role: "presentation",
    meaning: "Draws text cells as a table with paging; it reads no business meaning out of them.",
  }),
  defineComponentMeta({
    componentId: "HtmlPreview",
    module: "@ontomato/sdk/preview",
    exportName: "HtmlPreview",
    role: "presentation",
    meaning: "Draws a whole HTML document in a sandboxed frame; the document runs nothing outside that frame.",
  }),
  defineComponentMeta({
    componentId: "AgentChatPanel",
    module: "@ontomato/sdk/chat",
    exportName: "AgentChatPanel",
    role: "control",
    meaning:
      "Holds one conversation with one of the platform's agents and reports its session; the agent's own skills decide what it can do.",
    effects: "Sends the reader's messages to the agent service as the signed-in user and shows the run as it streams.",
    outputs: ["sessionId", "error"],
  }),
  defineComponentMeta({
    componentId: "AgentShell",
    module: "@ontomato/sdk/chat",
    exportName: "AgentShell",
    role: "control",
    meaning:
      "The whole conversation surface of one agent: its column, the conversation and the page beside it. A panel that talks to an agent composes it rather than drawing a conversation of its own.",
    effects: "Sends the reader's messages to the agent service as the signed-in user.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "ShellComposer",
    module: "@ontomato/sdk/chat",
    exportName: "ShellComposer",
    role: "control",
    meaning: "The input a reader types a message into, with what the message would carry; it sends nothing itself.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "PageComposer",
    module: "@ontomato/sdk/chat",
    exportName: "PageComposer",
    role: "control",
    meaning: "The composer of a page shown full beside the conversation, with the page the message will carry.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "ShellColumn",
    module: "@ontomato/sdk/chat",
    exportName: "ShellColumn",
    role: "presentation",
    meaning: "The conversation's own column: its agents and sessions, as the host lists them.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "ShellNavBody",
    module: "@ontomato/sdk/chat",
    exportName: "ShellNavBody",
    role: "presentation",
    meaning: "The rows of the conversation column, with their counts and their state.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "ShellDockRoom",
    module: "@ontomato/sdk/chat",
    exportName: "ShellDockRoom",
    role: "presentation",
    meaning: "The room the shell's own controls cover at the foot of a page, so the page's end scrolls clear.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "AgentPicker",
    module: "@ontomato/sdk/chat",
    exportName: "AgentPicker",
    role: "control",
    meaning: "Chooses one of the agents the host serves; it grants nothing: the server decides what the reader may use.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "AgentAvatar",
    module: "@ontomato/sdk/chat",
    exportName: "AgentAvatar",
    role: "presentation",
    meaning: "An agent's avatar, from its stored image or colour and its initial.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "DatasetSelectionButton",
    module: "@ontomato/sdk/chat",
    exportName: "DatasetSelectionButton",
    role: "control",
    meaning: "Chooses a dataset to name in the conversation; it reads nothing and writes nothing.",
    outputs: [],
  }),
  defineComponentMeta({
    componentId: "ToolStep",
    module: "@ontomato/sdk/chat",
    exportName: "ToolStep",
    role: "presentation",
    meaning: "One tool call of a run: what was called, what it answered, and whether it failed.",
    outputs: [],
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
      "Lists or tabulates platform objects of the bound type through its resource adapter's query or list port, providing search, faceted filters, safe highlight rendering, paging, single viewing selection, optional explicit multi-selection and clickable reference navigation without embedding business query rules.",
    effects: "Reads the bound type's list or query as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*"],
    outputs: ["selected", "checked", "navigate"],
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
    outputs: ["navigate"],
  }),
  defineComponentMeta({
    componentId: "ObjectForm",
    module: "@ontomato/sdk/base",
    exportName: "ObjectForm",
    role: "control",
    meaning:
      "Draws one platform object's form exactly as its owner declares it, asks the owner again when a field the form depends on changes, and keeps the reader's draft until it is saved.",
    effects: "Reads the owner's form and saves through the owner's own interface; the save is the projection's own operation.",
    bindsElement: ["PlatformObjectType:*", "Action:*"],
    // The owner's own save: `@binding` stands for the type the projection binds, so one declared operation serves every
    // type this version registers.
    operations: [{ client: "@binding", name: "save", label: "Save", kind: "form.save", inputSchema: {} }],
  }),
  defineComponentMeta({
    componentId: "OperationButton",
    module: "@ontomato/sdk/base",
    exportName: "OperationButton",
    role: "control",
    meaning:
      "The button of one operation a projection publishes: it shows the operation's own label and runs it on the object the panel has selected, through the handler the operation names.",
    effects: "Runs the projection's operation as the reader, with the object the panel has selected.",
    bindsElement: ["PlatformOperation:*"],
  }),
  defineComponentMeta({
    componentId: "ReferencePicker",
    module: "@ontomato/sdk/base",
    exportName: "ReferencePicker",
    role: "control",
    meaning:
      "Chooses the value of one reference field of a form in the same panel from the catalogue of the type the projection binds, writing the owner's own value (a skill's whole reference, a model's key) into that form, so the choice is saved, discarded and drafted with it. A value the form holds that the catalogue no longer offers stays listed, unavailable, with the owner's reason.",
    effects: "Reads the bound type's choices as the reader; it writes only the form field its slot's field port names.",
    bindsElement: ["PlatformObjectType:*"],
  }),
  defineComponentMeta({
    componentId: "ObjectGraph",
    module: "@ontomato/sdk/base",
    exportName: "ObjectGraph",
    role: "control",
    meaning:
      "Draws the objects of the bound type as a graph joined by the objects of its graph's edge type, and chooses on it the list of node keys one form field of the same panel holds: a choice adds or removes a node, the nodes one edge away from a chosen one are marked, and one action adds them all. It decides nothing about what the nodes stand for or who may read them.",
    effects: "Reads the node and edge types' lists as the reader; it writes only the form field its slot's field port names.",
    bindsElement: ["PlatformObjectType:*"],
  }),
  defineComponentMeta({
    componentId: "MetricChart",
    module: "@ontomato/sdk/base",
    exportName: "MetricChart",
    role: "presentation",
    meaning:
      "Draws one registered chart as its source card draws it: the card's chart file, which its dashboard owner hands over for this projection, filled with the bound MetricView's output for the MetricView's own defaults and the values the panel binds. The projection keeps no drawing, query or data of its own.",
    effects: "Reads the chart's source template through the product service and the MetricView through the data engine, both as the reader.",
    bindsElement: ["MetricView:*"],
  }),
  defineComponentMeta({
    componentId: "GraphCanvas",
    module: "@ontomato/sdk/base",
    exportName: "GraphCanvas",
    role: "control",
    meaning:
      "Draws the nodes and edges it is given as a light SVG graph, each node in the tone its caller gives it and marked when its ID is among the selected ones, and hands back the selection a reader's choice results in and the part of the graph in view. What the nodes are, which may be chosen and what a choice implies are its caller's: it reads nothing and decides nothing about them.",
    outputs: ["selected", "viewport"],
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
];
