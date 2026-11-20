import { formOptionSchema } from "./form-fields";
import { appsSdkBuildSchema, appsSdkCurrentSchema } from "./apps-sdk";
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
import { dashboardCardPrimaryKey } from "./dashboard";
import { DASHBOARD_CARD } from "./platform-object-types";
import {
  ACTION, AGENT_DEFINITION, ATTRIBUTE, DELETE_ACTION, DELETE_AGENT, DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP, SET_ACTION_STATUS, SET_METRIC_VIEW_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW, USER,
  RUN_NOW, SCHEDULED_TASK, bindingKey, chartProjectionLookupRead, chartProjectionSourcePath, chartProjectionSourceSends, clientSends, panelClientReads,
} from "./panel-client-requests";
import {
  candidatePanelSourceSchema, panelFrameMessageSchema,
  panelHostFrameMessageSchema, panelHostMessageSchema, panelUsePath,
} from "./panel-host";
import {
  matchesObjectType, objectUnionTypes, ontologyObjectUnionTypeSchema, ontologyParameterTypeSchema,
  panelChildCollectionQuerySchema, panelChildObjectIdentitySchema, panelManifestSchema, panelOpenRequestSchema, panelStateFieldSchema,
  panelOperationSchema, panelStateOperationSchema, panelStateValueSchema, singleOntologyParameterTypeSchema,
} from "./panel-manifest";
import { pageSelectionSchema } from "./page-context";
import { pageDraftSchema } from "./page-draft";
import {
  panelFormDescriptionSchema, panelFormFrequencyValueSchema, panelFormRequestSchema, panelFormSaveInputSchema, panelFormTimeValueSchema,
  panelObjectListColumnSchema, panelStateOperation, projectionBindingKeys, projectionOperation, projectionOperationTargetMatches, projectionPorts,
} from "./panel-projection";
import { platformTaskFrequencySchema } from "./platform-schedules";
import {
  platformOntologyCountsResponseSchema, platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyObjectsResponseSchema, platformOntologyReadQuerySchema,
  platformOntologySchemaResponseSchema, platformOntologyStartResponseSchema,
} from "./platform-ontology";
import {
  APPLICATION_PANEL_USE, DEFINITION, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, PRODUCT_PROJECTION, USER as ONTOLOGY_USER,
  platformObjectTypes, platformOntologyLayers, platformRelationKinds,
} from "./platform-object-types";
import {
  applicationPanelUseSchema, applicationPanelUsePathSchema, chartProjectionLookupResponseSchema, chartProjectionTemplateSchema,
  chartSourceInUseErrorSchema, ontologyElementRefSchema, productPanelContentSchema, productPanelReadQuerySchema, productPanelResponseSchema,
  productProjectionInputSchema, productProjectionResponseSchema,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema, registerProductProjectionRequestSchema,
  updateChartProjectionSourceRequestSchema,
} from "./product-panels";
import { ontologyParameterTypeSchema as legacyOntologyParameterTypeSchema } from "./product-projections";
import { panelDefinitionSnapshotSchema } from "./product-subscriptions";

const platformType = (id: string) => ({ kind: "PlatformObjectType" as const, id });
const platformOperation = (id: string) => ({ kind: "PlatformOperation" as const, id });
const binding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });

test("current SDK discovery carries the digest of the build and the component catalogue path", () => {
  const build = { version: "1.1.2", digest: "2f".repeat(32) };
  const root = "/tenant/apps-sdk/current";
  const current = {
    ...build, publicBasePath: "/tenant", sdkBasePath: root, manifestPath: `${root}/sdk.json`,
    docsPath: `${root}/docs/index.md`, referencePath: `${root}/docs/reference.md`, componentsPath: `${root}/components.json`,
    checkPath: `${root}/node/panel-check.mjs`,
  };
  assert.deepEqual(appsSdkBuildSchema.parse(build), build);
  assert.deepEqual(appsSdkCurrentSchema.parse(current), current);
  for (const badDigest of [build.digest.toUpperCase(), build.digest.slice(1), "x".repeat(64)]) {
    assert.equal(appsSdkBuildSchema.safeParse({ ...build, digest: badDigest }).success, false);
    assert.equal(appsSdkCurrentSchema.safeParse({ ...current, digest: badDigest }).success, false);
  }
  assert.equal(appsSdkCurrentSchema.safeParse({ ...current, componentsPath: undefined }).success, false);
  assert.equal(appsSdkCurrentSchema.safeParse({ ...current, checkPath: undefined }).success, false);
});

test("current SDK describes the browser files and Node check from the same release", async () => {
  const { appsSdkReleaseManifestSchema } = await import("./apps-sdk");
  const manifest = {
    version: "1.1.2", product: "workbench", executionContext: 1, hostTransport: 1, messageBridge: 2,
    entries: { "@ontomato/sdk/panel": "panel.js" }, stylesheet: "sdk.css", components: "components.json",
    check: "node/panel-check.mjs", libraries: { vue: "3.5.0" }, docs: "docs/index.md",
  };
  assert.deepEqual(appsSdkReleaseManifestSchema.parse(manifest), manifest);
  assert.equal(appsSdkReleaseManifestSchema.safeParse({ ...manifest, check: "/node/panel-check.mjs" }).success, false);
});

test("the SDK catalogue separates supply, configuration and run inputs", async () => {
  const { appsSdkComponentCatalogSchema } = await import("./apps-sdk");
  const component = {
    componentId: "ObjectSummary", module: "@ontomato/sdk/base", exportName: "ObjectSummary",
    role: "presentation", meaning: "Show the selected object as its owner describes it.",
    data: { record: { results: ["panelRecord"], required: true, runtimeParams: ["search"] } },
    config: [{ name: "fields", type: "string[]", description: "Visible fields", required: false }],
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    outputs: [],
    ports: { props: [], events: [], slots: [] },
  };
  const catalogue = { version: "1.1.2", components: [component] };
  assert.deepEqual(appsSdkComponentCatalogSchema.parse(catalogue), catalogue);
  for (const datum of [{ results: [], required: true }, { results: ["notRegistered"], required: true }, { results: ["panelRecord"] }]) {
    assert.equal(appsSdkComponentCatalogSchema.safeParse({
      ...catalogue, components: [{ ...component, data: { record: datum } }],
    }).success, false);
  }
  const { data: _data, ...displayOnly } = component;
  assert.equal(appsSdkComponentCatalogSchema.safeParse({ ...catalogue, components: [displayOnly] }).success, true);
});

test("the SDK catalogue permits a wildcard for author-named data", async () => {
  const { appsSdkComponentCatalogSchema, appsSdkComponentDatum } = await import("./panel-check");
  const datum = {
    results: ["panelRecordList", "panelGroupCounts"], required: false, runtimeParams: ["search"],
  } satisfies import("./apps-sdk").AppsSdkComponentData[string];
  const component = {
    componentId: "Data", module: "@ontomato/sdk/base", exportName: "Data", role: "presentation",
    meaning: "Supply declared data to the panel's own code.", data: { "*": datum },
    ports: { props: [], events: [], slots: [] },
  };
  const catalogue = { version: "1.1.2", components: [component] };
  const parsed = appsSdkComponentCatalogSchema.parse(catalogue);
  assert.deepEqual(parsed, catalogue);
  assert.deepEqual(appsSdkComponentDatum(parsed.components[0]!.data, "rows"), datum);
  assert.deepEqual(appsSdkComponentDatum(parsed.components[0]!.data, "totals"), datum);
  assert.deepEqual(appsSdkComponentDatum({ record: datum }, "record"), datum);
  assert.equal(appsSdkComponentDatum({ record: datum }, "totals"), undefined);
  for (const data of [{ ...component.data, rows: datum }, { "*": { ...datum, required: true } }]) {
    assert.equal(appsSdkComponentCatalogSchema.safeParse({
      ...catalogue, components: [{ ...component, data }],
    }).success, false);
  }
});

test("projection registration accepts package-qualified components and leaves data keys to the catalogue", () => {
  const input = {
    name: "Task list", description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {},
    data: { items: { source: { type: platformType(SCHEDULED_TASK) }, read: "list", params: {} } },
  };
  for (const componentId of ["@school/panels:InventoryList", "local-kit:list-view"]) {
    assert.deepEqual(registerProductProjectionRequestSchema.parse({ ...input, componentId }), { ...input, componentId });
  }
  for (const componentId of ["InventoryList", "@school:InventoryList", "local-kit:", "local-kit:list:view", "local-kit:two words"]) {
    assert.equal(registerProductProjectionRequestSchema.safeParse({ ...input, componentId }).success, false);
  }
});

