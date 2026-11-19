import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE, DELETE_SKILL, EXPORT_FEEDBACK, EXPORT_SKILL,
  FEEDBACK_RECORD, IMPORT_SKILL, KNOWLEDGE_GOVERNANCE_RECORD, SKILL,
} from "./panel-client-requests";
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DEFINITION, ATTRIBUTE, MCP_SERVICE_OPTION, OBJECT_TYPE, RELATIONSHIP, USER, bindingKey, clientSends, panelClientReads } from "./panel-client-requests";
import { candidatePanelSourceSchema, panelFrameMessageSchema, panelUsePath } from "./panel-host";
import { panelChildObjectIdentitySchema, panelManifestSchema } from "./panel-manifest";
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


test("knowledge, governance, feedback and skill reads stay at their declared owners", () => {
  for (const [resource, method, service, path] of [
    [BUSINESS_KNOWLEDGE, "POST", "/data-query", "/admin/getBussinessKnowledge"],
    [BUSINESS_KNOWLEDGE, "POST", "/data-query", "/admin/bussinessKnowledge/form"],
    [KNOWLEDGE_GOVERNANCE_RECORD, "GET", "/data-query", "/ontology/ai/knowledge-governance/record/work"],
    [KNOWLEDGE_GOVERNANCE_RECORD, "GET", "/data-query", "/ontology/ai/knowledge-governance/record/sources/evidence?offset=20"],
    [FEEDBACK_RECORD, "GET", "", "/feedback?rating=like&limit=20"],
    [FEEDBACK_RECORD, "GET", "", "/feedback/12a207b7-e868-45e5-a52d-e15f85447447"],
    [SKILL, "GET", "", "/skills/skill/file?path=references%2Fguide.md"],
  ] as const) {
    const key = binding(resource);
    assert.ok(clientSends([key], method, service, path));
    assert.ok(panelClientReads(key).some(read => read.method === method && read.service === service && read.path.test(path)));
  }

  for (const [operation, method, service, path] of [
    [APPROVE_KNOWLEDGE, "POST", "/data-query", "/admin/editBussinessKnowledge"],
    [DELETE_KNOWLEDGE, "POST", "/data-query", "/admin/delBussinessKnowledge"],
    [DELETE_SKILL, "DELETE", "", "/skills/skill"],
    [IMPORT_SKILL, "POST", "", "/skills/import?overwrite=true"],
    [EXPORT_SKILL, "GET", "", "/skills/skill/export"],
    [EXPORT_FEEDBACK, "GET", "", "/feedback/export?keyword=sample"],
  ] as const) {
    const key = bindingKey({ kind: "PlatformOperation", id: operation });
    assert.ok(clientSends([key], method, service, path));
    assert.ok(!panelClientReads(key).some(read => read.path.test(path)));
  }

  assert.ok(!clientSends([binding(SKILL)], "GET", "", "/skills/skill/export"));
  assert.ok(!clientSends([binding(FEEDBACK_RECORD)], "GET", "", "/feedback/export"));
  assert.ok(!clientSends([binding(FEEDBACK_RECORD)], "GET", "", "/feedback/state"));
  assert.ok(!clientSends([binding(KNOWLEDGE_GOVERNANCE_RECORD)], "POST", "/data-query",
    "/ontology/ai/knowledge-governance/record/runs/run/actions/approve"));
});

test("a child key is meaningful with its parent identity", () => {
  const child = { parent: { objectType: SKILL, primaryKey: "skill-a" }, primaryKey: "references/guide.md" };
  assert.deepEqual(panelChildObjectIdentitySchema.parse(child), child);
  assert.equal(panelChildObjectIdentitySchema.safeParse({ primaryKey: child.primaryKey }).success, false);
});
