import assert from "node:assert/strict";
import { test } from "node:test";
import { appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import { bindPanelAuthoringChart, expandPanelAuthoringMember, panelAuthoringMemberSchema, panelManifestSchema } from "./panel-check";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { dashboardCardPrimaryKey } from "./dashboard";
import { DASHBOARD_CARD, platformObjectTypes } from "./platform-object-types";
import { platformTypeTableEntrySchema } from "./platform-type-table";
import { productProjectionInputSchema } from "./product-panels";

const type = "platform:BusinessKnowledge";
const selected = { kind: "object", objectType: type };
const search = { kind: "scalar", type: "string" };
const buildComponent = (name: string, fields: object) => appsSdkComponentCatalogEntrySchema.parse({
  componentId: name, module: "@ontomato/sdk/base", exportName: name, role: "control", meaning: name,
  ports: { props: [], slots: [], events: [{ name: "navigate", type: "PanelObjectRef", description: "" }] }, ...fields,
});
const components = [
  buildComponent("ObjectList", {
    data: { rows: { results: ["panelRecordQuery"], required: true, runtimeParams: ["cursor", "size"] } },
    outputs: { selected: { kind: "object", objectType: "@binding" }, search },
  }),
  buildComponent("OperationButton", {
    data: {}, config: [{ name: "operation", type: "string", description: "The local operation name.", required: true }],
  }),
  buildComponent("ObjectForm", {
    data: {
      form: { results: ["panelFormDescription"], required: false },
      createForm: { results: ["panelFormDescription"], required: false },
    },
  }),
];
const approve = panelOperationDeclarationSchema.parse({
  id: "knowledge.approve", kind: "action", effect: "write", batch: true,
  target: { source: "input", input: "knowledge" }, inputSchema: { type: "object" },
});
const save = panelOperationDeclarationSchema.parse({
  id: "platform:BusinessKnowledge.save", kind: "form.save", effect: "write", batch: false,
  target: { source: "draft" }, inputSchema: { type: "object" },
});
const typeTable = { objectTypes: {
  [type]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[type].reads, operations: [approve, save] }),
} };
const state = panelManifestSchema.parse({
  state: {
    selected: { type: selected }, search: { type: search },
    other: { type: { kind: "object", objectType: "org" } },
  },
  members: {}, commands: {},
}).state;

const expand = (key: string, source: unknown, table: Parameters<typeof expandPanelAuthoringMember>[2]["typeTable"] = typeTable) => {
  const member = panelAuthoringMemberSchema.parse(source);
  assert("component" in member);
  return expandPanelAuthoringMember(key, member, { typeTable: table, components, state });
};

test("short reads bind declared input parameters and resolve typed SDK outputs", () => {
  const { projection, placement } = expand("list", {
    component: "ObjectList", type, data: { rows: "query" }, state: { selected: "selected", search: "search" },
  });
  assert.deepEqual(projection.data.rows, {
    source: { type: { kind: "PlatformObjectType", id: type } }, read: "query", params: { search: { input: "search" } },
  });
  assert.deepEqual(projection.inputs, { search });
  assert.deepEqual(projection.outputs, { selected, search });
  assert.deepEqual(placement, {
    inputs: { search: { state: "search" } },
    outputs: { selected: { state: "selected" }, search: { state: "search" } },
  });
});

test("explicit parameters take precedence over a same-named state binding", () => {
  const { projection, placement } = expand("list", {
    component: "@ontomato/sdk:ObjectList", type,
    data: { rows: { read: "query", params: { search: { literal: "exact" } } } },
    state: { search: "search" },
  });
  assert.deepEqual(projection.data.rows.params, { search: { literal: "exact" } });
  assert.deepEqual(projection.inputs, {});
  assert.deepEqual(placement, { outputs: { search: { state: "search" } } });
});

test("short operations take their target and local name from the owner declaration", () => {
  const { projection, placement } = expand("approve", {
    component: "OperationButton", operation: "knowledge.approve", target: "selected", config: { type: "primary" },
  });
  assert.deepEqual(projection.config, { type: "primary", operation: "approve" });
  assert.deepEqual(projection.operations, { approve: {
    operation: { kind: "PlatformOperation", id: "knowledge.approve" }, target: { input: "knowledge" },
  } });
  assert.deepEqual(placement, { inputs: { knowledge: { state: "selected" } } });
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...projection, name: "Approve", description: "", visibility: "domain",
  }));
});

