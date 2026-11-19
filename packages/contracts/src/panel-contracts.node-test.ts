import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DEFINITION, ATTRIBUTE, MCP_SERVICE_OPTION, OBJECT_TYPE, RELATIONSHIP, USER, bindingKey, chartProjectionLookupRead, chartProjectionSourcePath, chartProjectionSourceSends, clientSends, panelClientReads } from "./panel-client-requests";
import { candidatePanelSourceSchema, panelFrameMessageSchema, panelUsePath } from "./panel-host";
import { panelManifestSchema } from "./panel-manifest";
import { panelFormSaveInputSchema, projectionBindingKeys, projectionOperations, projectionPorts } from "./panel-projection";
import {
  applicationPanelUsePathSchema, chartProjectionLookupResponseSchema, chartProjectionTemplateSchema,
  chartSourceInUseErrorSchema, ontologyElementRefSchema, productPanelContentSchema, productProjectionInputSchema,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema, registerProductProjectionRequestSchema,
  updateChartProjectionSourceRequestSchema,
} from "./product-panels";

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

test("chart template read exposes only the chart file and edit supplies only its drawing", () => {
  const chartFile = {
    name: "department.chart.json",
    content: {
      dataset: [{ id: "metric", dimensions: ["name", "value"], source: [] }],
      series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "name", y: "value" } }],
      ontomato: {},
    },
  };
  assert.deepEqual(chartProjectionTemplateSchema.parse({ chartFile }), { chartFile });
  for (const extra of [{ query: { metricId: "other" } }, { groups: [] }, { layout: {} }, { revision: 2 }])
    assert.equal(chartProjectionTemplateSchema.safeParse({ chartFile, ...extra }).success, false);
  assert.ok(updateChartProjectionSourceRequestSchema.safeParse({ chartFile: { content: chartFile.content } }).success);
  assert.equal(updateChartProjectionSourceRequestSchema.safeParse({ chartFile }).success, false);
  assert.equal(updateChartProjectionSourceRequestSchema.safeParse({
    chartFile: { content: chartFile.content }, query: { metricId: "other" },
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
    ["/metricView/queryById", { id: "department-metric" }],
    ["/metricView/execute", { id: "department-metric", param: { department: "sales" } }],
  ] as const) {
    assert.ok(panelClientReads(metric).some(read => read.method === "POST" && read.path.test(path)));
    assert.ok(clientSends([metric], "POST", "/data-query", path, body));
    assert.ok(!clientSends([metric], "POST", "/data-query", path, { ...body, id: "other" }));
    assert.ok(!clientSends([metric], "POST", "/data-query", path));
  }
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