test("ontology object lists and reference pickers declare the named reads they use", async () => {
  const { registerDirectProjectionRequestSchema } = await import("./product-panels");
  const { authoredReadParameterSource, directReadDeclaration, missingRequiredReadParameters } = await import("./panel-projection");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const { platformOntologyObjectsResponseSchema } = await import("./platform-ontology");
  const base = { name: "Choices", description: "", visibility: "domain", revision: 0, outputs: {}, config: {} };
  const users = {
    ...base, componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { keyword: { kind: "scalar", type: "string" }, page: { kind: "json" }, values: { kind: "json" } },
    data: {
      options: { source: { type: platformType(USER) }, read: "options", params: { keyword: { input: "keyword" }, page: { input: "page" } } },
      selected: { source: { type: platformType(USER) }, read: "resolve", params: { values: { input: "values" } } },
    },
  };
  assert.deepEqual(registerDirectProjectionRequestSchema.parse(users), users);
  assert.equal(registerDirectProjectionRequestSchema.safeParse({
    ...users, data: { options: { ...users.data.options, source: { type: platformType(SKILL) } } },
  }).success, false);
  const objects = {
    ...base, componentId: "@ontomato/sdk:ObjectList", inputs: {},
    data: { objects: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "objects", params: { type: { literal: USER } } } },
  };
  assert.deepEqual(registerDirectProjectionRequestSchema.parse(objects), objects);
  const runtimeObjects = registerDirectProjectionRequestSchema.parse({
    ...objects, data: { objects: { ...objects.data.objects, params: {} } },
  });
  assert.ok("data" in runtimeObjects);
  const declaration = directReadDeclaration(runtimeObjects, runtimeObjects.data.objects);
  assert.ok(declaration);
  assert.deepEqual(missingRequiredReadParameters(declaration, runtimeObjects.data.objects.params), ["type"]);
  assert.deepEqual(missingRequiredReadParameters(declaration, runtimeObjects.data.objects.params, ["keyword"]), ["type"]);
  assert.deepEqual(missingRequiredReadParameters(declaration, runtimeObjects.data.objects.params, ["type"]), []);
  assert.deepEqual(missingRequiredReadParameters(declaration, objects.data.objects.params), []);
  const placement = { outputs: { type: { state: "selectedType" } } };
  assert.deepEqual(missingRequiredReadParameters(declaration, runtimeObjects.data.objects.params, [], placement), []);
  assert.deepEqual(authoredReadParameterSource({}, "type", placement), { state: "selectedType" });
  assert.deepEqual(authoredReadParameterSource(objects.data.objects.params, "type", placement), { literal: USER });
  assert.equal(panelReadResultSchemas.panelOntologyObjects, platformOntologyObjectsResponseSchema);
  const option = { primaryKey: "m1", value: { providerId: "models", id: "m1" }, label: "Model 1", unavailable: { reason: "Unavailable" } };
  assert.deepEqual(panelReadResultSchemas.panelOptionList.parse({ options: [option] }), { options: [option] });
});

test("fixed owner signatures and per-definition read parameters are distinct", async () => {
  const { directReadDeclaration, panelReadParameterId, projectionReadReferences } = await import("./panel-projection");
  const base = {
    name: "Read", description: "", visibility: "private", outputs: {}, config: {},
    inputs: { selected: { kind: "object", objectType: "Customer" } },
  };
  const projected = productProjectionInputSchema.parse({
    ...base, componentId: "@ontomato/sdk:ObjectList",
    data: { result: {
      source: { object: { literal: { className: "platform:MetricView", primaryKey: "projected-metric" } } },
      read: "result", params: { customer: { input: "selected" } },
    } },
  });
  assert.deepEqual(projectionReadReferences(projected), [platformType("platform:MetricView")]);
  const owner = directReadDeclaration(projected, projected.data.result)!;
  assert.equal(owner.parameterMode, "owner");
  assert.equal(panelReadParameterId(owner, "customer"), "ontologyParameter");
  const group = productProjectionInputSchema.parse({
    ...base, componentId: "@ontomato/sdk:ObjectList",
    data: { counts: {
      source: { type: platformType(BUSINESS_KNOWLEDGE) }, read: "counts", params: { by: { literal: "status" } },
    } },
  });
  const fixed = directReadDeclaration(group, group.data.counts)!;
  assert.equal(fixed.parameterMode, "fixed");
  assert.equal(panelReadParameterId(fixed, "status"), undefined);
  assert.equal(productProjectionInputSchema.safeParse({
    ...group, data: { counts: { ...group.data.counts, params: { by: { literal: "author" } } } },
  }).success, false);
  assert.equal(productProjectionInputSchema.safeParse({
    ...projected, data: { operation: { ...projected.data.operation, params: { target: { input: "unknown" } } } },
  }).success, false);
});

test("owner query rows carry only actual highlight ranges on their display text", async () => {
  const { panelRecordQuerySchema, panelRecordSchema } = await import("./panel-projection");
  const row = {
    primaryKey: "knowledge-1", label: "差旅报销", fields: { status: "已通过" },
    highlights: { label: [{ start: 2, end: 4 }] },
  };
  assert.deepEqual(panelRecordQuerySchema.parse({ rows: [row], total: 1 }), { rows: [row], total: 1 });
  assert.equal(panelRecordSchema.safeParse({ ...row, highlights: {} }).success, false);
  assert.equal(panelRecordSchema.safeParse({ ...row, highlights: { label: [{ start: 4, end: 2 }] } }).success, false);
});

test("knowledge detail can share list search and customer instances have no form read", () => {
  const base = {
    name: "Detail", description: "", visibility: "domain", inputs: {}, outputs: {}, config: {},
    componentId: "@ontomato/sdk:ObjectSummary",
  };
  const record = {
    source: { object: { literal: { className: BUSINESS_KNOWLEDGE, primaryKey: "knowledge-1" } } },
    read: "record", params: { search: { literal: "policy" } },
  };
  assert.equal(productProjectionInputSchema.safeParse({ ...base, data: { record } }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, data: { record: { ...record, params: { search: { literal: 1 } } } },
  }).success, false);
  const customer = { source: { object: { literal: { className: "Customer", primaryKey: "customer-1" } } }, params: {} };
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, data: { record: { ...customer, read: "record" } },
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, componentId: "@ontomato/sdk:ObjectForm", data: { form: { ...customer, read: "form" } },
  }).success, false);
});

test("knowledge lists accept scalar status and counts preserve the owner's order and labels", async () => {
  const { panelGroupCountsSchema, panelReadInputMatches } = await import("./panel-projection");
  const projection = {
    name: "Knowledge", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
  };
  const query = { source: { type: platformType(BUSINESS_KNOWLEDGE) }, read: "query", params: { status: { literal: "pending" } } };
  assert.equal(productProjectionInputSchema.safeParse({ ...projection, data: { rows: query } }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { rows: { ...query, params: { filter: { literal: { status: "pending" } } } } },
  }).success, false);
  assert.equal(panelReadInputMatches("knowledgeStatus", { kind: "scalar", type: "string" }), true);

  const counts = [
    { key: "all", label: "全部", count: 3 },
    { key: "pending", label: "待审核", count: 1 },
    { key: "approved", label: "已通过", count: 2 },
  ];
  assert.deepEqual(panelGroupCountsSchema.parse(counts), counts);
  assert.equal(panelGroupCountsSchema.safeParse({ all: 3, pending: 1, approved: 2 }).success, false);
});

test("ontology object lists use search while reference options keep keyword", () => {
  const projection = {
    name: "Find an ontology object", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
  };
  const objects = { source: { type: platformType(ONTOLOGY_TYPE) }, read: "objects" };
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { objects: { ...objects, params: { type: { literal: USER }, search: { literal: "Lee" } } } },
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { objects: { ...objects, params: { type: { literal: USER }, keyword: { literal: "Lee" } } } },
  }).success, false);
  const options = { source: { type: platformType(USER) }, read: "options" };
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, componentId: "@ontomato/sdk:ReferencePicker", data: { options: { ...options, params: { keyword: { literal: "Lee" } } } },
  }).success, true);
});

