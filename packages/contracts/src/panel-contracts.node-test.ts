import {
  createPanelOperationIntentRequestSchema, inspectPanelOperationImpactRequestSchema, panelOperationOutcomeSchema,
  panelWriteOperationSnapshotSchema, readPanelOperationRequestSchema, readStoredPanelOperationIntent,
} from "./panel-agent";
import { panelReadOperationDescriptorSchema, panelReadOperationResultSchema } from "./panel-operations";
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DEFINITION, ATTRIBUTE, MCP_SERVICE_OPTION, OBJECT_TYPE, RELATIONSHIP, USER, bindingKey, clientSends, panelClientReads } from "./panel-client-requests";
import { candidatePanelSourceSchema, panelFrameMessageSchema, panelUsePath } from "./panel-host";
import { panelManifestSchema } from "./panel-manifest";
import { panelFormSaveInputSchema, projectionBindingKeys, projectionOperations, projectionPorts } from "./panel-projection";
import { applicationPanelUsePathSchema, ontologyElementRefSchema, productPanelContentSchema, productProjectionInputSchema } from "./product-panels";

const binding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });

test("the field port refers to another slot in the same manifest", () => {
  const picker = { projectionId: "skill-picker", formField: { slot: "definition", path: "/skills" } };
  const slots = { definition: { projectionId: "definition-form" }, picker };
  assert.deepEqual(panelManifestSchema.parse({ state: {}, slots, operations: [] }).slots.picker?.formField, picker.formField);
  assert.equal(panelManifestSchema.safeParse({ state: {}, slots: { picker }, operations: [] }).success, false);
});

test("form saves address the draft target even when the slot receives a selected object", () => {
  const agent = { kind: "object", objectType: AGENT_DEFINITION } as const;
  const manifest = panelManifestSchema.parse({
    state: { selectedAgent: agent },
    slots: { definition: { projectionId: "definition-form", inputs: { record: { state: "selectedAgent" } } } },
    operations: [],
  });
  const [save] = projectionOperations(manifest, {
    slot: "definition",
    ports: {
      binding: binding(AGENT_DEFINITION),
      inputs: { record: agent },
      operations: [{ name: "save", label: "Save", kind: "form.save", handlerRef: "platform:AgentDefinition.save", inputSchema: {} }],
    },
  });
  assert.deepEqual(save?.target, { source: "draft", slot: "definition" });
});

test("form save preserves nested JSON and the owner's revision when present", () => {
  const agent = { values: { enabled: false, modelSelection: { modelId: null }, skills: [{ namespace: { kind: "domain" }, name: "test" }] } };
  assert.deepEqual(panelFormSaveInputSchema.parse(agent), agent);
  const schedule = { values: { time: "09:00" }, revision: 17 };
  assert.deepEqual(panelFormSaveInputSchema.parse(schedule), schedule);
});

test("panel content carries flat translated text without requiring complete translations", () => {
  const messages = { en: { "graph.count": "{count} classes", "graph.empty": "No classes" }, "zh-CN": { "graph.count": "{count} 个类" } };
  const source = { html: "<main></main>", module: "export {}" };
  assert.deepEqual(productPanelContentSchema.parse({ ...source, messages }).messages, messages);
  assert.equal(productPanelContentSchema.safeParse({ ...source, messages: { en: { graph: { count: "nested" } } } }).success, false);
  assert.equal(productPanelContentSchema.safeParse({ ...source, messages: { en: { text: "类".repeat(100_000) } } }).success, false);
});

test("a graph has two admitted sources and can use either a form field or separate selection outputs", () => {
  const projection = productProjectionInputSchema.parse({
    name: "Ontology graph", description: "", visibility: "domain", componentId: "GraphCanvas",
    binding: { kind: "PlatformObjectType", id: OBJECT_TYPE },
    graph: { edges: { binding: { kind: "PlatformObjectType", id: RELATIONSHIP }, sourcePath: "/fromclass", targetPath: "/toclass" } },
    inputs: {}, display: {},
  });
  assert.deepEqual(projectionBindingKeys(projection), [binding(OBJECT_TYPE), binding(RELATIONSHIP)]);
  assert.deepEqual(projectionPorts(projection, {}).outputs, {
    selectedNode: { kind: "object", objectType: OBJECT_TYPE },
    selectedEdge: { kind: "object", objectType: RELATIONSHIP },
  });

  const range = panelManifestSchema.parse({
    state: {}, operations: [],
    slots: {
      definition: { projectionId: "definition-form" },
      range: { projectionId: "data-scope", formField: { slot: "definition", path: "/classNames" } },
    },
  });
  assert.equal(range.slots.range?.formField?.path, "/classNames");
  const state = { node: { kind: "object", objectType: OBJECT_TYPE }, edge: { kind: "object", objectType: RELATIONSHIP } };
  const outputs = { selectedNode: { state: "node" }, selectedEdge: { state: "edge" } };
  const graph = { slots: { graph: { projectionId: "ontology-model", outputs } }, operations: [] };
  assert.deepEqual(panelManifestSchema.parse({ ...graph, state }).slots.graph?.outputs, outputs);
  assert.equal(panelManifestSchema.safeParse({ ...graph, state: { node: state.node } }).success, false);
});

