import { formOptionSchema } from "./form-fields";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE, DELETE_SKILL, EXPORT_FEEDBACK, EXPORT_SKILL,
  FEEDBACK_RECORD, IMPORT_SKILL, KNOWLEDGE_GOVERNANCE_RECORD, SKILL,
} from "./panel-client-requests";
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_DEFINITION, ATTRIBUTE, DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW,
  OBJECT_TYPE, RELATIONSHIP, SET_METRIC_VIEW_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW, USER,
  bindingKey, clientSends, panelClientReads,
} from "./panel-client-requests";
import { candidatePanelSourceSchema, panelFrameMessageSchema, panelUsePath } from "./panel-host";
import { panelChildObjectIdentitySchema, panelManifestSchema, panelStateValueSchema } from "./panel-manifest";
import { pageDraftSchema } from "./page-draft";
import {
  panelFormDescriptionSchema, panelFormFrequencyValueSchema, panelFormRequestSchema, panelFormSaveInputSchema,
  projectionBindingKeys, projectionOperations, projectionPorts,
} from "./panel-projection";
import { platformTaskFrequencySchema } from "./platform-schedules";
import { DEFINITION, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, USER as ONTOLOGY_USER, platformObjectTypes, platformRelationKinds } from "./platform-object-types";
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

const editableField = { required: false, readOnly: false };
const ownerSave = { method: "PUT", path: "/workflows/example", bodySchema: {}, draftOperation: "workflow.update" };

test("code, number, time and line array controls retain the owner's JSON values and schema", () => {
  const fields = [
    { ...editableField, path: "/definition", label: "Definition", control: { kind: "code", language: "json" },
      valueSchema: { type: "object" } },
    { ...editableField, path: "/limit", label: "Limit", control: { kind: "number" },
      valueSchema: { type: "integer", minimum: 0 } },
    { ...editableField, path: "/start", label: "Start", control: { kind: "time" },
      valueSchema: { type: "string", format: "time" } },
    { ...editableField, readOnly: true, path: "/script", label: "Script", control: { kind: "code", language: "python" },
      valueSchema: { type: "string" } },
    { ...editableField, path: "/questions", label: "Matching questions", control: { kind: "string-array" },
      valueSchema: { type: "array", items: { type: "string" } } },
  ];
  const values = {
    definition: { output: ["name"] }, limit: 0, start: "09:00",
    script: "print('ready')", questions: ["Who joined?", "Who left?"],
  };
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields, values, save: ownerSave }), {
    fields, values, save: ownerSave,
  });
});

test("nested controls keep relative field metadata and the existing absolute reference port", () => {
  const fields = [
    {
      ...editableField, path: "/steps", label: "Steps", valueSchema: { type: "array" },
      control: {
        kind: "object-array", itemKeyPath: "/id", defaultItem: { actionId: null },
        itemFields: [{
          ...editableField, path: "/actionId", label: "Action", valueSchema: { type: ["string", "null"] },
          control: { kind: "reference", objectType: "platform:Action", multiple: false },
        }],
      },
    },
    {
      ...editableField, path: "/runContract", label: "Run contract", valueSchema: { type: ["object", "null"] },
      control: {
        kind: "object", defaultObject: { statusOpen: [] },
        fields: [{
          ...editableField, path: "/statusOpen", label: "Open statuses", valueSchema: { type: "array" },
          control: { kind: "select", multiple: true, allowCreate: true, options: [] },
        }],
      },
    },
  ];
  const values = { steps: [{ id: "step-a", actionId: "review" }], runContract: { statusOpen: ["ready"] } };
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields, values, save: ownerSave }).fields, fields);

  const path = "/steps/0/actionId";
  const formField = { slot: "definition", path };
  const manifest = panelManifestSchema.parse({
    state: {}, operations: [],
    slots: { definition: { projectionId: "workflow-form" }, picker: { projectionId: "action-picker", formField } },
  });
  assert.deepEqual(manifest.slots.picker?.formField, formField);
  const target = { kind: "object", objectType: "platform:Workflow", primaryKey: "example" };
  assert.equal(panelFormRequestSchema.parse({ target, values, changedField: path }).changedField, path);
});

test("frequency uses the scheduled-task value and keeps time zone in a separate field", () => {
  assert.equal(panelFormFrequencyValueSchema, platformTaskFrequencySchema);
  const frequency = panelFormFrequencyValueSchema.parse({ kind: "weekly", weekday: 1, time: "09:00" });
  const timeZone = "Asia/Shanghai";
  const values = { condition: { frequency, timeZone } };
  const field = {
    ...editableField, path: "/condition/frequency", label: "Frequency", control: { kind: "frequency" },
    valueSchema: { $ref: "#/$defs/frequency" },
  };
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields: [field], values, save: ownerSave }).values, values);
  assert.equal(panelFormFrequencyValueSchema.safeParse({ ...frequency, timeZone }).success, false);
});