test("feedback, governance records and the skill library read through their owners' fixed signatures", async () => {
  const { directReadDeclaration } = await import("./panel-projection");
  const base = {
    name: "Owner reads", description: "", visibility: "domain", inputs: {}, outputs: {}, config: {},
    componentId: "@ontomato/sdk:ObjectList",
  };
  const object = (className: string) => ({ object: { literal: { className, primaryKey: "item" } } });
  const result = (data: Record<string, unknown>) => {
    const projection = productProjectionInputSchema.parse({ ...base, data });
    return Object.fromEntries(Object.entries(projection.data).map(([port, read]) => [port, directReadDeclaration(projection, read)?.result]));
  };
  assert.deepEqual(result({
    rows: {
      source: { type: platformType(FEEDBACK_RECORD) }, read: "query",
      params: { search: { literal: "slow" }, sourceType: { literal: "qa" }, rating: { literal: "dislike" }, size: { literal: 20 } },
    },
    counts: { source: { type: platformType(FEEDBACK_RECORD) }, read: "counts", params: { by: { literal: "rating" }, sourceType: { literal: "all" } } },
    record: { source: object(FEEDBACK_RECORD), read: "record", params: {} },
  }), { rows: "panelRecordQuery", counts: "panelGroupCounts", record: "panelRecord" });
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, data: { rows: { source: { type: platformType(FEEDBACK_RECORD) }, read: "query", params: { rating: { literal: "neutral" } } } },
  }).success, false);

  assert.deepEqual(result({
    record: { source: object(KNOWLEDGE_GOVERNANCE_RECORD), read: "record", params: {} },
    issues: { source: object(KNOWLEDGE_GOVERNANCE_RECORD), read: "issues", params: {} },
    sources: { source: object(KNOWLEDGE_GOVERNANCE_RECORD), read: "sources", params: {} },
    passages: {
      source: object(KNOWLEDGE_GOVERNANCE_RECORD), read: "sourcePage", params: { source: { literal: "source-1" }, cursor: { literal: "c" } },
    },
  }), { record: "panelRecord", issues: "panelRecordList", sources: "panelRecordList", passages: "panelRecordQuery" });

  assert.deepEqual(result({
    rows: { source: { type: platformType(SKILL) }, read: "query", params: { search: { literal: "report" } } },
    record: { source: object(SKILL), read: "record", params: {} },
    files: { source: object(SKILL), read: "files", params: {} },
    file: { source: object(SKILL), read: "file", params: { path: { literal: "SKILL.md" } } },
    options: { source: { type: platformType(SKILL) }, read: "options", params: {} },
  }), { rows: "panelRecordQuery", record: "panelRecord", files: "panelRecordList", file: "panelRecord", options: "panelOptionList" });
  const required = (type: string, read: string) => {
    const declaration = platformObjectTypes[type].reads?.[read];
    return declaration?.parameterMode === "fixed" ? declaration.requiredParams : undefined;
  };
  assert.deepEqual(required(FEEDBACK_RECORD, "counts"), ["by"]);
  assert.deepEqual(required(KNOWLEDGE_GOVERNANCE_RECORD, "sourcePage"), ["source"]);
  assert.deepEqual(required(SKILL, "file"), ["path"]);
  assert.deepEqual(platformObjectTypes[SKILL].operations, [DELETE_SKILL]);
});

test("model reads and operations use their owner's fixed signatures", async () => {
  const { directReadDeclaration } = await import("./panel-projection");
  const base = {
    name: "Model", description: "", visibility: "domain", inputs: {}, outputs: {}, config: {},
    componentId: "@ontomato/sdk:ObjectList",
  };
  for (const type of [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP]) {
    const options = type === OBJECT_TYPE ? {} : { className: { literal: "Customer" } };
    const projection = productProjectionInputSchema.parse({
      ...base, data: {
        rows: { source: { type: platformType(type) }, read: "list", params: options },
        record: { source: { object: { literal: { className: type, primaryKey: "item" } } }, read: "record", params: {} },
        form: { source: { object: { literal: { className: type, primaryKey: "item" } } }, read: "form", params: {} },
        createForm: { source: { type: platformType(type) }, read: "createForm", params: {} },
      },
    });
    assert.equal(directReadDeclaration(projection, projection.data.rows)?.result, "panelRecordList");
    assert.equal(directReadDeclaration(projection, projection.data.form)?.result, "panelFormDescription");
    assert.ok(platformObjectTypes[type].operations?.includes(`${type}.save`));
  }
  for (const operation of ["objectTypes.delete", "attributes.delete", "relationships.delete", "attributes.setPrimaryKey"]) {
    const projection = productProjectionInputSchema.parse({
      ...base, componentId: "@ontomato/sdk:OperationButton",
      data: {}, operations: { perform: { operation: platformOperation(operation) } },
    });
    assert.equal(projection.operations?.perform.operation.id, operation);
  }
});

test("panel registration and current reads require a module", async () => {
  const { panelDefinitionContentSchema, registerProductPanelRequestSchema } = await import("./product-panels");
  const content = {
    html: '<style>.tasks { display: grid; }</style><div id="app"><projection slot="tasks"></projection></div>',
    module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
  };
  const manifest = {
    state: {}, members: { tasks: { target: { projectionId: "projection-schedules-tasks" } } }, events: {},
  };
  const body = { name: "Scheduled tasks", description: "", visibility: "domain", revision: 0, content, manifest };
  const current = {
    ...body, id: "schedules", domainId: "domain", ownerId: "owner", revision: 1, editable: true,
    createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z",
  };
  assert.deepEqual(registerProductPanelRequestSchema.parse(body).content, content);
  assert.deepEqual(productPanelResponseSchema.parse({ panel: current }).panel.content, content);
  assert.equal(registerProductPanelRequestSchema.safeParse({ ...body, sdkVersion: "1.1.2" }).success, false);
  const retainedHtml = { html: content.html, style: ".tasks {}" };
  for (const result of [
    panelDefinitionContentSchema.safeParse({ content: retainedHtml, manifest }),
    registerProductPanelRequestSchema.safeParse({ ...body, content: retainedHtml }),
    productPanelResponseSchema.safeParse({ panel: { ...current, content: retainedHtml } }),
  ]) {
    assert.equal(result.success, false);
    assert.deepEqual(result.error!.issues[0]!.path.slice(-2), ["content", "module"]);
  }
});

test("a panel manifest validates events, state and placements", () => {
  const agent = { kind: "object", objectType: AGENT_DEFINITION };
  const input = {
    state: {
      agents: { type: { kind: "list", items: agent }, personal: true, default: [] },
      agent: { type: agent, default: null, deepLink: true, external: true },
      mode: { type: { kind: "scalar", type: "string" } },
      preview: { type: { kind: "placement", candidates: { rule: "catalogSelection" } } },
    },
    members: {
      row: { target: { panelId: "agent-detail" }, inputs: { agent: { item: true } } },
      details: { target: { fromState: "agent", candidates: { rule: "objectDetail" } } },
    },
    events: { create: {
      labelKey: "agent.create", do: { set: { fields: { agent: { literal: null }, mode: { literal: "create" } } } },
    } },
  };
  const manifest = panelManifestSchema.parse(input);
  assert.deepEqual(manifest.events.create, input.events.create);
  assert.equal(panelManifestSchema.safeParse({
    ...input, events: { bad: { do: { set: { fields: { agent: { literal: null } } } } } },
  }).success, false);
  assert.equal(panelManifestSchema.safeParse({
    ...input, events: { bad: {
      on: { member: "row", output: "selected" }, labelKey: "agent.create",
      do: { set: { fields: { agent: { event: true } } } },
    } },
  }).success, false);
  assert.equal(panelManifestSchema.safeParse({
    ...input, state: { selected: { type: { kind: "objects", objectType: AGENT_DEFINITION } } },
  }).success, false);
  const follow = { on: { member: "row", output: "activated" }, do: { open: { mode: "entry", entry: { event: true } } } };
  assert.deepEqual(panelManifestSchema.parse({ ...input, events: { follow } }).events.follow, follow);
  assert.equal(panelManifestSchema.safeParse({
    ...input, events: { follow: { ...follow, do: { open: { mode: "entry", applicationId: "app", useId: "tasks" } } } },
  }).success, false);
});