test("short draft reads must name their form member and keep the binding on the placement", () => {
  const trial = panelOperationDeclarationSchema.parse({
    id: "metricViews.testExecute", kind: "action", effect: "read", batch: false,
    target: { source: "draft" }, inputSchema: { type: "object" },
  });
  const table = { objectTypes: { "platform:MetricView": { reads: undefined, operations: [trial] } } };
  const member = { component: "OperationButton", operation: trial.id };
  assert.throws(() => expand("trial", member, table), /Member 'trial', field 'draft'.*metricViews.testExecute/);
  const { projection, placement } = expand("trial", { ...member, draft: "metricEditor" }, table);
  assert.deepEqual(projection.operations, {
    testExecute: { operation: { kind: "PlatformOperation", id: trial.id } },
  });
  assert.deepEqual(placement, {
    readOperationInputs: { testExecute: { draft: { slot: "metricEditor" }, parameters: { fields: {} } } },
  });

  const parameters = { formField: { slot: "trialOptions", path: "/parameters" } };
  const bindingId = { state: "search" };
  const withParameters = expand("trial", { ...member, draft: "metricEditor", parameters, bindingId }, table);
  assert.deepEqual(withParameters.placement.readOperationInputs?.testExecute, {
    draft: { slot: "metricEditor" }, parameters, bindingId,
  });
  assert.throws(() => expand("approve", {
    component: "OperationButton", operation: approve.id, target: "selected", draft: "metricEditor",
  }), /Member 'approve', field 'draft'.*requires an operation that reads a form draft/);
});

test("short forms share the object input between the form read and save operation", () => {
  const { projection } = expand("form", {
    component: "ObjectForm", target: "selected", data: { form: "form", createForm: "createForm" }, operation: save.id,
  });
  assert.deepEqual(projection.data.form.source, { object: { input: "target" } });
  assert.deepEqual(projection.operations?.save.target, { input: "target" });
  assert.deepEqual(projection.data.createForm.source, { type: { kind: "PlatformObjectType", id: type } });
});

test("short authoring reports bad ports and ambiguous operations at the member's field", () => {
  assert.throws(() => expand("list", {
    component: "ObjectList", type, data: { rows: "query" }, state: { selected: "other" },
  }), /Member 'list', field 'state.selected'.*cannot receive component output/);
  assert.throws(() => expand("list", {
    component: "ObjectList", type, data: { rows: "query" }, state: { navigate: "selected" },
  }), /Member 'list', field 'state.navigate'.*registered read parameter/);
  assert.throws(() => expand("approve", {
    component: "OperationButton", operation: approve.id, target: "selected", config: { operation: "delete" },
  }), /Member 'approve', field 'config.operation'.*Expected 'approve'/);
  assert.throws(() => expand("approve", {
    component: "OperationButton", operation: approve.id,
  }, { objectTypes: { ...typeTable.objectTypes, org: { reads: undefined, operations: [approve] } } }),
  /Member 'approve', field 'operation'.*ambiguous/);
});

test("a required read parameter can come from the component's declared runtime values", () => {
  const owner = "platform:OntologyType";
  const table = { objectTypes: {
    [owner]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[owner].reads }),
  } };
  const member = panelAuthoringMemberSchema.parse({
    component: "Graph", type: owner, data: { neighborhood: "neighbors" },
  });
  assert("component" in member);
  const graph = (runtimeParams: string[]) => buildComponent("Graph", {
    data: { "*": { results: ["panelGraphNeighbors"], required: false, runtimeParams } },
  });
  assert.deepEqual(expandPanelAuthoringMember("graph", member, {
    state, typeTable: table, components: [graph(["node"])],
  }).projection.data.neighborhood.params, {});
  assert.throws(() => expandPanelAuthoringMember("graph", member, {
    state, typeTable: table, components: [graph([])],
  }), /Member 'graph', field 'data.neighborhood.params.node'.*Required/);
});

