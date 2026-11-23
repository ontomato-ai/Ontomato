import assert from "node:assert/strict";
import { test } from "node:test";
import { appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import { bindPanelAuthoringChart, expandPanelAuthoringMember, panelAuthoringMemberSchema, panelManifestSchema } from "./panel-check";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { declaredCustomerFormSaveName } from "./panel-projection";
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
  members: {},
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
  const writeWithDraft = expand("approve", {
    component: "OperationButton", operation: approve.id, target: "selected", draft: "metricEditor",
  });
  assert.deepEqual(writeWithDraft.placement.operationDrafts, { approve: { slot: "metricEditor" } });
  const nonDraftRead = panelOperationDeclarationSchema.parse({
    id: "knowledge.export", kind: "action", effect: "read", batch: false,
    target: { source: "none" }, inputSchema: { type: "object" },
  });
  assert.throws(() => expand("exporter", {
    component: "OperationButton", operation: nonDraftRead.id, draft: "metricEditor",
  }, { objectTypes: { [type]: { reads: undefined, operations: [nonDraftRead] } } }),
    /Member 'exporter', field 'draft'.*requires a write operation or a read operation that reads a form draft/);
  assert.throws(() => expand("approve", {
    component: "OperationButton", operation: approve.id, target: "selected", parameters,
  }), /Member 'approve', field 'parameters'.*requires an operation that reads a form draft/);
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
    members: {},
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
  const positions = { kind: "json" };
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
    members: {},
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

test("short list row operations, fromSlot nested projections, object-union targets, and rejection of removed hooks", () => {
  const summary = buildComponent("ObjectSummary", {
    data: { record: { results: ["panelRecord"], required: true } },
    inputs: {},
    outputs: {},
  });
  const extraComponents = [...components, summary];

  // 1. ObjectList declares row operations directly on the projection (`target: { row: true }` + row params).
  const listWithRowOps = panelAuthoringMemberSchema.parse({
    component: "ObjectList",
    type,
    data: { rows: "query" },
    operations: {
      approve: {
        operation: approve.id,
        target: { row: true },
        params: {
          force: { literal: true },
          note: { state: "search" },
          sourceRow: { row: "primaryKey" },
          extra: { rowField: "reason" },
        },
      },
    },
  });
  assert("component" in listWithRowOps);
  const listExpanded = expandPanelAuthoringMember("items", listWithRowOps, {
    state, components: extraComponents, typeTable,
  });
  assert.deepEqual(listExpanded.projection.operations?.approve, {
    operation: { kind: "PlatformOperation", id: approve.id },
    target: { row: true },
    params: {
      force: { literal: true },
      note: { input: "note" },
      sourceRow: { row: "primaryKey" },
      extra: { rowField: "reason" },
    },
  });
  assert.deepEqual(listExpanded.placement.inputs?.note, { state: "search" });
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...listExpanded.projection, name: "Items with row actions", description: "", visibility: "domain",
  }));

  // 2. Nested projection inside `#row-detail` receives its target from Vue slot via `{ fromSlot: true }`.
  const detailMember = panelAuthoringMemberSchema.parse({
    component: "ObjectSummary",
    type,
    inputs: { target: { fromSlot: true } },
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
  assert.equal(detailExpanded.placement.inputs, undefined);

  // 3. Removed listColumn / listRowDetail / formField / item / itemField syntax is rejected.
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectSummary",
    listColumn: { slot: "list", column: "a" },
  }).success, false);
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectSummary",
    listRowDetail: { slot: "list" },
  }).success, false);
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectSummary",
    formField: { slot: "form", path: "/a" },
  }).success, false);
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectSummary",
    type,
    inputs: { target: { item: true } },
    data: { record: "record" },
  }).success, false);

  // 4. Accepts object-union target state for operations.
  const unionState = panelManifestSchema.parse({
    state: {
      chosen: { type: { kind: "object-union", objectTypes: [type, "platform:ScheduledTask"] } },
    },
    members: {},
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

test("customer ObjectType expands standard form/createForm, cross-member operations.<name>.draft, and ObjectRefCard navigate output", async () => {
  const { customerOntologyReads } = await import("./platform-object-types");
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const { productProjectionInputSchema } = await import("./product-panels");
  const updateCustomerAction = panelOperationDeclarationSchema.parse({
    id: "action-update-student", kind: "action", effect: "write", batch: false,
    target: { source: "input", input: "target" },
    inputSchema: { type: "object", properties: { values: { type: "object", properties: { name: { type: "string" } } } }, required: ["values"] },
  });
  const customerTable = platformTypeTableResponseSchema.parse({
    objectTypes: {
      ...typeTable.objectTypes,
      Student: { reads: customerOntologyReads, operations: [updateCustomerAction] },
      "platform:Relationship": {
        reads: { record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" } },
        operations: [save],
      },
    },
    resultSchemas: {
      panelRecordQuery: {},
      panelGroupCounts: {},
      panelRecord: {},
      panelFormDescription: {},
    },
  });
  const customerState = panelManifestSchema.parse({
    state: {
      selectedStudent: { type: { kind: "object", objectType: "Student" } },
      selectedRelation: { type: { kind: "object", objectType: "platform:Relationship" } },
      navigatedObjectType: { type: { kind: "object", objectType: "platform:ObjectType" } },
      navigatedAny: { type: { kind: "object-union", layers: ["fact", "capability", "governance", "product"], objectTypes: ["platform:OntologyType"] } },
    },
    members: {},
  }).state;
  const extendedComponents: Parameters<typeof expandPanelAuthoringMember>[2]["components"] = [
    ...components,
    buildComponent("ObjectRefCard", {
      role: "presentation",
      meaning: "Reference card",
      data: { record: { results: ["panelRecord"], required: false }, result: { results: ["metricOutput"], required: false } },
      outputs: {
        navigate: {
          kind: "object-union",
          layers: ["fact", "capability", "governance", "product"],
          objectTypes: ["platform:OntologyType"],
        },
      },
    }),
  ];

  // 1. Customer ObjectType ObjectForm expands form + createForm + customer write Action.
  const studentFormMember = panelAuthoringMemberSchema.parse({
    component: "ObjectForm",
    type: "Student",
    target: "selectedStudent",
    data: { form: "form", createForm: "createForm" },
    operation: updateCustomerAction.id,
  });
  assert("component" in studentFormMember);
  const studentFormExpanded = expandPanelAuthoringMember("studentForm", studentFormMember, {
    state: customerState, components: extendedComponents, typeTable: customerTable,
  });
  assert.deepEqual(studentFormExpanded.projection.data.form.source, { object: { input: "target" } });
  assert.deepEqual(studentFormExpanded.projection.data.createForm.source, { type: { kind: "ObjectType", id: "Student" } });
  assert.deepEqual(studentFormExpanded.projection.operations, {
    "action-update-student": {
      operation: { kind: "Action", id: "action-update-student" },
      target: { input: "target" },
    },
  });
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...studentFormExpanded.projection, name: "Student form", description: "", visibility: "domain",
  }));

  // 2. Cross-member write operation with draft in both `operation` + `draft` and `operations.<name>.draft`.
  const crossSaveMember = panelAuthoringMemberSchema.parse({
    component: "OperationButton",
    type: "platform:Relationship",
    operations: {
      save: { operation: save.id, draft: "relationForm" },
    },
  });
  assert("component" in crossSaveMember);
  const crossSaveExpanded = expandPanelAuthoringMember("headerSave", crossSaveMember, {
    state: customerState, components: extendedComponents, typeTable: customerTable,
  });
  assert.deepEqual(crossSaveExpanded.placement.operationDrafts, { save: { slot: "relationForm" } });

  // 3. ObjectRefCard declarative `state: { navigate }` output port works with targetClassName, direct record, and object-union.
  const typedEndpointCard = panelAuthoringMemberSchema.parse({
    component: "ObjectRefCard",
    type: "platform:Relationship",
    target: "selectedRelation",
    data: { record: "record" },
    config: { field: "fromclass", targetClassName: "platform:ObjectType" },
    state: { navigate: "navigatedObjectType" },
  });
  assert("component" in typedEndpointCard);
  const typedCardExpanded = expandPanelAuthoringMember("sourceCard", typedEndpointCard, {
    state: customerState, components: extendedComponents, typeTable: customerTable,
  });
  assert.deepEqual(typedCardExpanded.projection.outputs.navigate, { kind: "object", objectType: "platform:ObjectType" });
  assert.deepEqual(typedCardExpanded.placement.outputs, { navigate: { state: "navigatedObjectType" } });

  const unionEndpointCard = panelAuthoringMemberSchema.parse({
    component: "ObjectRefCard",
    type: "platform:Relationship",
    target: "selectedRelation",
    data: { record: "record" },
    config: { field: "fromObject" },
    state: { navigate: "navigatedAny" },
  });
  assert("component" in unionEndpointCard);
  const unionCardExpanded = expandPanelAuthoringMember("unionCard", unionEndpointCard, {
    state: customerState, components: extendedComponents, typeTable: customerTable,
  });
  assert.equal(unionCardExpanded.projection.outputs.navigate.kind, "object-union");
  assert.deepEqual(unionCardExpanded.placement.outputs, { navigate: { state: "navigatedAny" } });

  const selfRecordCard = panelAuthoringMemberSchema.parse({
    component: "ObjectRefCard",
    type: "Student",
    target: "selectedStudent",
    data: { record: "record" },
    state: { navigate: "selectedStudent" },
  });
  assert("component" in selfRecordCard);
  const selfCardExpanded = expandPanelAuthoringMember("studentCard", selfRecordCard, {
    state: customerState, components: extendedComponents, typeTable: customerTable,
  });
  assert.deepEqual(selfCardExpanded.projection.outputs.navigate, { kind: "object", objectType: "Student" });
});