test("entry resolution and personal-state scope use the actual use and nested path", async () => {
  const { applicationEntryResolutionSchema, applicationPanelReferencesRequestSchema } = await import("./product-panels");
  const { panelPersonalStateWriteRequestSchema } = await import("./panel-host");
  const { panelDefinitionSnapshotSchema } = await import("./product-subscriptions");
  const use = {
    id: "tasks", pageKey: "tasks", path: "/applications/app-tasks/tasks", panelId: "schedule-list",
    access: { kind: "domain-member" }, names: { en: "Tasks" }, groupKey: "plan",
    inputs: { term: { frameState: "term" }, role: { literal: null } },
  };
  const response = {
    applicationId: "app-tasks", use, framePanelId: "site-frame", theme: { dark: { "--test-accent": "#0084ff" } },
    menu: { groups: [{ key: "plan", names: { en: "Plan" }, sort: 0 }], panelUses: [use] },
  };
  assert.deepEqual(applicationEntryResolutionSchema.parse(response), response);
  const references = {
    domainId: "domain", framePanelId: "site-frame",
    uses: [
      { id: use.id, panelId: use.panelId, inputs: use.inputs },
      { id: "configured", panelId: use.panelId, defaultAgent: { kind: "preset", agentKind: "regular" } },
    ],
    delivery: { panels: [use.panelId], projections: ["projection-tasks"] },
  };
  assert.deepEqual(applicationPanelReferencesRequestSchema.parse(references), references);
  const memberPath = [{ member: "frame" }, {
    member: "preview", selection: { placement: { id: "current", target: { panelId: use.panelId } } },
  }];
  const request = { source: { kind: "registered", applicationId: "app-tasks", useId: "tasks" }, memberPath, values: { selected: null } };
  assert.deepEqual(panelPersonalStateWriteRequestSchema.parse(request), request);
  assert.equal(panelPersonalStateWriteRequestSchema.safeParse({ ...request, domainId: "other" }).success, false);
  assert.equal(panelPersonalStateWriteRequestSchema.safeParse({
    ...request, source: { kind: "candidate", workspace: { id: "eeb5fc31-8ecf-46a9-882f-728ce4ba3fff", ref: "working" } },
  }).success, false);
  const snapshot = { panel: { id: use.panelId, revision: 1 }, projections: [], members: [{ status: "forbidden", memberPath }] };
  assert.deepEqual(panelDefinitionSnapshotSchema.parse(snapshot), snapshot);
  assert.equal(panelDefinitionSnapshotSchema.safeParse({
    ...snapshot, members: [{ ...snapshot.members[0], target: { kind: "panel", id: "private-panel" } }],
  }).success, false);
});

test("direct task reads use the registered source, parameters and result envelope", async () => {
  const { directProjectionInputSchema, registerDirectProjectionRequestSchema } = await import("./product-panels");
  const { panelDataStateSchema, productPanelReadRequestSchema, productPanelReadResponseSchema } = await import("./panel-host");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const { directProjectionDataSchema, directReadDeclaration } = await import("./panel-projection");
  const form = {
    name: "Task form", description: "", visibility: "domain", revision: 0, componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: "platform:ScheduledTask" }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  };
  const { revision, ...formInput } = form;
  const projection = directProjectionInputSchema.parse(formInput);
  assert.deepEqual(registerDirectProjectionRequestSchema.parse({ ...projection, revision }), form);
  assert.equal(directReadDeclaration(projection, projection.data.form)?.source, "object");
  const declaredReads = [
    [{ type: platformType("platform:ScheduledTask") }, "list", "type", "panelRecordList"],
    [{ object: { literal: { className: "platform:ScheduledTask", primaryKey: "task-1" } } }, "record", "object", "panelRecord"],
  ] as const;
  for (const [source, read, kind, result] of declaredReads) {
    const declaration = directReadDeclaration(projection, directProjectionDataSchema.parse({ source, read, params: {} }));
    assert.equal(declaration?.source, kind);
    assert.equal(declaration?.result, result);
  }
  for (const data of [{ source: { type: platformType("platform:ScheduledTask") }, read: "record" },
    { source: { object: { input: "changedField" } }, read: "record" }])
    assert.equal(directReadDeclaration(projection, directProjectionDataSchema.parse({ ...data, params: {} })), undefined);
  const read = form.data.form;
  for (const rejected of [{ ...read, read: "delete" }, { ...read, params: { values: { state: "selected" } } },
    { ...read, params: { changedField: { literal: "missing-slash" } } }, { ...read, source: { object: { input: "missing" } } }])
    assert.equal(registerDirectProjectionRequestSchema.safeParse({ ...form, data: { form: rejected } }).success, false);

  const request = {
    source: { kind: "registered", applicationId: "app-trial", useId: "tasks" }, memberPath: [{ member: "form" }],
    dataName: "form", inputs: { task: { className: "platform:ScheduledTask", primaryKey: "task-1" } },
  };
  assert.deepEqual(productPanelReadRequestSchema.parse(request), request);
  const { dataName: _dataName, ...scope } = request;
  const operations = { ...scope, operations: true };
  assert.deepEqual(productPanelReadRequestSchema.parse(operations), operations);
  assert.equal(productPanelReadRequestSchema.safeParse({ ...request, operations: true }).success, false);
  const runtimeRequest = { ...request, runtimeParams: { values: { start: "09:00" }, changedField: "/start" } };
  assert.deepEqual(productPanelReadRequestSchema.parse(runtimeRequest), runtimeRequest);
  assert.equal(productPanelReadRequestSchema.safeParse({ ...request, runtimeParams: [] }).success, false);
  assert.equal(productPanelReadRequestSchema.safeParse({ source: request.source, items: [request] }).success, false);
  assert.equal(productPanelReadRequestSchema.safeParse({ ...request, memberPath: [{ member: "form", selection: "untrusted" }] }).success, false);
  assert.equal(productPanelReadResponseSchema.safeParse({ status: "forbidden", value: [] }).success, false);
  assert.equal(productPanelReadResponseSchema.safeParse({ status: "loading" }).success, false);
  assert.deepEqual(panelDataStateSchema.parse({ status: "loading" }), { status: "loading" });
  assert.equal(directProjectionDataSchema.safeParse({
    source: { operation: platformOperation(RUN_NOW) }, read: "describe", params: {},
  }).success, false);
  const row = { primaryKey: "task-1", label: "Morning report", fields: { state: "on" } };
  assert.deepEqual(panelReadResultSchemas.panelRecordList.parse([row]), [row]);
  assert.deepEqual(productPanelReadResponseSchema.parse({ status: "ready", value: row }), { status: "ready", value: row });
});

test("the current projection response admits named direct reads through the frame's binding keys", () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const projection = {
    id: "projection-schedules-summary", domainId: "domain", ownerId: "owner", revision: 1,
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z", editable: false,
    name: "Task summary", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
    outputs: {}, config: {},
  };
  const data = {
    record: { source: { object: { input: "task" } }, read: "record", params: {} },
    fixedRecord: { source: { object: { literal: { className: SCHEDULED_TASK, primaryKey: taskId } } }, read: "record", params: {} },
    list: { source: { type: platformType(SCHEDULED_TASK) }, read: "list", params: {} },
  };
  const operations = { run: { operation: platformOperation(RUN_NOW), target: { input: "task" } } };
  const response = (data: object, operations?: object) => productProjectionResponseSchema.parse({
    projection: { ...projection, data, ...(operations && { operations }) },
  });
  const taskKey = binding(SCHEDULED_TASK);
  const operationKey = bindingKey({ kind: "PlatformOperation", id: RUN_NOW });
  for (const read of [data.record, data.fixedRecord, data.list])
    assert.deepEqual(projectionBindingKeys(response({ read }).projection), [taskKey]);
  assert.deepEqual(projectionBindingKeys(response({}, operations).projection), [operationKey]);
  const parsed = response(data, operations);
  assert.deepEqual(parsed.projection, { ...projection, data, operations });
  const keys = projectionBindingKeys(parsed.projection);
  assert.deepEqual(keys, [taskKey, operationKey]);
  assert.equal(clientSends(keys, "GET", "/data-query", `/platform/scheduled-tasks/${taskId}`), true);
  assert.equal(clientSends(keys, "GET", "/data-query", "/platform-ontology/schema"), false);
});

test("direct panel read replies retain the owner's localized field and operation labels", async () => {
  const { productPanelOperationsReadResponseSchema, productPanelReadResponseSchema } = await import("./panel-host");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const row = {
    primaryKey: "11111111-1111-4111-8111-111111111111", label: "每日检查",
    fields: { application: "ops", settings: "每天 02:00", state: "on", nextRun: "" },
    fieldLabels: { application: "应用", settings: "设置", state: "状态", nextRun: "下次运行" },
  };
  const operation = {
    handlerRef: RUN_NOW, label: "立即运行", kind: "action", effect: "write", batch: false,
    target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {},
  };
  const replyValue = (value: unknown) => {
    const reply = productPanelReadResponseSchema.parse({ status: "ready", value });
    assert.ok(reply.status === "ready");
    return reply.value;
  };
  assert.deepEqual(panelReadResultSchemas.panelRecordList.parse(replyValue([row])), [row]);
  assert.deepEqual(panelReadResultSchemas.panelRecord.parse(replyValue(row)), row);
  const actions = { status: "ready", value: { runNow: operation } };
  assert.deepEqual(productPanelOperationsReadResponseSchema.parse(actions), actions);
  assert.equal(productPanelOperationsReadResponseSchema.safeParse({
    ...actions, value: { runNow: { ...operation, label: undefined } },
  }).success, false);
  assert.equal(panelReadResultSchemas.panelRecord.safeParse({ ...row, fieldLabels: { state: 1 } }).success, false);
});