test("ontology object lists expose the four layers as the selected output", () => {
  const ontologyType = "platform:OntologyType";
  const typeTable = { objectTypes: {
    [ontologyType]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[ontologyType].reads }),
  } };
  const component = buildComponent("ObjectList", {
    data: { objects: { results: ["panelOntologyObjects"], required: false } },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
    },
  });
  const node = { kind: "object-union", layers: ["fact", "capability", "governance", "product"] };
  const checked = { kind: "list", items: { kind: "object", objectType: ontologyType } };
  const state = panelManifestSchema.parse({
    state: { selected: { type: node }, checked: { type: checked } },
    members: {}, commands: {},
  }).state;
  const member = panelAuthoringMemberSchema.parse({
    component: "ObjectList", type: ontologyType, state: { selected: "selected" },
    data: { objects: { read: "objects", params: { type: { literal: "platform:User" } } } },
  });
  assert("component" in member);
  const expanded = expandPanelAuthoringMember("nodes", member, { state, typeTable, components: [component] });
  assert.deepEqual(expanded.projection.outputs, { selected: node });
  assert.throws(() => expandPanelAuthoringMember("nodes", { ...member, state: { checked: "checked" } }, {
    state, typeTable, components: [component],
  }), /Member 'nodes', field 'state.checked'.*list state requires one object type/);
  assert.throws(() => expandPanelAuthoringMember("nodes", member, {
    state: { ...state, selected: { ...state.selected, type: { kind: "object", objectType: ontologyType } } },
    typeTable, components: [component],
  }), /Member 'nodes', field 'state.selected'.*cannot receive component output/);
});

test("a short conversation entry stores its target and prefill on an ordinary projection", () => {
  const component = buildComponent("ConversationEntry", { data: {} });
  const prefill = "Review this domain's business knowledge entries.";
  const member = panelAuthoringMemberSchema.parse({ component: "ConversationEntry", agent: "page-default", prefill });
  assert("component" in member);
  const { projection, placement } = expandPanelAuthoringMember("governance", member, {
    state, components: [component], typeTable,
  });
  assert.deepEqual(placement, {});
  assert.deepEqual(productProjectionInputSchema.parse({
    ...projection, name: "Governance", description: "", visibility: "domain",
  }), {
    name: "Governance", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ConversationEntry", inputs: {}, outputs: {}, data: {}, config: {},
    conversationEntry: { target: { kind: "page-default" }, prefill },
  });

  for (const agent of [{ kind: "id", id: "review-agent" }, { kind: "preset", agentKind: "knowledge-governance" }]) {
    const specified = panelAuthoringMemberSchema.parse({ component: "@ontomato/sdk:ConversationEntry", agent });
    assert("component" in specified);
    const expanded = expandPanelAuthoringMember("review", specified, { state, components: [component], typeTable });
    assert.deepEqual(expanded.projection.conversationEntry, { target: agent });
  }
});

test("short graph ports resolve their individual datum owners and bind personal positions", () => {
  const nodeType = "platform:ObjectType";
  const edgeType = "platform:Relationship";
  const object = (objectType: string) => ({ kind: "object", objectType });
  const positions = { kind: "node-positions" };
  const graph = buildComponent("ObjectGraph", {
    data: {
      nodes: { results: ["panelRecordList"], required: true },
      edges: { results: ["panelRecordList"], required: false },
    },
    inputs: { positions },
    outputs: {
      positions,
      selectedNode: object("@data:nodes"),
      selectedEdge: object("@data:edges"),
      checked: { kind: "list", items: object("@data:nodes") },
    },
  });
  const table = { objectTypes: Object.fromEntries([nodeType, edgeType].map(id => [
    id, platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[id].reads }),
  ])) };
  const member = panelAuthoringMemberSchema.parse({
    component: "ObjectGraph",
    data: { nodes: { type: nodeType, read: "list" }, edges: { type: edgeType, read: "list" } },
    state: { selectedNode: "node", selectedEdge: "edge", checked: "checked", positions: "positions" },
  });
  assert("component" in member);
  const graphState = panelManifestSchema.parse({
    state: {
      node: { type: object(nodeType) }, edge: { type: object(edgeType) },
      checked: { type: { kind: "list", items: object(nodeType) } },
      positions: { type: positions, personal: true },
    },
    members: {}, commands: {},
  }).state;
  const context = { state: graphState, components: [graph], typeTable: table };
  const { projection, placement } = expandPanelAuthoringMember("scope", member, context);
  assert.deepEqual(projection.data.nodes.source, { type: { kind: "PlatformObjectType", id: nodeType } });
  assert.deepEqual(projection.data.edges.source, { type: { kind: "PlatformObjectType", id: edgeType } });
  assert.deepEqual(projection.inputs, { positions });
  assert.deepEqual(projection.outputs, {
    positions,
    selectedNode: object(nodeType),
    selectedEdge: object(edgeType),
    checked: { kind: "list", items: object(nodeType) },
  });
  assert.deepEqual(placement.inputs, { positions: { state: "positions" } });
  assert.deepEqual(placement.outputs?.positions, { state: "positions" });
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...projection, name: "Scope", description: "", visibility: "domain",
  }));
  assert.throws(() => expandPanelAuthoringMember("scope", {
    ...member, data: { nodes: member.data!.nodes },
  }, context), /Member 'scope', field 'state.selectedEdge'.*requires data 'edges'/);
  assert.throws(() => expandPanelAuthoringMember("scope", {
    ...member, state: { selectedEdge: "node" },
  }, context), /Member 'scope', field 'state.selectedEdge'.*cannot receive component output/);
});