test("submitted field pointers stay separate from draft values and their presence", () => {
  const omitted = { steps: [{ actionId: "review" }] };
  const explicitNull = { ...omitted, runContract: null };
  const draft = { pageKey: "workflows", operation: "workflow.update", target: { id: "example" } };
  assert.deepEqual(pageDraftSchema.parse({ ...draft, form: omitted }).form, omitted);
  assert.deepEqual(pageDraftSchema.parse({ ...draft, form: explicitNull }).form, explicitNull);

  for (const submittedFields of [undefined, [], ["/runContract", "/steps/0/actionId"]]) {
    const input = { values: explicitNull, ...(submittedFields === undefined ? {} : { submittedFields }) };
    assert.deepEqual(panelFormSaveInputSchema.parse(input), input);
  }
  assert.equal(panelFormSaveInputSchema.safeParse({ values: omitted, submittedFields: ["steps/0/actionId"] }).success, false);
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


test("MetricView and Function management reads do not grant operation or concrete data access", () => {
  for (const [type, root] of [[METRIC_VIEW, "/metricView"], [FUNCTION, "/function"]] as const) {
    const resource = binding(type);
    const reads = panelClientReads(resource);
    for (const route of ["queryList", "queryById", "form"]) {
      const path = `${root}/${route}`;
      assert.ok(reads.some(read => read.method === "POST" && read.service === "/data-query" && read.path.test(path)));
      assert.ok(clientSends([resource], "POST", "/data-query", path));
    }
    assert.ok(clientSends([resource], "POST", "/data-query", `${root}/save`));
    assert.ok(!reads.some(read => read.path.test(`${root}/save`)));
    assert.ok(!clientSends([resource], "POST", "/data-query", `${root}/delete`));
  }

  assert.ok(!clientSends([binding(METRIC_VIEW)], "POST", "/data-query", "/metricView/execute"));
  assert.ok(!clientSends(["MetricView:example"], "POST", "/data-query", "/metricView/queryById"));

  for (const [operation, path] of [
    [DELETE_METRIC_VIEW, "/metricView/delete"],
    [SET_METRIC_VIEW_STATUS, "/metricView/setStatus"],
    [TEST_METRIC_VIEW, "/metricView/test"],
    [TEST_EXECUTE_METRIC_VIEW, "/metricView/testExecute"],
    [DELETE_FUNCTION, "/function/delete"],
  ] as const) {
    const operationKey = bindingKey({ kind: "PlatformOperation", id: operation });
    assert.ok(clientSends([operationKey], "POST", "/data-query", path));
    assert.ok(!clientSends([operationKey], "GET", "/data-query", path));
    assert.ok(!clientSends([operationKey], "POST", "", path));
  }
});


test("owner select options preserve integer status and customizable string tags", () => {
  const option = { description: null, disabled: false, disabledReason: null };
  const fields = [
    {
      ...editableField, path: "/status", label: "Status", valueSchema: { type: "integer", enum: [0, 1] },
      control: { kind: "select", options: [
        { ...option, value: 0, label: "Pending" }, { ...option, value: 1, label: "Approved" },
      ] },
    },
    {
      ...editableField, path: "/knowledgeTags", label: "Tags", valueSchema: { type: "array", items: { type: "string" } },
      control: { kind: "select", multiple: true, allowCreate: true, options: [{ ...option, value: "policy", label: "Policy" }] },
    },
  ];
  const values = { status: 0, knowledgeTags: ["policy", "new tag"] };
  const form = panelFormDescriptionSchema.parse({ fields, values, save: ownerSave });
  assert.deepEqual(form.fields, fields);
  assert.deepEqual(panelFormSaveInputSchema.parse({ values: form.values }).values, values);
  assert.equal(formOptionSchema.safeParse({ ...option, value: 0, label: "Pending" }).success, false);
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

test("mixed graphs declare selected node types separately from the read bindings", () => {
  const nodeIdentity = { kind: "object-union", objectTypes: [ONTOLOGY_USER, DEFINITION] };
  const projection = productProjectionInputSchema.parse({
    name: "Platform ontology graph", description: "", visibility: "domain", componentId: "GraphCanvas",
    binding: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE },
    graph: { nodeIdentity, edges: {
      binding: { kind: "PlatformObjectType", id: ONTOLOGY_RELATION_KIND }, sourcePath: "/from", targetPath: "/to",
    } },
    inputs: { start: nodeIdentity }, display: {},
  });
  assert.deepEqual(projectionPorts(projection, {}).outputs?.selectedNode, nodeIdentity);
  assert.deepEqual(projection.inputs.start, nodeIdentity);
  const manifest = panelManifestSchema.parse({
    state: { selected: nodeIdentity },
    slots: { graph: { projectionId: "mixed", outputs: { selectedNode: { state: "selected" } } } }, operations: [],
  });
  assert.deepEqual(manifest.state.selected, { ...nodeIdentity, deepLink: false });
  const user = panelStateValueSchema.parse({ className: ONTOLOGY_USER, primaryKey: "shared-key" });
  const definition = panelStateValueSchema.parse({ className: DEFINITION, primaryKey: "shared-key" });
  assert.notDeepEqual(user, definition);
});

test("platform ontology routes are semantic reads on the declared bindings", () => {
  for (const [method, name] of [
    ["GET", "schema"], ["GET", "counts"], ["GET", "start"], ["POST", "neighbors"], ["POST", "objects"],
  ] as const) {
    const path = `/platform-ontology/${name}`;
    assert.ok(clientSends([binding(ONTOLOGY_TYPE), binding(ONTOLOGY_RELATION_KIND)], method, "", path));
    assert.ok(panelClientReads(binding(ONTOLOGY_TYPE)).some(read => read.method === method && read.path.test(path)));
    assert.ok(!clientSends([binding(OBJECT_TYPE)], method, "", path));
  }
  assert.ok(!clientSends([binding(ONTOLOGY_TYPE)], "POST", "", "/platform-ontology/delete"));
});

test("the four-layer topology points to declared kinds and distinguishes stored and derived edges", () => {
  for (const relation of platformRelationKinds) {
    assert.ok(platformObjectTypes[relation.from]?.labelKey);
    for (const target of typeof relation.to === "string" ? [relation.to] : relation.to)
      assert.ok(platformObjectTypes[target]?.labelKey);
  }
  assert.equal(platformRelationKinds.find(relation => relation.id === "user.published-workflow")?.derived, false);
  assert.equal(platformRelationKinds.find(relation => relation.id === "role.can-author-workflow")?.derived, true);
});