test("a dispatched success carries the owner's message alongside the result data", () => {
  const reply = {
    kind: "dispatched", intentId: "eeb5fc31-8ecf-46a9-882f-728ce4ba3fff",
    outcome: { kind: "success", message: "已开始运行", data: { status: "running" } },
  };
  assert.deepEqual(panelHumanOperationDispatchResponseSchema.parse(reply), reply);
  assert.deepEqual(panelOperationOutcomeSchema.parse({ kind: "success", data: {} }), { kind: "success", data: {} });
  assert.equal(panelOperationOutcomeSchema.safeParse({ ...reply.outcome, message: { key: "started" } }).success, false);
});

test("the field port refers to another slot in the same manifest", () => {
  const picker = { target: { projectionId: "skill-picker" }, formField: { slot: "definition", path: "/skills" } };
  const members = { definition: { target: { projectionId: "definition-form" } }, picker };
  assert.deepEqual(panelManifestSchema.parse({ state: {}, members, events: {} }).members.picker?.formField, picker.formField);
  assert.equal(panelManifestSchema.safeParse({ state: {}, members: { picker }, events: {} }).success, false);
});

test("a row reference port identifies the array and a field relative to each row", () => {
  const formField = { slot: "workflow", path: "/steps", itemPath: "/actionId" };
  const members = { workflow: { target: { projectionId: "workflow-form" } }, picker: { target: { projectionId: "action-picker" }, formField } };
  assert.deepEqual(panelManifestSchema.parse({ state: {}, members, events: {} }).members.picker?.formField, formField);
  const invalid = { ...members, picker: { ...members.picker, formField: { ...formField, itemPath: "actionId" } } };
  assert.equal(panelManifestSchema.safeParse({ state: {}, members: invalid, events: {} }).success, false);
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

test("explicit operation bindings use the owner's type and the admitted member target", () => {
  const task = { kind: "object", objectType: SCHEDULED_TASK } as const;
  const ownerType = { target: { source: "input", input: "object" }, batch: false } as const;
  const operations = {
    runNow: { operation: platformOperation(RUN_NOW), target: { input: "record" } },
    save: { operation: platformOperation(SCHEDULED_TASK + ".save"), target: { input: "record" } },
  };
  const projection = productProjectionInputSchema.parse({
    name: "Tasks", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { record: task }, outputs: {}, config: {}, operations,
    data: { form: { source: { object: { input: "record" } }, read: "form", params: {} } },
  });
  const binding = projection.operations!.runNow;
  assert.equal(projectionOperationTargetMatches(projection, binding, ownerType, SCHEDULED_TASK), true);
  assert.equal(projectionOperationTargetMatches(projection, binding, ownerType, BUSINESS_KNOWLEDGE), false);
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, operations: { runNow: { ...binding, target: { input: "missing" } } },
  }).success, false);
  const manifest = panelManifestSchema.parse({
    state: { selectedTask: { type: task } },
    members: {
      list: { target: { projectionId: "tasks" }, inputs: { record: { state: "selectedTask" } } },
    },
    events: {},
  });
  const description = {
    handlerRef: RUN_NOW, effect: "write", kind: "action", label: "Run now", batch: false,
    target: { source: "input", input: "record" }, inputSchema: { type: "object" }, resultSchema: {},
  } as const;
  const run = projectionOperation(manifest, "list", "runNow", description);
  assert.equal(run.id, "list.runNow");
  assert.deepEqual(panelOperationSchema.parse(run).target, { source: "state", state: "selectedTask" });
  assert.deepEqual(run.inputSchema, { type: "object" });
  const save = projectionOperation(manifest, "list", "save", {
    ...description, handlerRef: SCHEDULED_TASK + ".save", kind: "form.save", label: "Save",
  });
  assert.deepEqual(panelOperationSchema.parse(save).target, { source: "draft", slot: "list" });
  assert.deepEqual(projectionBindingKeys(projection), [bindingKey(platformType(SCHEDULED_TASK)),
    bindingKey(platformOperation(RUN_NOW)), bindingKey(platformOperation(SCHEDULED_TASK + ".save"))]);
});

test("an explicit batch operation can bind a checked object list", () => {
  const selection = { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } };
  const projection = productProjectionInputSchema.parse({
    name: "Delete checked", description: "", visibility: "domain", componentId: "@ontomato/sdk:OperationButton",
    inputs: { selection }, outputs: {}, config: {}, data: {},
    operations: { remove: { operation: platformOperation(DELETE_KNOWLEDGE), target: { input: "selection" } } },
  });
  const declaration = { target: { source: "input", input: "knowledge" }, batch: true } as const;
  assert.equal(projectionOperationTargetMatches(projection, projection.operations!.remove, declaration, BUSINESS_KNOWLEDGE), true);
  assert.equal(projectionOperationTargetMatches(projection, projection.operations!.remove, { ...declaration, batch: false }, BUSINESS_KNOWLEDGE), false);
});

test("read operation inputs can take parameter values and a binding from this panel instance", () => {
  const bindingId = { state: "bindingId" };
  const parameters = { formField: { slot: "execution", path: "/parameters" } };
  const manifest = {
    state: { bindingId: { type: { kind: "scalar", type: "string" } } },
    members: {
      execution: { target: { projectionId: "runtime-form" } },
      trial: { target: { projectionId: "trial" }, readOperationInputs: { testExecute: { parameters, bindingId } } },
    },
    events: {},
  };
  assert.deepEqual(panelManifestSchema.parse(manifest).members.trial?.readOperationInputs?.testExecute, { parameters, bindingId });
  assert.equal(panelManifestSchema.safeParse({ ...manifest, state: {} }).success, false);
  const named = { parameters: { fields: { amount: { formField: { slot: "execution", path: "/amount" } }, binding: bindingId } } };
  const trial = { ...manifest.members.trial, readOperationInputs: { testExecute: named } };
  assert.deepEqual(panelManifestSchema.parse({ ...manifest, members: { ...manifest.members, trial } }).members.trial?.readOperationInputs?.testExecute, named);
  assert.equal(panelManifestSchema.safeParse({ ...manifest, members: { trial } }).success, false);
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
    const platformType = (id: string) => ({ kind: "PlatformObjectType" as const, id });
const platformOperation = (id: string) => ({ kind: "PlatformOperation" as const, id });
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
  const panel = { content: { html: "", module: "" }, manifest: { state: {}, members: {}, events: {} } };
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

test("field validation stays in the ready form and preserves the submitted value", async () => {
  const { productPanelReadResponseSchema } = await import("./panel-host");
  const fields = [{ ...editableField, path: "/start", label: "Start", control: { kind: "time" }, valueSchema: { type: "string" } }];
  const errors = [{ field: "/start", code: "invalid_time", message: "Enter a time between 00:00 and 23:59" }];
  const value = { fields, values: { start: "25:00" }, errors, save: ownerSave };
  const read = productPanelReadResponseSchema.parse({ status: "ready", value });
  assert.ok(read.status === "ready");
  assert.deepEqual(panelFormDescriptionSchema.parse(read.value), value);
  assert.equal(panelFormDescriptionSchema.safeParse({ fields, values: value.values, save: ownerSave }).success, false);
  assert.equal(productPanelReadResponseSchema.safeParse({ status: "error", message: "Validation", errors }).success, false);
});

test("write refusals carry typed field errors directly in the operation outcome", () => {
  const errors = [{ field: "/steps/0/start", code: "invalid_time", message: "Enter a valid time" }];
  const outcome = { kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Invalid field", errors };
  assert.deepEqual(panelOperationOutcomeSchema.parse(outcome), outcome);
  assert.equal(panelOperationOutcomeSchema.safeParse({ ...outcome, errors: [{ ...errors[0], field: "start" }] }).success, false);
  const batch = { kind: "batch", items: [{ target: { objectType: "platform:Workflow", primaryKey: "example" }, outcome }] };
  assert.deepEqual(panelOperationOutcomeSchema.parse(batch), batch);
});

test("model form reads and save refusals preserve format and duplicate name errors", () => {
  const errors = [
    { field: "/className", code: "invalid_format", message: "Use a valid class name" },
    { field: "/primaryKeyName", code: "already_exists", message: "This attribute name already exists" },
  ];
  const fields = errors.map(({ field }) => ({
    ...editableField, path: field, label: field, control: { kind: "text" }, valueSchema: { type: "string" },
  }));
  const form = { fields, values: { className: "bad class", primaryKeyName: "existing" }, errors, save: ownerSave };
  assert.deepEqual(panelFormDescriptionSchema.parse(form), form);
  const outcome = { kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Invalid model fields", errors };
  assert.deepEqual(panelOperationOutcomeSchema.parse(outcome), outcome);
});

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
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields, values, errors: [], save: ownerSave }), {
    fields, values, errors: [], save: ownerSave,
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
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields, values, errors: [], save: ownerSave }).fields, fields);

  const path = "/steps/0/actionId";
  const formField = { slot: "definition", path };
  const manifest = panelManifestSchema.parse({
    state: {}, events: {},
    members: { definition: { target: { projectionId: "workflow-form" } }, picker: { target: { projectionId: "action-picker" }, formField } },
  });
  assert.deepEqual(manifest.members.picker?.formField, formField);
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
  assert.deepEqual(panelFormDescriptionSchema.parse({ fields: [field], values, errors: [], save: ownerSave }).values, values);
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