test("cross-type collection reads declare rowType so ObjectList state.selected binds to the row object type", () => {
  const applicationType = "platform:Application";
  const panelType = "platform:ProductPanel";
  const listComponent = {
    componentId: "ObjectList",
    module: "@ontomato/sdk/base",
    exportName: "ObjectList",
    role: "control" as const,
    meaning: "Object list",
    ports: { props: [], events: [], slots: [] },
    data: {
      rows: { results: ["panelRecordList", "panelRecordQuery"] as ("panelRecordList" | "panelRecordQuery")[], required: false },
    },
    outputs: {
      selected: { kind: "object" as const, objectType: "@binding" },
      checked: { kind: "list" as const, items: { kind: "object" as const, objectType: "@binding" } },
      listed: { kind: "list" as const, items: { kind: "object" as const, objectType: "@binding" } },
    },
  };
  const appState = panelManifestSchema.parse({
    state: {
      selected: { type: { kind: "object", objectType: applicationType }, deepLink: true },
      inspectedPanel: { type: { kind: "object", objectType: panelType }, deepLink: true },
      checkedPanels: { type: { kind: "list", items: { kind: "object", objectType: panelType } } },
    },
    members: {},
  }).state;
  const appTable = {
    objectTypes: {
      [applicationType]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[applicationType].reads }),
      [panelType]: platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[panelType].reads }),
    },
  };
  // Verify the owner read declares both rowType (Item 4) and typed scalar outputs (Item 2).
  assert.equal(appTable.objectTypes[applicationType].reads?.usedPanels?.rowType, panelType);
  assert.deepEqual(appTable.objectTypes[applicationType].reads?.record?.outputs, {
    canMaintain: { kind: "scalar", type: "boolean" },
    canEditEntries: { kind: "scalar", type: "boolean" },
    canGrant: { kind: "scalar", type: "boolean" },
    domainShared: { kind: "scalar", type: "boolean" },
    openPath: { kind: "scalar", type: "string" },
  });

  const usedPanelsMember = panelAuthoringMemberSchema.parse({
    component: "ObjectList",
    type: applicationType,
    target: "selected",
    data: { rows: "usedPanels" },
    state: { selected: "inspectedPanel", checked: "checkedPanels" },
  });
  assert("component" in usedPanelsMember);
  const expanded = expandPanelAuthoringMember("usedPanelsList", usedPanelsMember, {
    state: appState,
    components: [listComponent],
    typeTable: appTable,
  });
  assert.deepEqual(expanded.projection.inputs.target, { kind: "object", objectType: applicationType });
  assert.deepEqual(expanded.projection.outputs.selected, { kind: "object", objectType: panelType });
  assert.deepEqual(expanded.projection.outputs.checked, { kind: "list", items: { kind: "object", objectType: panelType } });
  assert.deepEqual(expanded.placement.outputs, {
    selected: { state: "inspectedPanel" },
    checked: { state: "checkedPanels" },
  });

  // Binding selected to the parent Application state must be rejected when rowType is ProductPanel.
  const wrongSelection = panelAuthoringMemberSchema.parse({
    component: "ObjectList",
    type: applicationType,
    target: "selected",
    data: { rows: "usedPanels" },
    state: { selected: "selected" },
  });
  assert("component" in wrongSelection);
  assert.throws(
    () => expandPanelAuthoringMember("usedPanelsList", wrongSelection, {
      state: appState,
      components: [listComponent],
      typeTable: appTable,
    }),
    /State 'selected' cannot receive component output 'selected'/,
  );
});