test("a datum's object owner cannot replace the target state's type", () => {
  const otherType = "platform:AgentDefinition";
  const member = panelAuthoringMemberSchema.parse({
    component: "ObjectForm", target: "selected", data: { form: { type: otherType, read: "form" } },
  });
  assert("component" in member);
  assert.throws(() => expandPanelAuthoringMember("form", member, {
    state, components, typeTable: { objectTypes: {
      ...typeTable.objectTypes, [otherType]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[otherType].reads }),
    } },
  }), /Member 'form', field 'data.form.type'.*does not match target state type/);
});

test("a chart short member binds only the formal projection returned for its source card", () => {
  const sourceCard = { dashboardId: "board", cardId: "card" };
  const source = { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(sourceCard) } } };
  const projection = {
    id: "chart-from-owner", domainId: "domain", ownerId: "viewer", name: "Report chart", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:MetricChart", revision: 1, editable: true, metricId: "metric",
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
    inputs: { region: search }, outputs: {}, config: {},
    data: {
      template: { source, read: "chartTemplate", params: {} },
      result: { source, read: "result", params: { region: { input: "region" } } },
    },
  };
  const member = panelAuthoringMemberSchema.parse({ component: "MetricChart", sourceCard, state: { region: "search" } });
  assert("component" in member);
  assert.deepEqual(bindPanelAuthoringChart("chart", member, { state, projection }), {
    target: { projectionId: "chart-from-owner" }, inputs: { region: { state: "search" } },
  });
  assert.throws(() => expandPanelAuthoringMember("chart", member, { state, components, typeTable }),
    /Member 'chart', field 'sourceCard'.*chart owner/);
  assert.throws(() => bindPanelAuthoringChart("chart", {
    ...member, sourceCard: { ...sourceCard, cardId: "another-card" },
  }, { state, projection }), /Member 'chart', field 'sourceCard'.*different source card/);
  assert.throws(() => bindPanelAuthoringChart("chart", { ...member, state: { absent: "search" } }, { state, projection }),
    /Member 'chart', field 'state.absent'.*does not expose this input/);
  assert.throws(() => bindPanelAuthoringChart("chart", { ...member, state: { region: "selected" } }, { state, projection }),
    /Member 'chart', field 'state.region'.*incompatible type/);
});