test("current panel reads take no context or a complete use and one entrance", () => {
  const use = { applicationId: "ontology", useId: "ontology-agent-settings" };
  const pageKey = "agent-settings";
  const menu = { ...use, pageKey, permissionCode: "analysis-agent" };
  const member = { ...use, pageKey, access: "domain-member" };
  for (const query of [{}, menu, member]) assert.deepEqual(productPanelReadQuerySchema.parse(query), query);
  for (const query of [use, { pageKey }, { ...use, pageKey }, { ...menu, useId: undefined }, { ...menu, access: member.access }]) {
    assert.equal(productPanelReadQuerySchema.safeParse(query).success, false);
  }
});

test("current panel reads can carry a page skill member for the verified entrance", () => {
  const panel = {
    id: "agent-settings", domainId: "domain", ownerId: "owner", revision: 1,
    createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", editable: false,
    name: "Agent settings", description: "", visibility: "domain",
    content: { html: "<main></main>", module: "export {}" },
    manifest: { members: {}, state: {}, events: {} },
  };
  const pageSkillContext = {
    mode: "member",
    locator: { permissionCode: "analysis-agent", pageKey: "agent-settings" },
    member: {
      source: { kind: "application-use", applicationId: "ontology", useId: "ontology-agent-settings" },
      memberPath: [],
      ref: { namespace: { kind: "domain", domainId: "domain" }, name: "pvt-example" },
    },
  };
  const directPanel = {
    id: panel.id, domainId: panel.domainId, ownerId: panel.ownerId, revision: panel.revision,
    createdAt: panel.createdAt, updatedAt: panel.updatedAt, editable: panel.editable,
    name: panel.name, description: panel.description, visibility: panel.visibility,
    content: {
      html: '<div id="app"><projection slot="tasks"></projection></div>',
      module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
    },
    manifest: { state: {}, members: { tasks: { target: { projectionId: "task-list" } } }, events: {} },
  };
  assert.deepEqual(productPanelResponseSchema.parse({ panel: directPanel }), { panel: directPanel });
  assert.deepEqual(productPanelResponseSchema.parse({ panel: directPanel, pageSkillContext }), { panel: directPanel, pageSkillContext });
  assert.deepEqual(productPanelResponseSchema.parse({ panel }), { panel });
  assert.deepEqual(productPanelResponseSchema.parse({ panel, pageSkillContext }).pageSkillContext, pageSkillContext);
  const unavailable = { ...pageSkillContext, member: null };
  assert.deepEqual(productPanelResponseSchema.parse({ panel, pageSkillContext: unavailable }).pageSkillContext, unavailable);
  assert.equal(productPanelResponseSchema.safeParse({ panel, pageSkillContext: { ...pageSkillContext, member: {} } }).success, false);
});

test("panel reopen snapshots can carry a rechecked page skill context", () => {
  const snapshot = {
    panel: { id: "agent-settings", revision: 1 },
    projections: [{ id: "definition-form", revision: 2 }],
  };
  const pageSkillContext = {
    mode: "member",
    locator: { permissionCode: "analysis-agent", pageKey: "agents-agent-settings" },
    member: null,
  };
  assert.deepEqual(panelDefinitionSnapshotSchema.parse(snapshot), snapshot);
  assert.deepEqual(panelDefinitionSnapshotSchema.parse({ ...snapshot, pageSkillContext }).pageSkillContext, pageSkillContext);
  assert.equal(panelDefinitionSnapshotSchema.safeParse({ ...snapshot, pageSkillContext: { ...pageSkillContext, locator: {} } }).success, false);
});

test("a graph has two admitted sources and can use either a form field or separate selection outputs", () => {
  const projection = productProjectionInputSchema.parse({
    name: "Ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectGraph",
    data: {
      nodes: { source: { type: platformType(OBJECT_TYPE) }, read: "list", params: {} },
      edges: { source: { type: platformType(RELATIONSHIP) }, read: "list", params: {} },
    },
    config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
    inputs: {},
    outputs: {
      selectedNode: { kind: "object", objectType: OBJECT_TYPE },
      selectedEdge: { kind: "object", objectType: RELATIONSHIP },
    },
  });
  assert.deepEqual(projectionBindingKeys(projection), [binding(OBJECT_TYPE), binding(RELATIONSHIP)]);
  assert.deepEqual(projectionPorts(projection).outputs, projection.outputs);

  const range = panelManifestSchema.parse({
    state: {}, events: {},
    members: {
      definition: { target: { projectionId: "definition-form" } },
      range: { target: { projectionId: "data-scope" }, formField: { slot: "definition", path: "/classNames" } },
    },
  });
  assert.equal(range.members.range?.formField?.path, "/classNames");
  const state = { node: { type: { kind: "object", objectType: OBJECT_TYPE } }, edge: { type: { kind: "object", objectType: RELATIONSHIP } } };
  const outputs = { selectedNode: { state: "node" }, selectedEdge: { state: "edge" } };
  const graph = { members: { graph: { target: { projectionId: "ontology-model" }, outputs } }, events: {} };
  assert.deepEqual(panelManifestSchema.parse({ ...graph, state }).members.graph?.outputs, outputs);
  assert.equal(panelManifestSchema.safeParse({ ...graph, state: { node: state.node } }).success, false);
});

