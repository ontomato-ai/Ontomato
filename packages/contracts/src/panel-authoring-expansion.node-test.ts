import assert from "node:assert/strict";
import { test } from "node:test";
import { appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import { expandPanelAuthoringMember, panelAuthoringMemberSchema, panelManifestSchema } from "./panel-check";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { platformObjectTypes } from "./platform-object-types";
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
  buildComponent("OperationButton", { data: {} }),
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
  [type]: { reads: platformObjectTypes[type].reads, operations: [approve, save] },
} };
const state = panelManifestSchema.parse({
  state: {
    selected: { type: selected }, search: { type: search },
    other: { type: { kind: "object", objectType: "org" } },
  },
  members: {}, events: {},
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
