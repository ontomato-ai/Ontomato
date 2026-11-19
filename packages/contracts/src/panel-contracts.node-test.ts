import { formOptionSchema } from "./form-fields";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE, DELETE_SKILL, EXPORT_FEEDBACK, EXPORT_SKILL,
  FEEDBACK_RECORD, IMPORT_SKILL, KNOWLEDGE_GOVERNANCE_RECORD, SKILL,
} from "./panel-client-requests";
import {
  createPanelHumanOperationIntentRequestSchema, createPanelOperationIntentRequestSchema,
  dispatchPanelHumanOperationIntentRequestSchema, inspectPanelOperationImpactRequestSchema,
  isPanelHumanOperationIntent, panelHumanOperationDispatchResponseSchema, panelHumanOperationPreparationSchema,
  panelOperationOutcomeSchema,
  panelOperationDescriptorResponseSchema, panelOperationRefSchema,
  panelWriteOperationSnapshotSchema, readPanelOperationRequestSchema, readPanelOperationResponseSchema, readStoredPanelOperationIntent,
} from "./panel-agent";
import { panelOperationImpactSchema, panelReadOperationDescriptorSchema, panelReadOperationResultSchema } from "./panel-operations";
import {
  appBridgeConfirmPanelOperationResultSchema, appBridgeConfirmPanelOperationSchema,
  appBridgeExpandPageComposerSchema, appBridgeRequestSchema, APP_BRIDGE_CHANNEL,
} from "./app-bridge";
import { defaultAgentSchema } from "./default-agent";
import { pageSkillSchema } from "./page-skills";
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_DEFINITION, ATTRIBUTE, DELETE_AGENT, DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW,
  OBJECT_TYPE, RELATIONSHIP, SET_METRIC_VIEW_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW, USER,
  bindingKey, chartProjectionLookupRead, chartProjectionSourcePath, chartProjectionSourceSends, clientSends, panelClientReads,
} from "./panel-client-requests";
import {
  candidatePanelSourceSchema, panelCapacityPlanSchema, panelCapacityRequestSchema, panelFrameMessageSchema,
  panelHostFrameMessageSchema, panelHostMessageSchema, panelUsePath,
} from "./panel-host";
import {
  matchesObjectType, objectUnionTypes, ontologyObjectUnionTypeSchema, ontologyParameterTypeSchema, panelChildObjectIdentitySchema,
  panelManifestSchema, panelOpenRequestSchema, panelStateFieldSchema, panelStateOperationSchema,
  panelStateValueSchema, singleOntologyParameterTypeSchema,
} from "./panel-manifest";
import { pageDraftSchema } from "./page-draft";
import {
  panelFormDescriptionSchema, panelFormFrequencyValueSchema, panelFormRequestSchema, panelFormSaveInputSchema, panelFormTimeValueSchema,
  panelObjectListColumnSchema, panelStateOperation, projectionBindingKeys, projectionOperations, projectionPorts,
} from "./panel-projection";
import { platformTaskFrequencySchema } from "./platform-schedules";
import {
  platformOntologyCountsResponseSchema, platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyObjectsResponseSchema, platformOntologyReadQuerySchema,
  platformOntologySchemaResponseSchema, platformOntologyStartResponseSchema,
} from "./platform-ontology";
import {
  DEFINITION, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, USER as ONTOLOGY_USER,
  platformObjectTypes, platformOntologyLayers, platformRelationKinds,
} from "./platform-object-types";
import {
  applicationPanelUseSchema, applicationPanelUsePathSchema, chartProjectionLookupResponseSchema, chartProjectionTemplateSchema,
  chartSourceInUseErrorSchema, ontologyElementRefSchema, productPanelContentSchema, productProjectionInputSchema,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema, registerProductProjectionRequestSchema,
  updateChartProjectionSourceRequestSchema,
} from "./product-panels";
import { ontologyParameterTypeSchema as legacyOntologyParameterTypeSchema } from "./product-projections";

const binding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });

test("a no-code task panel registers and parses the same members and layout", async () => {
  const { registerDirectPanelRequestSchema } = await import("./product-panels");
  const { parsePanelLayout } = await import("./panel-layout");
  const input = {
    name: "Scheduled tasks", description: "", visibility: "domain", revision: 0,
    content: { html: '<div flow="row">\n  <panel-member ref="tasks"></panel-member>\n</div>' },
    manifest: {
      state: { selectedTask: { type: { kind: "object", objectType: "platform:ScheduledTask" }, deepLink: true, external: true, default: null } },
      members: { tasks: { target: { projectionId: "projection-schedules-tasks" }, outputs: { selected: { state: "selectedTask" } } } },
      events: {},
    },
  };
  const panel = registerDirectPanelRequestSchema.parse(input);
  assert.deepEqual(parsePanelLayout(panel.content.html, panel.manifest), [{
    kind: "container", tag: "div", flow: "row", gap: "medium", position: { offset: 0, line: 1, column: 1 },
    children: [{ kind: "member", ref: "tasks", position: { offset: 19, line: 2, column: 3 } }],
  }]);
  const wrong = '<div>\n  <panel-member ref="tasks" onclick="run()"></panel-member>\n</div>';
  assert.throws(() => parsePanelLayout(wrong, panel.manifest), /2:29.*onclick/u);
  assert.equal(registerDirectPanelRequestSchema.safeParse({ ...input, content: { html: wrong } }).success, false);
  assert.throws(() => parsePanelLayout('<section when="selectedTask" eq="1"></section>', panel.manifest), /Comparison/u);
  assert.throws(() => parsePanelLayout('<div><panel-member ref="tasks"></div>', panel.manifest), /Unexpected closing tag/u);
  assert.throws(() => parsePanelLayout('<div flow="row" flow="column"></div>', panel.manifest), /Duplicate attribute 'flow'/u);
  assert.throws(() => parsePanelLayout('<panel-member ref="missing"></panel-member>', panel.manifest), /Undeclared member 'missing'/u);
});

test("direct task reads use the registered source, parameters and result envelope", async () => {
  const { registerDirectProjectionRequestSchema } = await import("./product-panels");
  const { panelDataStateSchema, productPanelReadRequestSchema, productPanelReadResponseSchema } = await import("./panel-host");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const form = {
    name: "Task form", description: "", visibility: "domain", revision: 0, componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  };
  assert.deepEqual(registerDirectProjectionRequestSchema.parse(form), form);
  const read = form.data.form;
  for (const rejected of [{ ...read, read: "delete" }, { ...read, params: { values: { state: "selected" } } },
    { ...read, params: { changedField: { literal: "missing-slash" } } }, { ...read, source: { object: { input: "missing" } } }])
    assert.equal(registerDirectProjectionRequestSchema.safeParse({ ...form, data: { form: rejected } }).success, false);

  const request = {
    source: { kind: "registered", applicationId: "app-trial", useId: "tasks" }, memberPath: [{ member: "form" }],
    dataName: "form", inputs: { task: { className: "platform:ScheduledTask", primaryKey: "task-1" } },
  };
  assert.deepEqual(productPanelReadRequestSchema.parse(request), request);
  assert.equal(productPanelReadRequestSchema.safeParse({ source: request.source, items: [request] }).success, false);
  assert.equal(productPanelReadRequestSchema.safeParse({ ...request, memberPath: [{ member: "form", selection: "untrusted" }] }).success, false);
  assert.equal(productPanelReadResponseSchema.safeParse({ status: "forbidden", value: [] }).success, false);
  assert.equal(productPanelReadResponseSchema.safeParse({ status: "loading" }).success, false);
  assert.deepEqual(panelDataStateSchema.parse({ status: "loading" }), { status: "loading" });
  const row = { primaryKey: "task-1", label: "Morning report", fields: { state: "on" } };
  assert.deepEqual(panelReadResultSchemas.panelRecordList.parse([row]), [row]);
  assert.deepEqual(productPanelReadResponseSchema.parse({ status: "ready", value: row }), { status: "ready", value: row });
});

test("the field port refers to another slot in the same manifest", () => {
  const picker = { projectionId: "skill-picker", formField: { slot: "definition", path: "/skills" } };
  const slots = { definition: { projectionId: "definition-form" }, picker };
  assert.deepEqual(panelManifestSchema.parse({ state: {}, slots, operations: [] }).slots.picker?.formField, picker.formField);
  assert.equal(panelManifestSchema.safeParse({ state: {}, slots: { picker }, operations: [] }).success, false);
});

test("a row reference port identifies the array and a field relative to each row", () => {
  const formField = { slot: "workflow", path: "/steps", itemPath: "/actionId" };
  const slots = { workflow: { projectionId: "workflow-form" }, picker: { projectionId: "action-picker", formField } };
  assert.deepEqual(panelManifestSchema.parse({ state: {}, slots, operations: [] }).slots.picker?.formField, formField);
  const invalid = { ...slots, picker: { ...slots.picker, formField: { ...formField, itemPath: "actionId" } } };
  assert.equal(panelManifestSchema.safeParse({ state: {}, slots: invalid, operations: [] }).success, false);
});