test("a named relationship is a binding identity and supplies no inferred edge selection type", () => {
  const relationship = { kind: "Relationship", id: "manages" };
  const projection = productProjectionInputSchema.parse({
    name: "Ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { node: { kind: "object", objectType: "Employee" } }, outputs: {}, config: {},
    data: { neighbors: { source: { type: relationship }, read: "neighbors", params: { node: { input: "node" } } } },
  });
  assert.deepEqual(projectionBindingKeys(projection), ["Relationship:manages"]);
  assert.deepEqual(projectionPorts(projection).outputs, {});
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
    panel: { content: { html: "", module: "" }, manifest: { state: {}, members: {}, events: {} } },
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

test("Action definition reads and writes use distinct exact binding requests", () => {
  const definitions = binding(ACTION);
  const deletion = bindingKey({ kind: "PlatformOperation", id: DELETE_ACTION });
  const status = bindingKey({ kind: "PlatformOperation", id: SET_ACTION_STATUS });
  for (const path of ["/action/queryList", "/action/queryById", "/action/definitionForm"]) {
    assert.ok(panelClientReads(definitions).some(read => read.method === "POST" && read.service === "/data-query" && read.path.test(path)));
    assert.ok(clientSends([definitions], "POST", "/data-query", path));
  }
  assert.ok(clientSends([definitions], "POST", "/data-query", "/action/save"));
  assert.ok(!panelClientReads(definitions).some(read => read.path.test("/action/save")));
  assert.ok(!clientSends([definitions], "POST", "/data-query", "/action/form"));
  assert.ok(!clientSends([definitions], "POST", "/data-query", "/action/delete"));
  assert.ok(clientSends([deletion], "POST", "/data-query", "/action/delete", { id: "example" }));
  assert.ok(!clientSends([deletion], "DELETE", "/data-query", "/action/delete"));
  assert.ok(clientSends([status], "POST", "/data-query", "/action/setStatus", { ids: ["example"], status: 1 }));
  assert.ok(!clientSends([status], "POST", "", "/action/setStatus"));
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
    handlerRef: "schedules.runNow", label: "Run now", kind: "action", effect: "write", target: { source: "input", input: "task" },
    inputSchema: {}, resultSchema: {}, batch: false,
  };
  assert.deepEqual(panelOperationDescriptorResponseSchema.parse(description), description);
});

const chartSource = { dashboardId: "board-a", cardId: "chart-1" };
const card = { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(chartSource) } } };
const chartProjection = {
  name: "Departments", description: "", visibility: "private",
  componentId: "@ontomato/sdk:MetricChart", metricId: "department-metric",
  inputs: { department: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
  data: {
    template: { source: card, read: "chartTemplate", params: {} },
    result: { source: card, read: "result", params: { department: { input: "department" } } },
  },
};

test("the chart reads its registered source card with per-metric overrides", () => {
  const projection = {
    ...chartProjection, id: "projection-a", domainId: "domain", ownerId: "author",
    revision: 1, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", editable: true,
  };
  const parsed = registerChartProjectionResponseSchema.parse({ projection }).projection;
  assert.deepEqual(parsed.data.template.source, card);
  assert.deepEqual(parsed.data.result.source, card);
  assert.equal(parsed.metricId, "department-metric");
  const renamed = { ...projection, data: { drawing: projection.data.template, points: projection.data.result } };
  assert.deepEqual(registerChartProjectionResponseSchema.parse({ projection: renamed }).projection.data, renamed.data);
  assert.equal(productProjectionInputSchema.safeParse({ ...chartProjection, chartSource }).success, false);
  assert.equal(productProjectionInputSchema.safeParse({ ...chartProjection, chartFile: {} }).success, false);
});

test("chart registration takes only the source identity and ordinary PUT cannot rebind it", () => {
  assert.deepEqual(registerChartProjectionRequestSchema.parse(chartSource), chartSource);
  assert.equal(registerChartProjectionRequestSchema.safeParse({ ...chartSource, id: "supplied-projection" }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({ ...chartProjection, revision: 1 }).success, false);
  const metadata = { name: chartProjection.name, description: "", visibility: "private", componentId: chartProjection.componentId };
  assert.equal(registerProductProjectionRequestSchema.safeParse({ ...metadata, revision: 0 }).success, false);
  assert.equal(registerProductProjectionRequestSchema.safeParse({ ...metadata, revision: 2 }).success, true);
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

  const projection = productProjectionInputSchema.parse(chartProjection);
  const bindings = projectionBindingKeys(projection);
  const metric = bindingKey({ kind: "MetricView", id: chartProjection.metricId });
  assert.deepEqual(bindings, [binding(DASHBOARD_CARD), metric]);
  for (const [path, body] of [
    ["/ontology/query/metrics/describe", { id: "department-metric" }],
    ["/ontology/query/metrics/execute", { id: "department-metric", revision: "r7", parameters: { department: "sales" } }],
  ] as const) {
    assert.ok(panelClientReads(metric).some(read => read.method === "POST" && read.path.test(path)));
    assert.ok(clientSends(bindings, "POST", "/data-query", path, body));
    assert.ok(!clientSends(bindings, "POST", "/data-query", path, { ...body, id: "other" }));
    assert.ok(!clientSends(bindings, "POST", "/data-query", path));
  }
  assert.ok(!clientSends(bindings, "POST", "/data-query", "/ontology/query/metrics/execute", {
    id: chartProjection.metricId, parameters: {},
  }));
  assert.ok(!clientSends(bindings, "POST", "/data-query", "/metricView/execute", {
    id: chartProjection.metricId, param: { department: "sales" },
  }));
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

test("an export uses the read endpoint without a draft or a write intent", () => {
  const feedback = {
    applicationId: "ontology", useId: "feedback", operationId: "list.export",
    call: { input: { search: "status", rating: "like" } },
  };
  assert.deepEqual(readPanelOperationRequestSchema.parse(feedback), feedback);
  const skill = {
    applicationId: "ontology", useId: "skills", operationId: "details.export",
    call: { target: { kind: "object", objectType: SKILL, primaryKey: "skill-1" }, input: {} },
  };
  assert.deepEqual(readPanelOperationRequestSchema.parse(skill), skill);
  assert.equal(readPanelOperationRequestSchema.safeParse({ ...feedback, call: { ...feedback.call, draft: {} } }).success, false);
});

test("a panel download validates the same basename and media type for the file and its receipt", async () => {
  const { panelDownloadFileSchema } = await import("./panel-download");
  const bytes = new Uint8Array([1, 2]);
  const file = { bytes, mime: "text/csv", suggestedName: "反馈.csv" };
  assert.deepEqual(panelDownloadFileSchema.parse(file), file);
  for (const invalid of [
    { suggestedName: "../feedback.csv" }, { suggestedName: ".feedback.csv" },
    { suggestedName: "feedback\u0000.csv" }, { suggestedName: "feedback.zip" },
    { mime: "text/html" }, { bytes: "encoded" },
  ]) {
    assert.equal(panelDownloadFileSchema.safeParse({ ...file, ...invalid }).success, false);
  }
  const receipt = { kind: "file", name: file.suggestedName, mime: file.mime };
  assert.deepEqual(panelReadOperationResultSchema.parse(receipt), receipt);
  assert.equal(panelReadOperationResultSchema.safeParse({ ...receipt, name: "feedback.zip" }).success, false);
  assert.equal(readPanelOperationResponseSchema.safeParse(receipt).success, false);
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
    handlerRef: "metricViews.testExecute", label: "Test", kind: "action", effect: "read", batch: false, target: { source: "draft", slot: "definition" },
    inputSchema: { type: "object" }, resultSchema: { type: "object" },
  };
  assert.deepEqual(panelReadOperationDescriptorSchema.parse(owner), owner);
  assert.equal(panelReadOperationDescriptorSchema.safeParse({ ...owner, effect: "write" }).success, false);
  for (const result of [{ kind: "markdown", markdown: "Preview" }, { kind: "json", value: [{ count: 1 }] }]) {
    assert.deepEqual(panelReadOperationResultSchema.parse(result), result);
    assert.equal(panelReadOperationResultSchema.safeParse({ ...result, affected: { objects: [] } }).success, false);
  }
});

test("the author type table and live descriptions share operation declarations", async () => {
  const { panelOperationDeclarationSchema, describePanelOperationFromDeclaration } = await import("./panel-operations");
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const run = panelOperationDeclarationSchema.parse({
    id: RUN_NOW, kind: "action", effect: "write", batch: false, target: { source: "input", input: "task" }, inputSchema: { type: "object" },
  });
  const save = panelOperationDeclarationSchema.parse({
    id: SCHEDULED_TASK + ".save", kind: "form.save", effect: "write", batch: false, target: { source: "draft" }, inputSchema: { type: "object" },
  });
  const table = {
    objectTypes: { [SCHEDULED_TASK]: { reads: platformObjectTypes[SCHEDULED_TASK].reads, operations: [run, save] } },
  };
  assert.deepEqual(platformTypeTableResponseSchema.parse(table), table);
  assert.equal(panelOperationDeclarationSchema.safeParse({ ...run, label: "Run now" }).success, false);

  const { id, ...staticFields } = run;
  assert.deepEqual(describePanelOperationFromDeclaration(run, { label: "Run now", resultSchema: {} }), {
    handlerRef: id, ...staticFields, label: "Run now", resultSchema: {},
  });
  assert.deepEqual(describePanelOperationFromDeclaration(save, { label: "Save", resultSchema: {}, slot: "form" }).target,
    { source: "draft", slot: "form" });
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
  const form = panelFormDescriptionSchema.parse({ fields, values, errors: [], save: ownerSave });
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

test("a declared child collection carries its parent-scoped selection across panel boundaries", () => {
  const field = { kind: "child-object", parentType: SKILL, collection: "files" };
  const child = { parent: { objectType: SKILL, primaryKey: "skill-a" }, primaryKey: "SKILL.md" };
  const state = { selectedFile: child };
  assert.deepEqual(panelStateFieldSchema.parse({ type: field, deepLink: true }), { type: field, deepLink: true, personal: false, external: false });
  assert.deepEqual(ontologyParameterTypeSchema.parse(field), field);
  assert.equal(singleOntologyParameterTypeSchema.safeParse(field).success, false);
  assert.equal(panelStateFieldSchema.safeParse({ type: { ...field, collection: "issues" } }).success, false);

  assert.deepEqual(panelOpenRequestSchema.parse({ useId: "skills", state }).state, state);
  assert.deepEqual(panelStateOperationSchema.parse({ id: "choose", labelKey: "choose", kind: "state", sets: state }).sets, state);
  const frame = { kind: "state", fromAddress: "/skills", state };
  assert.deepEqual(panelFrameMessageSchema.parse(frame), frame);

  const selection = {
    kind: "child-object", parent: child.parent, id: child.primaryKey, collection: "files", label: "Skill Example / SKILL.md",
  };
  assert.deepEqual(pageSelectionSchema.parse(selection), selection);
  assert.equal(pageSelectionSchema.safeParse({ kind: selection.kind, id: selection.id, label: selection.label }).success, false);
});

test("governance issues and sources use separate collection queries under one parent", () => {
  const parent = { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "report-a" };
  for (const collection of ["issues", "sources"]) {
    const query = { parent, collection };
    assert.deepEqual(panelChildCollectionQuerySchema.parse(query), query);
  }
  assert.equal(panelChildCollectionQuerySchema.safeParse({ parent, collection: "files" }).success, false);
  const unconverted = { className: parent.objectType, primaryKey: parent.primaryKey };
  assert.equal(panelChildCollectionQuerySchema.safeParse({ parent: unconverted, collection: "sources" }).success, false);
});

test("checked object collections are typed ports and never become deep-link state", () => {
  const field = { kind: "list", items: { kind: "object", objectType: METRIC_VIEW } };
  const refs = [{ className: METRIC_VIEW, primaryKey: "metric-a" }, { className: METRIC_VIEW, primaryKey: "metric-b" }];
  const state = { checked: refs };
  assert.deepEqual(panelStateFieldSchema.parse({ type: field }), { type: field, deepLink: false, personal: false, external: false });
  assert.equal(panelStateFieldSchema.safeParse({ type: field, deepLink: true }).success, false);
  assert.deepEqual(ontologyParameterTypeSchema.parse(field), field);
  assert.equal(singleOntologyParameterTypeSchema.safeParse(field).success, false);
  assert.deepEqual(panelStateValueSchema.parse(refs), refs);
  assert.deepEqual(panelStateValueSchema.parse([]), []);
  assert.deepEqual(panelStateOperationSchema.parse({ id: "clear", labelKey: "selection.clear", kind: "state", sets: { checked: [] } }).sets, { checked: [] });
  assert.equal(panelOpenRequestSchema.safeParse({ useId: "metrics", state }).success, false);

});

test("mixed graphs declare selected node types separately from the read bindings", () => {
  const nodeIdentity = { kind: "object-union", layers: [...platformOntologyLayers], objectTypes: [ONTOLOGY_TYPE] };
  const projection = productProjectionInputSchema.parse({
    name: "Platform ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { start: nodeIdentity }, outputs: { selectedNode: nodeIdentity }, config: {},
    data: { neighbors: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "neighbors", params: { node: { input: "start" } } } },
  });
  assert.deepEqual(projectionPorts(projection).outputs?.selectedNode, nodeIdentity);
  assert.deepEqual(projection.inputs.start, nodeIdentity);
  const manifest = panelManifestSchema.parse({
    state: { selected: { type: nodeIdentity } },
    members: { graph: { target: { projectionId: "mixed" }, outputs: { selectedNode: { state: "selected" } } } }, events: {},
  });
  assert.deepEqual(manifest.state.selected, { type: nodeIdentity, deepLink: false, personal: false, external: false });
  const user = panelStateValueSchema.parse({ className: ONTOLOGY_USER, primaryKey: "shared-key" });
  const definition = panelStateValueSchema.parse({ className: DEFINITION, primaryKey: "shared-key" });
  assert.notDeepEqual(user, definition);
});

test("object unions combine current layers and explicit types without duplicates", () => {
  const explicit = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", objectTypes: [DEFINITION, ONTOLOGY_TYPE] });
  assert.deepEqual(objectUnionTypes(explicit), [DEFINITION, ONTOLOGY_TYPE]);
  assert.equal(matchesObjectType(explicit, ONTOLOGY_TYPE), true);
  assert.equal(matchesObjectType(explicit, ONTOLOGY_USER), false);

  const layered = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", layers: ["capability"] });
  assert.equal(matchesObjectType(layered, DEFINITION), true);
  assert.equal(matchesObjectType(layered, ONTOLOGY_USER), false);
  assert.equal(matchesObjectType(layered, ONTOLOGY_TYPE), false);
  const combined = ontologyObjectUnionTypeSchema.parse({
    ...layered, objectTypes: [DEFINITION, ONTOLOGY_TYPE, ONTOLOGY_TYPE],
  });
  assert.deepEqual(objectUnionTypes(combined), [...objectUnionTypes(layered), ONTOLOGY_TYPE]);
  assert.equal(matchesObjectType(combined, ONTOLOGY_TYPE), true);
  assert.equal(matchesObjectType(combined, ONTOLOGY_USER), false);
  assert.equal(matchesObjectType({ kind: "object", objectType: ONTOLOGY_USER }, ONTOLOGY_USER), true);
});

test("object union contracts require a selector and reject unknown types and layers", () => {
  for (const selector of [
    { objectTypes: [DEFINITION, "platform:Missing"] },
    { layers: ["unclassified"] },
    { layers: ["capability"], objectTypes: ["platform:Missing"] },
    { layers: ["unclassified"], objectTypes: [DEFINITION] },
    { objectTypes: [] },
    { layers: [] },
    {},
  ]) {
    const field = { kind: "object-union", ...selector };
    assert.equal(ontologyObjectUnionTypeSchema.safeParse(field).success, false);
    assert.equal(panelStateFieldSchema.safeParse({ type: field }).success, false);
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

test("the ontology schema read preserves public type details and registered signatures", async () => {
  const { panelReadResultSchemas } = await import("./panel-operations");
  const { platformTypeDetailDeclarationSchema, platformTypeDetails } = await import("./platform-type-details");
  for (const [id, detail] of Object.entries(platformTypeDetails)) {
    assert.equal(platformTypeDetailDeclarationSchema.parse(detail).id, id);
  }
  const { id, ...detail } = platformTypeDetailDeclarationSchema.parse(platformTypeDetails[AGENT_DEFINITION]);
  const agent = {
    id, layer: "product", labelKey: "platformOntology.types.agentDefinition", ...detail,
    reads: { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } },
    operations: [{
      id: `${AGENT_DEFINITION}.save`, kind: "form.save", effect: "write", target: { source: "draft" },
      inputSchema: {}, batch: false,
    }],
  };
  const response = { layers: ["product"], objectTypes: [agent], relationKinds: [] };
  assert.deepEqual(panelReadResultSchemas.panelGraphSchema.parse(response), response);
  assert.equal(platformOntologySchemaResponseSchema.safeParse({
    ...response, objectTypes: [{
      ...agent, reads: { list: { ...agent.reads.list, result: "unregistered" } },
    }],
  }).success, false);
});

test("the four-layer topology points to declared kinds and distinguishes stored and derived edges", () => {
  for (const relation of platformRelationKinds) {
    assert.ok(platformObjectTypes[relation.from]?.labelKey);
    for (const target of typeof relation.to === "string" ? [relation.to] : relation.to)
      assert.ok(platformObjectTypes[target]?.labelKey);
  }
  assert.equal(platformRelationKinds.find(relation => relation.id === "user.published-workflow")?.derived, false);
  assert.equal(platformRelationKinds.find(relation => relation.id === "role.can-author-workflow")?.derived, true);
  assert.equal(platformRelationKinds.find(relation => relation.id === "panel.contains-panel")?.derived, false);
  assert.equal(platformRelationKinds.find(relation => relation.id === "panel.provides-skill")?.derived, true);
  assert.equal(platformObjectTypes[APPLICATION_PANEL_USE]?.layer, undefined);

  const projectionNode = { className: PRODUCT_PROJECTION, primaryKey: "proj-1", label: "Projection", layer: "product" as const };
  const boundTypeNode = { className: ONTOLOGY_TYPE, primaryKey: "platform:BusinessKnowledge", label: "platform:BusinessKnowledge", layer: "capability" as const };
  const boundEdge = {
    id: "projection.binds-target:proj-1->platform:BusinessKnowledge",
    relationKind: "projection.binds-target",
    from: { className: projectionNode.className, primaryKey: projectionNode.primaryKey },
    to: { className: boundTypeNode.className, primaryKey: boundTypeNode.primaryKey },
    direction: "outgoing" as const,
    derived: false,
    binding: { reads: ["query", "counts"], operations: ["platform:BusinessKnowledge.save"], viaInput: true },
  };
  assert.deepEqual(
    platformOntologyNeighborsResponseSchema.parse({
      node: projectionNode,
      neighbors: [boundTypeNode],
      edges: [boundEdge],
      relations: [{ relationKind: "projection.binds-target", status: "ok", edgeCount: 1 }],
    }).edges[0],
    boundEdge,
  );
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
    name: "Governance", description: "", visibility: "domain", componentId: "@ontomato/sdk:ConversationEntry",
    inputs: {}, data: {}, outputs: {}, config: {}, conversationEntry,
  });
  assert.deepEqual(projection.conversationEntry, conversationEntry);
});

test("only the host can send frame activity messages", () => {
  assert.deepEqual(panelHostFrameMessageSchema.parse({ kind: "activity", active: false }), { kind: "activity", active: false });
  assert.equal(panelFrameMessageSchema.safeParse({ kind: "activity", active: true }).success, false);
});