test("short listColumn, listRowDetail and formField members support omitted data, row inputs, operationParams and object-union targets", () => {
  const toolsBadge = buildComponent("ToolsBadge", {
    componentId: "@ontomato/sdk:ToolsBadge",
    role: "presentation",
    meaning: "Renders an MCP tool list",
    inputs: { tools: { kind: "json" } },
  });
  const customControl = buildComponent("CronField", {
    componentId: "@ontomato/sdk:CronField",
    role: "control",
    meaning: "Custom cron input",
  });
  const summary = buildComponent("ObjectSummary", {
    data: { record: { results: ["panelRecord"], required: true } },
    inputs: {},
    outputs: {},
  });
  const extraComponents = [...components, toolsBadge, customControl, summary];

  // 1. listColumn without data (expands to data: {}) with itemField input.
  const cellMember = panelAuthoringMemberSchema.parse({
    component: "@ontomato/sdk:ToolsBadge",
    listColumn: { slot: "list", column: "tools" },
    inputs: { tools: { itemField: "tools" } },
  });
  assert("component" in cellMember);
  const cellExpanded = expandPanelAuthoringMember("toolsCell", cellMember, {
    state, components: extraComponents, typeTable,
  });
  assert.deepEqual(cellExpanded.projection.data, {});
  assert.deepEqual(cellExpanded.projection.inputs, { tools: { kind: "json" } });
  assert.deepEqual(cellExpanded.placement, {
    inputs: { tools: { itemField: "tools" } },
    listColumn: { slot: "list", column: "tools" },
  });

  // 2. listColumn with row action button + operationParams (literal, state, itemField, input).
  const actionMember = panelAuthoringMemberSchema.parse({
    component: "OperationButton",
    listColumn: { slot: "list", column: "actions" },
    type,
    operation: approve.id,
    inputs: { target: { item: true }, rowId: { item: "primaryKey" } },
    operationParams: {
      force: { literal: true },
      note: { state: "search" },
      sourceRow: { input: "rowId" },
      extra: { itemField: "reason" },
    },
  });
  assert("component" in actionMember);
  const actionExpanded = expandPanelAuthoringMember("approveRow", actionMember, {
    state, components: extraComponents, typeTable,
  });
  assert.deepEqual(actionExpanded.projection.data, {});
  assert.deepEqual(actionExpanded.projection.operations?.approve, {
    operation: { kind: "PlatformOperation", id: approve.id },
    target: { input: "target" },
    params: {
      force: { literal: true },
      note: { input: "note" },
      sourceRow: { input: "rowId" },
      extra: { input: "extra" },
    },
  });
  assert.deepEqual(actionExpanded.placement, {
    inputs: {
      target: { item: true },
      rowId: { item: "primaryKey" },
      note: { state: "search" },
      extra: { itemField: "reason" },
    },
    listColumn: { slot: "list", column: "actions" },
  });
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...actionExpanded.projection, name: "Approve row", description: "", visibility: "domain",
  }));

  // 3. listRowDetail with its own data read bound via { item: true }.
  const detailMember = panelAuthoringMemberSchema.parse({
    component: "ObjectSummary",
    listRowDetail: { slot: "list" },
    type,
    inputs: { target: { item: true } },
    data: { record: "record" },
  });
  assert("component" in detailMember);
  const detailExpanded = expandPanelAuthoringMember("rowDetail", detailMember, {
    state, components: extraComponents, typeTable,
  });
  assert.deepEqual(detailExpanded.projection.data.record, {
    source: { object: { input: "target" } },
    read: "record",
    params: {},
  });
  assert.deepEqual(detailExpanded.placement, {
    inputs: { target: { item: true } },
    listRowDetail: { slot: "list" },
  });

  // 4. formField without data expands cleanly to data: {}.
  const fieldMember = panelAuthoringMemberSchema.parse({
    component: "@ontomato/sdk:CronField",
    formField: { slot: "form", path: "/cron" },
  });
  assert("component" in fieldMember);
  const fieldExpanded = expandPanelAuthoringMember("cron", fieldMember, {
    state, components: extraComponents, typeTable,
  });
  assert.deepEqual(fieldExpanded.projection.data, {});
  assert.deepEqual(fieldExpanded.placement, { formField: { slot: "form", path: "/cron" } });

  // 5. Shorthand rejects listColumn with data, and accepts object-union target state for operations.
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectSummary",
    listColumn: { slot: "list", column: "a" },
    type,
    data: { record: "record" },
  }).success, false);

  const unionState = panelManifestSchema.parse({
    state: {
      chosen: { type: { kind: "object-union", objectTypes: [type, "platform:ScheduledTask"] } },
    },
    members: {},
    commands: {},
  }).state;
  const unionOpMember = panelAuthoringMemberSchema.parse({
    component: "OperationButton",
    type,
    target: "chosen",
    operation: approve.id,
  });
  assert("component" in unionOpMember);
  const unionOpExpanded = expandPanelAuthoringMember("approveChosen", unionOpMember, {
    state: unionState, components: extraComponents, typeTable,
  });
  assert.equal(unionOpExpanded.projection.inputs.knowledge?.kind, "object-union");
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...unionOpExpanded.projection, name: "Approve chosen", description: "", visibility: "domain",
  }));
});