test("time controls and schedule frequencies accept local times at minute precision", () => {
  for (const time of ["00:00", "09:05", "23:59"]) {
    assert.equal(panelFormTimeValueSchema.parse(time), time);
    assert.ok(platformTaskFrequencySchema.safeParse({ kind: "daily", time }).success);
  }
  for (const time of ["24:00", "09:60", "9:05", "09:05:00", "09:05Z", "09:05+08:00"]) {
    assert.equal(panelFormTimeValueSchema.safeParse(time).success, false);
    assert.equal(platformTaskFrequencySchema.safeParse({ kind: "daily", time }).success, false);
  }
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

test("read operation inputs can take parameter values and a binding from this panel instance", () => {
  const bindingId = { state: "bindingId" };
  const parameters = { formField: { slot: "execution", path: "/parameters" } };
  const manifest = {
    state: { bindingId: { kind: "scalar", type: "string" } },
    slots: {
      execution: { projectionId: "runtime-form" },
      trial: { projectionId: "trial", readOperationInputs: { testExecute: { parameters, bindingId } } },
    },
    operations: [],
  };
  assert.deepEqual(panelManifestSchema.parse(manifest).slots.trial?.readOperationInputs?.testExecute, { parameters, bindingId });
  assert.equal(panelManifestSchema.safeParse({ ...manifest, state: {} }).success, false);
  const named = { parameters: { fields: { amount: { formField: { slot: "execution", path: "/amount" } }, binding: bindingId } } };
  const trial = { ...manifest.slots.trial, readOperationInputs: { testExecute: named } };
  assert.deepEqual(panelManifestSchema.parse({ ...manifest, slots: { ...manifest.slots, trial } }).slots.trial?.readOperationInputs?.testExecute, named);
  assert.equal(panelManifestSchema.safeParse({ ...manifest, slots: { trial } }).success, false);
});

test("declared delete operations can read a named impact with the total count", () => {
  const operation = bindingKey({ kind: "PlatformOperation", id: DELETE_AGENT });
  const path = "/panel-operations/inspect-impact";
  assert.equal(clientSends([operation], "POST", "", path), true);
  assert.equal(clientSends([binding(AGENT_DEFINITION)], "POST", "", path), false);
  assert.equal(clientSends([operation], "GET", "", path), false);
  const objects = [{ target: { objectType: AGENT_DEFINITION, primaryKey: "a" }, label: "Assistant A" }];
  assert.deepEqual(panelOperationImpactSchema.parse({ summary: "Agent removal", objects, total: 4 }).total, 4);
  assert.equal(panelOperationImpactSchema.safeParse({ summary: "Agent removal", objects }).success, false);
});

test("an operation asks the host for a user decision using the owner impact", () => {
  const objects = [{ target: { objectType: AGENT_DEFINITION, primaryKey: "a" }, label: "Assistant A" }];
  const confirmation = { kind: "impact", impact: { summary: "Agent removal", objects, total: 1 } };
  const payload = { intentId: operationIntentId, operationId: "remove.delete", label: "Delete", confirmation };
  const request = { channel: APP_BRIDGE_CHANNEL, id: "confirmation", operation: "confirm-panel-operation", payload };
  assert.deepEqual(appBridgeRequestSchema.parse(request), request);
  assert.deepEqual(appBridgeConfirmPanelOperationSchema.parse(payload), payload);
  assert.equal(appBridgeConfirmPanelOperationSchema.safeParse({ ...payload, call: {} }).success, false);
  assert.deepEqual(appBridgeConfirmPanelOperationResultSchema.parse({ decision: "cancel" }), { decision: "cancel" });
  const response = { kind: "dispatched", intentId: operationIntentId, outcome: { kind: "success", data: { notes: "Activation completed" } } };
  assert.deepEqual(appBridgeConfirmPanelOperationResultSchema.parse({ decision: "confirm", response }), { decision: "confirm", response });
  assert.equal(appBridgeConfirmPanelOperationResultSchema.safeParse({ decision: "confirm" }).success, false);
  assert.equal(appBridgeConfirmPanelOperationResultSchema.safeParse({ decision: "dispatch" }).success, false);
});

test("prepared single writes can proceed while batch confirmation still names its targets", () => {
  const base = { intentId: operationIntentId, operationId: "list.setStatus", label: "Set status" };
  const none = { ...base, confirmation: { kind: "none" } };
  assert.deepEqual(panelHumanOperationPreparationSchema.parse(none), none);
  const objects = [{ target: operationTarget, label: "Example" }];
  const batch = { ...base, confirmation: { kind: "batch", targets: { objects, total: 2 } } };
  assert.deepEqual(panelHumanOperationPreparationSchema.parse(batch), batch);
  assert.equal(panelHumanOperationPreparationSchema.safeParse({ ...base, confirmation: { kind: "batch" } }).success, false);
});

test("metric trials use the Node read operation route", () => {
  const read = "/panel-operations/read";
  for (const [operation, javaPath] of [[TEST_METRIC_VIEW, "/metricView/test"], [TEST_EXECUTE_METRIC_VIEW, "/metricView/testExecute"]]) {
    const binding = [bindingKey({ kind: "PlatformOperation", id: operation })];
    assert.equal(clientSends(binding, "POST", "", read), true);
    assert.equal(clientSends(binding, "GET", "", read), false);
    assert.equal(clientSends(binding, "POST", "/data-query", javaPath), false);
  }
  assert.equal(clientSends([binding(METRIC_VIEW)], "POST", "", read), false);
  const result = { kind: "markdown", markdown: "Trial output" };
  assert.deepEqual(readPanelOperationResponseSchema.parse(result), result);
});

test("a frame boots with the exact use identity or an explicit candidate null", () => {
  const panel = { content: { html: "", module: "" }, sdkVersion: "1.0.0", manifest: { state: {}, slots: {}, operations: [] } };
  const message = { kind: "panel-host-message", panel, pageKey: "tasks", url: "/tasks", label: "Tasks", state: {} };
  const use = { applicationId: "workbench", useId: "tasks" };
  assert.deepEqual(panelHostMessageSchema.parse({ ...message, use }).use, use);
  assert.equal(panelHostMessageSchema.parse({ ...message, use: null }).use, null);
  assert.equal(panelHostMessageSchema.safeParse(message).success, false);
  assert.equal(panelHostMessageSchema.safeParse({ ...message, use: { applicationId: use.applicationId } }).success, false);
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

test("panel state operations declare a message key for their label", () => {
  const operation = { id: "create", kind: "state", labelKey: "metric.create", sets: {} };
  const parsed = panelStateOperationSchema.parse(operation);
  assert.deepEqual(parsed, operation);
  const content = productPanelContentSchema.parse({ html: "", module: "", messages: { "zh-CN": { "metric.create": "新建指标" } } });
  assert.equal(panelStateOperation(parsed, key => content.messages!["zh-CN"][key]).label, "新建指标");
  assert.equal(panelStateOperationSchema.safeParse({ id: operation.id, kind: operation.kind, label: "New metric view" }).success, false);
});

test("list column headers come from owner fields or from panel message keys", () => {
  const ownerField = { key: "status", kind: "tag" };
  const panelColumn = { key: "notes", labelKey: "list.notes", emptyKey: "list.noNotes" };
  assert.deepEqual(panelObjectListColumnSchema.parse(ownerField), ownerField);
  assert.deepEqual(panelObjectListColumnSchema.parse(panelColumn), panelColumn);
  assert.equal(panelObjectListColumnSchema.safeParse({ ...ownerField, label: "Status" }).success, false);
  assert.equal(panelObjectListColumnSchema.safeParse({ ...panelColumn, empty: "No notes" }).success, false);
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

test("a panel operation descriptor admits exactly the three use and operation query keys", () => {
  const bindings = [bindingKey({ kind: "PlatformOperation", id: "schedules.runNow" })];
  const path = "/panel-operations/descriptor";
  const valid = `${path}?useId=tasks&operationId=run%2Enow&applicationId=workbench`;
  assert.equal(clientSends(bindings, "GET", "", valid), true);
  for (const bad of [path, `${path}?useId=tasks&applicationId=workbench`, `${valid}&extra=true`, `${valid}&useId=other`, `${path}?useId=tasks&applicationId=workbench&applicationId=other`]) {
    assert.equal(clientSends(bindings, "GET", "", bad), false);
  }
  assert.equal(clientSends(bindings, "POST", "", valid), false);
  assert.equal(clientSends([], "GET", "", valid), false);
  const query = { applicationId: "workbench", useId: "tasks", operationId: "run.now" };
  assert.deepEqual(panelOperationRefSchema.parse(query), query);
  assert.equal(panelOperationRefSchema.safeParse({ ...query, effect: "read" }).success, false);
  const description = {
    handlerRef: "schedules.runNow", effect: "write", target: { source: "input", input: "task" },
    inputSchema: {}, resultSchema: {}, batch: false,
  };
  assert.deepEqual(panelOperationDescriptorResponseSchema.parse(description), description);
});


const chartSource = { dashboardId: "board-a", cardId: "chart-1" };
const chartProjection = {
  name: "Departments", description: "", visibility: "private",
  componentId: "MetricChart", binding: { kind: "MetricView", id: "department-metric" },
  inputs: { department: { kind: "scalar", type: "string" } },
  display: { chartSource },
};

test("a chart projection can only store the source reference and its metric binding", () => {
  const projection = {
    ...chartProjection, id: "projection-a", domainId: "domain", ownerId: "author",
    revision: 1, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", editable: true,
  };
  assert.deepEqual(registerChartProjectionResponseSchema.parse({ projection }).projection.display, { chartSource });
  assert.equal(productProjectionInputSchema.safeParse({
    ...chartProjection, binding: { kind: "Action", id: "unrelated" },
  }).success, false);
  assert.equal(productProjectionInputSchema.safeParse({
    ...chartProjection, inputs: { department: { kind: "array", items: { kind: "scalar", type: "string" } } },
  }).success, false);
  for (const data of [{ chartFile: {} }, { query: { metricId: "other" } }, { rows: [] }]) {
    assert.equal(productProjectionInputSchema.safeParse({
      ...chartProjection, display: { chartSource, ...data },
    }).success, false);
  }
});

test("chart registration takes the source identity and ordinary writes cannot supply it", () => {
  assert.deepEqual(registerChartProjectionRequestSchema.parse(chartSource), chartSource);
  assert.equal(registerChartProjectionRequestSchema.safeParse({
    ...chartSource, id: "supplied-projection", binding: chartProjection.binding, domainId: "another-domain",
  }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({ ...chartProjection, revision: 1 }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({
    ...chartProjection, componentId: "ObjectSummary", revision: 0,
  }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({
    ...chartProjection, display: {}, revision: 0,
  }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({
    ...chartProjection, display: {}, revision: 2,
  }).success, true);
});

test("chart template reads the drawing and saved parameters while edit only supplies the drawing", () => {
  const chartFile = {
    name: "department.chart.json",
    content: {
      dataset: [{ id: "metric", dimensions: ["name", "value"], source: [] }],
      series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "name", y: "value" } }],
      ontomato: {},
    },
  };
  const parameters = { department: "sales", years: [2025, 2026] };
  const template = { chartFile, parameters };
  assert.deepEqual(chartProjectionTemplateSchema.parse(template), template);
  assert.equal(chartProjectionTemplateSchema.safeParse({ chartFile }).success, false);
  for (const extra of [{ query: { metricId: "other" } }, { groups: [] }, { layout: {} }, { revision: 2 }])
    assert.equal(chartProjectionTemplateSchema.safeParse({ ...template, ...extra }).success, false);
  assert.ok(updateChartProjectionSourceRequestSchema.safeParse({ chartFile: { content: chartFile.content } }).success);
  assert.equal(updateChartProjectionSourceRequestSchema.safeParse({ chartFile }).success, false);
  assert.equal(updateChartProjectionSourceRequestSchema.safeParse({
    chartFile: { content: chartFile.content }, query: { metricId: "other" },
  }).success, false);
  assert.equal(updateChartProjectionSourceRequestSchema.safeParse({
    chartFile: { content: chartFile.content }, parameters,
  }).success, false);
});

test("the chart client is restricted to its chart projection and bound metric", () => {
  const path = chartProjectionSourcePath("chart:id");
  assert.ok(chartProjectionSourceSends(["chart:id"], "GET", "", path));
  assert.ok(chartProjectionSourceSends(["chart:id"], "PUT", "", path));
  assert.ok(!chartProjectionSourceSends(["other"], "GET", "", path));
  assert.ok(!chartProjectionSourceSends(["chart:id"], "DELETE", "", path));

  const metric = bindingKey(chartProjection.binding);
  for (const [path, body] of [
    ["/ontology/query/metrics/describe", { id: "department-metric" }],
    ["/metricView/execute", { id: "department-metric", param: { department: "sales" } }],
  ] as const) {
    assert.ok(panelClientReads(metric).some(read => read.method === "POST" && read.path.test(path)));
    assert.ok(clientSends([metric], "POST", "/data-query", path, body));
    assert.ok(!clientSends([metric], "POST", "/data-query", path, { ...body, id: "other" }));
    assert.ok(!clientSends([metric], "POST", "/data-query", path));
  }
  const rawDefinitionPath = "/metricView/queryById";
  assert.ok(!panelClientReads(metric).some(read => read.path.test(rawDefinitionPath)));
  assert.ok(!clientSends([metric], "POST", "/data-query", rawDefinitionPath, { id: "department-metric" }));

  const lookup = "/product-projections/chart-sources?dashboardId=board-a&cardId=chart-1";
  assert.ok(chartProjectionLookupRead.path.test(lookup));
  assert.ok(!clientSends([metric], "GET", "", lookup));
  assert.deepEqual(chartProjectionLookupResponseSchema.parse({ projectionId: null }), { projectionId: null });
});

test("a blocked chart source removal reports the referring projection IDs", () => {
  const refusal = {
    success: false, error: "Chart source is in use", code: "CHART_SOURCE_IN_USE",
    details: { projectionIds: ["projection-a"] },
  };
  assert.deepEqual(chartSourceInUseErrorSchema.parse(refusal).details.projectionIds, ["projection-a"]);
  assert.equal(chartSourceInUseErrorSchema.safeParse({ ...refusal, details: { projectionIds: [] } }).success, false);
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
    [DELETE_FUNCTION, "/function/delete"],
  ] as const) {
    const operationKey = bindingKey({ kind: "PlatformOperation", id: operation });
    assert.ok(clientSends([operationKey], "POST", "/data-query", path));
    assert.ok(!clientSends([operationKey], "GET", "/data-query", path));
    assert.ok(!clientSends([operationKey], "POST", "", path));
  }
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

test("checked object collections are typed ports and never become deep-link state", () => {
  const field = { kind: "objects", objectType: METRIC_VIEW };
  const refs = [{ className: METRIC_VIEW, primaryKey: "metric-a" }, { className: METRIC_VIEW, primaryKey: "metric-b" }];
  const state = { checked: refs };
  assert.deepEqual(panelStateFieldSchema.parse(field), { ...field, deepLink: false });
  assert.equal(panelStateFieldSchema.safeParse({ ...field, deepLink: true }).success, false);
  assert.deepEqual(ontologyParameterTypeSchema.parse(field), field);
  assert.equal(singleOntologyParameterTypeSchema.safeParse(field).success, false);
  assert.deepEqual(panelStateValueSchema.parse(refs), refs);
  assert.deepEqual(panelStateValueSchema.parse([]), []);
  assert.deepEqual(panelStateOperationSchema.parse({ id: "clear", labelKey: "selection.clear", kind: "state", sets: { checked: [] } }).sets, { checked: [] });
  assert.equal(panelOpenRequestSchema.safeParse({ useId: "metrics", state }).success, false);
  assert.equal(panelFrameMessageSchema.safeParse({ kind: "state", fromAddress: "/ontology/metrics", state }).success, false);
});

test("mixed graphs declare selected node types separately from the read bindings", () => {
  const nodeIdentity = { kind: "object-union", layers: [...platformOntologyLayers] };
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

test("object unions resolve current layer declarations or an explicit list of declared types", () => {
  const explicit = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", objectTypes: [DEFINITION, ONTOLOGY_TYPE] });
  assert.deepEqual(objectUnionTypes(explicit), [DEFINITION, ONTOLOGY_TYPE]);
  assert.equal(matchesObjectType(explicit, ONTOLOGY_TYPE), true);
  assert.equal(matchesObjectType(explicit, ONTOLOGY_USER), false);

  const layered = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", layers: ["capability"] });
  assert.equal(matchesObjectType(layered, DEFINITION), true);
  assert.equal(matchesObjectType(layered, ONTOLOGY_USER), false);
  assert.equal(matchesObjectType(layered, ONTOLOGY_TYPE), false);
  assert.equal(matchesObjectType({ kind: "object", objectType: ONTOLOGY_USER }, ONTOLOGY_USER), true);
});

test("object union contracts reject unknown types, unknown layers and ambiguous selectors", () => {
  for (const selector of [
    { objectTypes: [DEFINITION, "platform:Missing"] },
    { layers: ["unclassified"] },
    { layers: ["capability"], objectTypes: [DEFINITION] },
    {},
  ]) {
    const field = { kind: "object-union", ...selector };
    assert.equal(ontologyObjectUnionTypeSchema.safeParse(field).success, false);
    assert.equal(panelStateFieldSchema.safeParse(field).success, false);
  }
});

test("legacy single-type projection parameters reject both object union selectors", () => {
  for (const selector of [{ objectTypes: [DEFINITION] }, { layers: ["capability"] }]) {
    const type = { kind: "object-union", ...selector };
    assert.equal(singleOntologyParameterTypeSchema.safeParse(type).success, false);
    assert.equal(legacyOntologyParameterTypeSchema.safeParse(type).success, false);
  }
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

test("platform ontology start uses the same full node as neighbors, or null", () => {
  const identity = { className: ONTOLOGY_USER, primaryKey: "user-a" };
  const node = { ...identity, label: "Alice", layer: "governance" };
  assert.deepEqual(platformOntologyStartResponseSchema.parse({ node }), { node });
  assert.deepEqual(platformOntologyStartResponseSchema.parse({ node: null }), { node: null });
  assert.equal(platformOntologyStartResponseSchema.safeParse({ node: identity, label: node.label, layer: node.layer }).success, false);
  assert.deepEqual(platformOntologyNeighborsResponseSchema.parse({ node, neighbors: [], edges: [], relations: [] }).node, node);
});

test("platform ontology reads preserve declared topology, owner status and scoped object identities", () => {
  const catalog = {
    layers: platformOntologyLayers,
    objectTypes: [{ id: ONTOLOGY_USER, layer: "governance", labelKey: "platformOntology.types.user" }],
    relationKinds: platformRelationKinds,
  };
  assert.deepEqual(platformOntologyReadQuerySchema.parse({}), {});
  assert.deepEqual(platformOntologySchemaResponseSchema.parse(catalog), catalog);
  const counts = { counts: [{ type: ONTOLOGY_USER, layer: "governance", status: "unavailable", reason: "Owner pending" }] };
  assert.deepEqual(platformOntologyCountsResponseSchema.parse(counts), counts);

  const node = { className: ONTOLOGY_USER, primaryKey: "user-a" };
  assert.deepEqual(platformOntologyNeighborsRequestSchema.parse({ node, layers: ["capability"] }).node, node);
  assert.equal(platformOntologyNeighborsRequestSchema.safeParse({ node, layers: ["unknown"] }).success, false);
  const query = { type: ONTOLOGY_USER, keyword: "Alice", page: 2, pageSize: 10 };
  assert.deepEqual(platformOntologyObjectsRequestSchema.parse(query), query);
  assert.equal(platformOntologyObjectsRequestSchema.safeParse({ ...query, pageSize: 201 }).success, false);
  const objects = { type: ONTOLOGY_USER, layer: "governance", status: "ok", items: [{ node, label: "Alice" }], total: 11, page: 2, pageSize: 10 };
  assert.deepEqual(platformOntologyObjectsResponseSchema.parse(objects), objects);
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

test("an authenticated human intent retains its frozen calls without agent question facts", () => {
  const intent = {
    intentId: operationIntentId, source: { kind: "human" }, use: { applicationId: "ontology", useId: "knowledge" },
    panelId: "panel", projectionId: "projection", binding: { kind: "PlatformOperation", id: "knowledge.delete" },
    initiator: { domainId: "domain", userId: "reader" }, dispatched: false, outcome: null,
    confirmation: { kind: "impact", impact: { summary: "Knowledge removal", objects: [{ target: operationTarget, label: "Example" }], total: 1 } },
    operation: { id: "list.delete", label: "Delete", kind: "action", slot: "list", handlerRef: "knowledge.delete",
      effect: "write", target: { source: "input", input: "selection" }, inputSchema: {}, resultSchema: {}, batch: true },
    calls: [{ target: { ...operationTarget, kind: "object" }, input: {} }],
  };
  const read = readStoredPanelOperationIntent(intent);
  assert.deepEqual(read, { kind: "current", intent });
  assert.ok(read.kind === "current" && isPanelHumanOperationIntent(read.intent));
  const attempted = { ...intent, dispatched: true, outcome: { kind: "unknown", message: "No owner receipt" } };
  assert.deepEqual(readStoredPanelOperationIntent(attempted), { kind: "current", intent: attempted });
});

test("a frame can prepare a human intent and only the host can dispatch it", () => {
  const ref = { applicationId: "ontology", useId: "knowledge", operationId: "list.delete" };
  const call = { target: { ...operationTarget, kind: "object" }, input: {} };
  assert.deepEqual(createPanelHumanOperationIntentRequestSchema.parse({ ...ref, call }), { ...ref, call });
  assert.deepEqual(createPanelHumanOperationIntentRequestSchema.parse({ ...ref, calls: [call] }), { ...ref, calls: [call] });
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({ ...ref, call, calls: [call] }).success, false);
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({ ...ref, call, intentId: operationIntentId }).success, false);
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({ ...ref, call: { ...call, draft: {} } }).success, false);
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({ ...ref, call, executionUserId: "other" }).success, false);
  const prepared = { intentId: operationIntentId, operationId: ref.operationId, label: "Delete", confirmation: { kind: "none" } };
  assert.deepEqual(panelHumanOperationPreparationSchema.parse(prepared), prepared);

  const bindings = [bindingKey({ kind: "PlatformOperation", id: "knowledge.delete" })];
  const create = "/panel-operations/intents";
  assert.equal(clientSends(bindings, "POST", "", create), true);
  assert.equal(clientSends(bindings, "GET", "", `/panel-operation-intents/${operationIntentId}`), false);
  assert.equal(clientSends(bindings, "POST", "", `${create}/${operationIntentId}/dispatch`), false);
  assert.deepEqual(dispatchPanelHumanOperationIntentRequestSchema.parse({}), {});
  assert.equal(dispatchPanelHumanOperationIntentRequestSchema.safeParse({ confirmed: true }).success, false);
  const reply = { kind: "dispatched", intentId: operationIntentId, outcome: { kind: "unknown", message: "No receipt" } };
  assert.deepEqual(panelHumanOperationDispatchResponseSchema.parse(reply), reply);
});

test("application uses and page-skill defaults share the explicit agent target", () => {
  const use = { id: "governance", pageKey: "report", panelId: "reports", path: "/governance/reports", access: { kind: "domain-member" } };
  const preset = { kind: "preset", agentKind: "knowledge-governance" };
  const concrete = { kind: "id", id: "saved-agent" };
  assert.deepEqual(applicationPanelUseSchema.parse({ ...use, defaultAgent: concrete }).defaultAgent, concrete);
  assert.equal(applicationPanelUseSchema.safeParse({ ...use, defaultAgentId: "saved-agent" }).success, false);
  const mapping = {
    permissionCode: "business-knowledge",
    skill: { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" },
    defaults: [{ pageKey: use.pageKey, defaultAgent: preset }],
  };
  assert.deepEqual(pageSkillSchema.parse(mapping).defaults, mapping.defaults);
});


test("conversation entries declare the exact composer target and can prefill without a send command", () => {
  const payload = { slot: "composer", target: { kind: "page-default" }, prefill: "Please review these entries" };
  assert.ok(appBridgeRequestSchema.safeParse({
    channel: APP_BRIDGE_CHANNEL, id: "expand", operation: "expand-page-composer", payload,
  }).success);
  assert.deepEqual(appBridgeExpandPageComposerSchema.parse(payload), payload);
  assert.equal(appBridgeExpandPageComposerSchema.safeParse({ ...payload, send: true }).success, false);
  assert.equal(defaultAgentSchema.safeParse(payload.target).success, false);

  const conversationEntry = { target: { kind: "preset", agentKind: "knowledge-governance" }, prefill: payload.prefill };
  const projection = productProjectionInputSchema.parse({
    name: "Governance", description: "", visibility: "domain", componentId: "ConversationEntry",
    binding: { kind: "PlatformObjectType", id: "platform:AgentDefinition" }, inputs: {}, display: {}, conversationEntry,
  });
  assert.deepEqual(projection.conversationEntry, conversationEntry);
});

test("capacity admission separates a confirmed departure from activity in the frame", () => {
  const current = { instance: "knowledge", address: "/ontology/knowledge?state=old" };
  const next = { instance: "knowledge", address: "/ontology/knowledge?state=new" };
  const request = { current, next, departure: "retain-clean" };
  assert.deepEqual(panelCapacityRequestSchema.parse(request), request);
  assert.equal(panelCapacityRequestSchema.safeParse({ ...request, departure: "dirty" }).success, false);

  const plan = { kind: "admitted", next: "reuse", reclaim: [] };
  assert.deepEqual(panelCapacityPlanSchema.parse(plan), plan);
  assert.equal(panelCapacityPlanSchema.safeParse({ kind: "refused", reclaim: [current.instance] }).success, false);
  assert.deepEqual(panelHostFrameMessageSchema.parse({ kind: "activity", active: false }), { kind: "activity", active: false });
  assert.equal(panelFrameMessageSchema.safeParse({ kind: "activity", active: true }).success, false);
});