test("a named relationship is a binding identity and supplies no inferred edge selection type", () => {
  const relationship = { kind: "Relationship", id: "manages" };
  const projection = productProjectionInputSchema.parse({
    name: "Relationship graph", description: "", visibility: "domain", componentId: "GraphCanvas",
    binding: { kind: "PlatformObjectType", id: OBJECT_TYPE },
    graph: { edges: { binding: relationship, sourcePath: "/from", targetPath: "/to" } },
    inputs: {}, display: {},
  });
  assert.deepEqual(ontologyElementRefSchema.parse(relationship), relationship);
  assert.deepEqual(projectionBindingKeys(projection), [binding(OBJECT_TYPE), "Relationship:manages"]);
  assert.equal(projectionPorts(projection, {}).outputs?.selectedEdge, undefined);
});

test("canonical relation paths are already routable and carry no view state", () => {
  for (const path of ["/ontology/agents", "/agents/settings", "/applications/app-trial/tasks"])
    assert.equal(panelUsePath(applicationPanelUsePathSchema.parse(path)), path);
  for (const path of ["//", "//example.com/x", "/ontology/../agents/settings", "/agents/settings?mode=create"])
    assert.equal(applicationPanelUsePathSchema.safeParse(path).success, false);
});

test("a frame settles a particular draft artifact without proposing an address", () => {
  const settled = {
    kind: "draft-settled",
    draft: {
      sessionId: "5931a639-a70d-4dae-96db-6b8a4460d228",
      runId: "6a0c53c8-d21c-48cd-861e-5102be9e297b",
      path: "outputs/drafts/agent.page-draft.json",
    },
  };
  assert.deepEqual(panelFrameMessageSchema.parse(settled), settled);
  assert.equal(panelFrameMessageSchema.safeParse({ ...settled, address: "/agents/settings" }).success, false);
  assert.equal(panelFrameMessageSchema.safeParse({ ...settled, draft: { ...settled.draft, path: "outputs/report.md" } }).success, false);
});

test("candidate source needs only workspace identity, content and build-test context", () => {
  const candidate = {
    kind: "candidate",
    workspace: { id: "5931a639-a70d-4dae-96db-6b8a4460d228", ref: "a".repeat(40) },
    panel: { content: { html: "", module: "" }, manifest: { state: {}, slots: {}, operations: [] }, sdkVersion: "1.1.2" },
    previewContext: { kind: "build-test", test: null },
  };
  assert.ok(candidatePanelSourceSchema.safeParse(candidate).success);
  assert.equal(candidatePanelSourceSchema.safeParse({ ...candidate, previewContext: { kind: "live" } }).success, false);
  assert.equal(candidatePanelSourceSchema.safeParse({ ...candidate, panel: { ...candidate.panel, id: "fake", revision: 1 } }).success, false);
});

test("bridge and skill agree about the specific semantic reads", () => {
  const agents = binding(AGENT_DEFINITION);
  const form = "/assistant/agent-definitions/form";
  assert.ok(panelClientReads(agents).some((request) => request.method === "POST" && request.path.test(form)));
  assert.ok(clientSends([agents], "POST", "", form));
  assert.ok(clientSends([agents], "POST", "", "/assistant/agent-definitions"));
  assert.ok(!panelClientReads(agents).some((request) => request.method === "POST" && request.path.test("/assistant/agent-definitions")));
  assert.ok(!clientSends([agents], "DELETE", "", "/assistant/agent-definitions/form"));
  assert.ok(clientSends([binding(MCP_SERVICE_OPTION)], "GET", "", "/mcp/services/names"));
  assert.ok(!clientSends([binding(MCP_SERVICE_OPTION)], "GET", "", "/mcp/services"));
  for (const type of [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP])
    assert.ok(clientSends([binding(type)], "POST", "/data-query", "/admin/getMetas"));
  assert.ok(!clientSends([binding(OBJECT_TYPE)], "POST", "/data-query", "/admin/getschemamarkdown"));
  assert.ok(clientSends([binding(USER)], "GET", "/data-query", "/platform/agent-execution/options?selected=u"));
});