test("operation params support declarative formField and formFields wiring for customer Action saves", async () => {
  const { customerOntologyReads } = await import("./platform-object-types");
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const { productProjectionInputSchema } = await import("./product-panels");
  const customerState = panelManifestSchema.parse({
    state: {
      selectedCustomer: { type: { kind: "object", objectType: "Customer" } },
    },
    members: {},
  }).state;
  const updateAction = panelOperationDeclarationSchema.parse({
    id: "action-update-customer",
    kind: "action",
    effect: "write",
    target: { source: "input", input: "target" },
    inputSchema: { type: "object", properties: { values: { type: "object", properties: {} } } },
    batch: false,
  });
  const table = platformTypeTableResponseSchema.parse({
    objectTypes: {
      ...typeTable.objectTypes,
      Customer: { reads: customerOntologyReads, operations: [updateAction] },
    },
    resultSchemas: {
      panelRecordQuery: {},
      panelGroupCounts: {},
      panelRecord: {},
      panelFormDescription: {},
    },
  });

  const member = panelAuthoringMemberSchema.parse({
    component: "ObjectForm",
    type: "Customer",
    target: "selectedCustomer",
    data: { form: "form" },
    operations: {
      save: {
        operation: updateAction.id,
        params: {
          customer_name: { formField: "/name" },
          payload: { formFields: { level: "/grade", note: "/remark" } },
        },
      },
      approveKnowledge: {
        operation: approve.id, type, target: { literal: { className: type, primaryKey: "article" } },
      },
    },
  });
  assert("component" in member);
  const expanded = expandPanelAuthoringMember("customerForm", member, {
    state: customerState,
    components,
    typeTable: table,
  });
  assert.deepEqual(expanded.projection.operations?.save?.params, {
    customer_name: { formField: "/name" },
    payload: { formFields: { level: "/grade", note: "/remark" } },
  });
  assert.equal(expanded.projection.operations?.approveKnowledge?.operation.kind, "PlatformOperation");
  assert.equal(declaredCustomerFormSaveName(expanded.projection.operations, false), "save");
  assert.doesNotThrow(() => productProjectionInputSchema.parse({
    ...expanded.projection,
    name: "Customer form",
    description: "",
    visibility: "domain",
  }));

  // Non-pointer formField and empty formFields maps are rejected by the schema.
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectForm",
    type: "Customer",
    target: "selectedCustomer",
    data: { form: "form" },
    operations: { save: { operation: updateAction.id, params: { customer_name: { formField: "name" } } } },
  }).success, false);
  assert.equal(panelAuthoringMemberSchema.safeParse({
    component: "ObjectForm",
    type: "Customer",
    target: "selectedCustomer",
    data: { form: "form" },
    operations: { save: { operation: updateAction.id, params: { payload: { formFields: {} } } } },
  }).success, false);
});

test("top-level targetless Actions expand cleanly on both ObjectForm and OperationButton without duplicating across objectTypes", async () => {
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const { customerOntologyReads } = await import("./platform-object-types");

  const table = platformTypeTableResponseSchema.parse({
    objectTypes: {
      Order: { reads: customerOntologyReads },
      AuditLog: { reads: customerOntologyReads },
    },
    operations: [
      {
        id: "create-order",
        kind: "action",
        effect: "write",
        target: { source: "none" },
        inputSchema: {
          type: "object",
          properties: { values: { type: "object", properties: { customer: { type: "string" } }, additionalProperties: false } },
          required: ["values"],
          additionalProperties: false,
        },
        batch: false,
        affects: ["Order", "AuditLog"],
      },
    ],
    resultSchemas: {
      panelRecordQuery: { type: "object" },
      panelRecord: { type: "object" },
      panelFormDescription: { type: "object" },
    },
  });

  const emptyPorts = { props: [], events: [], slots: [] };
  const formComponent: Parameters<typeof expandPanelAuthoringMember>[2]["components"][number] = {
    componentId: "ObjectForm",
    module: "@ontomato/sdk/base",
    exportName: "ObjectForm",
    role: "control",
    meaning: "Form",
    effects: "Writes",
    bindsElement: ["ObjectType:*"],
    ports: emptyPorts,
    data: {
      form: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
      createForm: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
    },
  };
  const buttonComponent: Parameters<typeof expandPanelAuthoringMember>[2]["components"][number] = {
    componentId: "OperationButton",
    module: "@ontomato/sdk/base",
    exportName: "OperationButton",
    role: "control",
    meaning: "Button",
    effects: "Writes",
    bindsElement: ["Action:*"],
    ports: emptyPorts,
    config: [{ name: "operation", type: "string", description: "Operation", required: true }],
  };

  const formMember = panelAuthoringMemberSchema.parse({
    component: "ObjectForm",
    type: "Order",
    data: { createForm: "createForm" },
    operations: { save: "create-order" },
  });
  assert("component" in formMember);
  const expandedForm = expandPanelAuthoringMember("orderCreate", formMember, {
    state: {},
    components: [formComponent, buttonComponent],
    typeTable: table,
  });
  assert.deepEqual(expandedForm.projection.operations, {
    save: { operation: { kind: "Action", id: "create-order" } },
  });

  const btnMember = panelAuthoringMemberSchema.parse({
    component: "OperationButton",
    operation: "create-order",
  });
  assert("component" in btnMember);
  const expandedBtn = expandPanelAuthoringMember("createBtn", btnMember, {
    state: {},
    components: [formComponent, buttonComponent],
    typeTable: table,
  });
  assert.deepEqual(expandedBtn.projection.operations, {
    "create-order": { operation: { kind: "Action", id: "create-order" } },
  });
});