test("a read-only trial carries the current draft and parameters without a write intent", () => {
  const input = { draft: { query: { select: ["name"] } }, parameters: { limit: 3 } };
  const request = {
    applicationId: "ontology", useId: "metrics", operationId: "test.execute",
    call: { target: { kind: "draft" }, input },
  };
  assert.deepEqual(readPanelOperationRequestSchema.parse(request), request);
  assert.equal(readPanelOperationRequestSchema.safeParse({ ...request, effect: "read" }).success, false);
  const owner = {
    handlerRef: "metricViews.testExecute", effect: "read", batch: false, target: { source: "draft", slot: "definition" },
    inputSchema: { type: "object" }, resultSchema: { type: "object" },
  };
  assert.deepEqual(panelReadOperationDescriptorSchema.parse(owner), owner);
  assert.equal(panelReadOperationDescriptorSchema.safeParse({ ...owner, effect: "write" }).success, false);
  for (const result of [{ kind: "markdown", markdown: "Preview" }, { kind: "json", value: [{ count: 1 }] }]) {
    assert.deepEqual(panelReadOperationResultSchema.parse(result), result);
    assert.equal(panelReadOperationResultSchema.safeParse({ ...result, affected: { objects: [] } }).success, false);
  }
});


const operationIntentId = "bda3d9bd-afc1-4dfa-92c2-41efda234bad";
const operationTarget = { objectType: "platform:BusinessKnowledge", primaryKey: "knowledge" };

test("batch confirmation and dispatch share the same concrete calls under one intent", () => {
  const call = { target: { ...operationTarget, kind: "object" }, input: {} };
  const calls = [call, { ...call, target: { ...call.target, primaryKey: "another" } }];
  const use = { applicationId: "ontology", useId: "knowledge", operationId: "list.delete" };
  const batch = { ...use, intentId: operationIntentId, calls };
  assert.deepEqual(createPanelOperationIntentRequestSchema.parse(batch), batch);
  assert.deepEqual(inspectPanelOperationImpactRequestSchema.parse({ ...use, calls }), { ...use, calls });
  assert.equal(createPanelOperationIntentRequestSchema.safeParse({ ...batch, call }).success, false);
  assert.equal(createPanelOperationIntentRequestSchema.safeParse({
    ...batch, calls: [{ ...call, executionUserId: "another" }],
  }).success, false);
  assert.equal(panelWriteOperationSnapshotSchema.safeParse({
    id: use.operationId, label: "Delete", kind: "action", slot: "list", handlerRef: "knowledge.delete",
    target: { source: "input", input: "selection" }, inputSchema: {}, resultSchema: {}, batch: true,
  }).success, false);
});

test("batch outcomes keep owner refusals, execution failures and unknown outcomes distinct", () => {
  const affected = { objects: [operationTarget], objectTypes: [operationTarget.objectType] };
  const items = [
    { target: operationTarget, outcome: { kind: "success", data: {} } },
    { target: { ...operationTarget, primaryKey: "refused" }, outcome: { kind: "refusal", code: "FORBIDDEN", message: "Denied" } },
    { target: { ...operationTarget, primaryKey: "failed" }, outcome: { kind: "failure", code: "DEPENDENCY_UNAVAILABLE", message: "Failed" } },
    { target: { ...operationTarget, primaryKey: "unknown" }, outcome: { kind: "unknown", message: "No receipt" } },
  ];
  const outcome = { kind: "batch", items, affected };
  assert.deepEqual(panelOperationOutcomeSchema.parse(outcome), outcome);
  assert.equal(panelOperationOutcomeSchema.safeParse({ ...outcome, items: items.slice(1) }).success, false);
  assert.deepEqual(panelOperationOutcomeSchema.parse({ kind: "unknown", message: "No batch receipt" }), {
    kind: "unknown", message: "No batch receipt",
  });
});

test("legacy confirmations expire while dispatched and unknown records preserve their history", () => {
  const session = { providerId: "workbench", sessionId: "959c449b-afd0-4af9-9f2d-663fecfce14a" };
  const legacy = {
    intentId: operationIntentId, source: { session, runId: "12a207b7-e868-45e5-a52d-e15f85447447" },
    rootSession: session, use: { applicationId: "ontology", useId: "knowledge" }, panelId: "panel",
    projectionId: "projection", binding: { kind: "PlatformOperation", id: "knowledge.delete" },
    initiator: { domainId: "domain", userId: "author" }, executionUserId: null, confirmation: "required",
    questionId: operationIntentId, answer: null, dispatched: false, outcome: null,
    operation: { id: "list.delete", label: "Delete", kind: "action", slot: "list",
      handlerRef: "knowledge.delete", target: { source: "state", state: "selected" }, inputSchema: {} },
    call: { target: { ...operationTarget, kind: "object" }, input: {} },
  };
  assert.deepEqual(readStoredPanelOperationIntent(legacy), {
    kind: "confirmation-expired", intentId: operationIntentId, code: "PANEL_CONFIRMATION_EXPIRED",
  });
  for (const record of [
    { ...legacy, dispatched: true },
    { ...legacy, dispatched: true, outcome: { kind: "unknown", message: "No receipt" } },
  ]) {
    assert.deepEqual(readStoredPanelOperationIntent(record), { kind: "historical", intent: record });
  }
});
