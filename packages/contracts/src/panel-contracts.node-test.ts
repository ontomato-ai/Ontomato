import { formOptionSchema } from "./form-fields";
import { appsSdkBuildSchema, appsSdkCurrentSchema } from "./apps-sdk";
import {
  COMPONENT_PACKAGE_INCOMPATIBLE, componentPackageInstallRequestSchema, componentPackageInstallResponseSchema,
  componentPackageManifestSchema, componentPackageResponseSchema, componentPackageUpgradeErrorSchema,
  currentComponentPackageSchema,
} from "./component-packages";
import { panelModuleImports, readModuleFacts } from "./panel-module";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE, DELETE_SKILL, EXPORT_FEEDBACK, EXPORT_SKILL,
  FEEDBACK_RECORD, IMPORT_SKILL, SKILL,
} from "./panel-client-requests";
import {
  classifyPanelOperationOutcome,
  createPanelHumanOperationIntentRequestSchema,
  dispatchPanelHumanOperationIntentRequestSchema, inspectPanelOperationImpactRequestSchema,
  isPanelHumanOperationIntent, panelHumanOperationDispatchResponseSchema, panelHumanOperationPreparationSchema,
  panelOperationOutcomeSchema,
  panelOperationDescriptorResponseSchema, panelOperationRefSchema,
  panelWriteOperationSnapshotSchema, readPanelOperationRequestSchema, readPanelOperationResponseSchema, readStoredPanelOperationIntent,
} from "./panel-agent";
import { panelCompletedOperationSchema, panelOperationImpactSchema, panelReadOperationDescriptorSchema, panelReadOperationResultSchema } from "./panel-operations";
import {
  appBridgeConfirmPanelOperationResultSchema, appBridgeConfirmPanelOperationSchema,
  appBridgeExpandPageComposerSchema, appBridgeRequestSchema, APP_BRIDGE_CHANNEL,
} from "./app-bridge";
import { defaultAgentSchema } from "./default-agent";
import { pageSkillSchema } from "./page-skills";
import assert from "node:assert/strict";
import test from "node:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { dashboardCardPrimaryKey } from "./dashboard";
import { DASHBOARD_CARD } from "./platform-object-types";
import {
  ACTION, ACTIVATE_WORKFLOW, AGENT_DEFINITION, ATTRIBUTE, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW, DELETE_ACTION, DELETE_AGENT, DELETE_FUNCTION, DELETE_METRIC_VIEW, DELETE_TRIGGER, EXTERNAL_MCP_SERVICE, FUNCTION, METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP, SET_ACTION_STATUS, SET_METRIC_VIEW_STATUS, SET_TRIGGER_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW, TRIAL_ACTION, TRIGGER, USER, WORKFLOW,
  RUN_NOW, SCHEDULED_TASK, bindingKey, chartProjectionLookupRead, chartProjectionSourcePath, chartProjectionSourceSends, clientSends, panelClientReads,
} from "./panel-client-requests";
import {
  candidatePanelSourceSchema, panelFrameMessageSchema,
  panelHostFrameMessageSchema, panelHostMessageSchema, panelUsePath,
} from "./panel-host";
import {
  matchesObjectType, objectUnionTypes, ontologyObjectUnionTypeSchema, ontologyParameterTypeSchema,
  panelChildCollectionQuerySchema, panelChildObjectIdentitySchema, panelManifestSchema, panelMemberInputSchema, panelOpenRequestSchema, panelStateFieldSchema,
  panelOperationSchema, panelStateOperationSchema, panelStateValueSchema, singleOntologyParameterTypeSchema,
} from "./panel-manifest";
import { pageSelectionSchema } from "./page-context";
import { findPanelFormOption, panelFormObjectSelectError, panelFormOptionSchema } from "./form-fields";
import {
  panelFormDescriptionSchema, panelFormFieldSchema, panelFormFrequencyValueSchema,
  panelFormObjectActiveFields, panelFormObjectActiveVariant, panelFormObjectAllFields,
  panelFormRequestSchema, panelFormSaveInputSchema, panelFormTimeValueSchema,
  panelObjectListColumnSchema, panelRecordFieldArrayItemSchema, panelRecordFieldText,
  panelRecordFieldValueSchema, panelRecordTagFieldValueSchema, panelStateOperation, projectionBindingKeys, projectionOperation,
  projectionOperationTargetMatches, projectionPorts, pruneInactivePanelFormVariants,
  type PanelFormField, type PanelFormObjectControl, type PanelFormValues,
} from "./panel-projection";
import { platformTaskFrequencySchema } from "./platform-schedules";
import {
  platformOntologyCountsResponseSchema, platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyObjectsResponseSchema, platformOntologyReadQuerySchema,
  platformOntologySchemaResponseSchema, platformOntologyStartResponseSchema,
} from "./platform-ontology";
import {
  APPLICATION_PANEL_USE, DEFINITION, DELETE_PERMISSION_POLICY, GRANT_POLICY_ENTRIES, INSPECT_POLICY_ACCESS,
  LIST_PENDING_POLICY_GRANTS, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, ORG_GRANT, ORG_MEMBERSHIP, ORG_POSITION, ORG_UNIT,
  PERMISSION_POLICY, PREVIEW_POLICY_ENTRY_GRANT, PRODUCT_PROJECTION,
  RESOLVE_PENDING_POLICY_GRANT, ROLE, USER as ONTOLOGY_USER,
  platformObjectTypes, platformOntologyLayers, platformRelationGroups, platformRelationKinds,
} from "./platform-object-types";
import {
  applicationPanelUseSchema, applicationPanelUsePathSchema, chartProjectionLookupResponseSchema, chartProjectionTemplateSchema,
  chartSourceInUseErrorSchema, ontologyElementRefSchema, productPanelContentSchema, productPanelReadQuerySchema, productPanelResponseSchema,
  productPanelSnapshotQuerySchema,
  productProjectionInputSchema, productProjectionResponseSchema,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema, registerProductProjectionRequestSchema,
  updateChartProjectionSourceRequestSchema,
} from "./product-panels";
import { ontologyParameterTypeSchema as legacyOntologyParameterTypeSchema } from "./product-projections";
import { panelDefinitionSnapshotSchema } from "./product-subscriptions";
import { platformTypeTableEntrySchema } from "./platform-type-table";

const platformType = (id: string) => ({ kind: "PlatformObjectType" as const, id });
const platformOperation = (id: string) => ({ kind: "PlatformOperation" as const, id });
const binding = (id: string) => bindingKey({ kind: "PlatformObjectType", id });

test("member inputs allow only identity fields on declared single-object state", () => {
  const input = { state: "selection", field: "primaryKey" } as const;
  assert.deepEqual(panelMemberInputSchema.parse(input), input);
  assert.equal(panelMemberInputSchema.safeParse({ ...input, field: "label" }).success, false);
  assert.equal(panelMemberInputSchema.safeParse({ ...input, path: [] }).success, false);

  const members = { list: { target: { projectionId: "list" }, inputs: { className: input } } };
  for (const type of [
    { kind: "object", objectType: "Order" },
    { kind: "object-union", objectTypes: ["Order", "Customer"] },
    { kind: "child-object", parentType: "Order", collection: "lines" },
  ]) {
    assert.equal(panelManifestSchema.safeParse({ state: { selection: { type } }, members }).success, true);
  }
  for (const type of [
    { kind: "scalar", type: "string" },
    { kind: "list", items: { kind: "object", objectType: "Order" } },
  ]) {
    const parsed = panelManifestSchema.safeParse({ state: { selection: { type } }, members });
    assert.equal(parsed.success, false);
    if (!parsed.success)
      assert.deepEqual(parsed.error.issues[0]?.path, ["members", "list", "inputs", "className", "field"]);
  }
  assert.equal(panelManifestSchema.safeParse({ state: {}, members }).success, false);
  assert.equal(panelManifestSchema.safeParse({
    state: { selection: { type: { kind: "object", objectType: "Order" } } },
    members: { list: { target: { projectionId: "list" }, outputs: { selected: input } } },
  }).success, false);
});

test("member inputs reference a sibling's read-only output and optional JSON Pointer", () => {
  const target = { projectionId: "projection" };
  const output = { member: "form", name: "draft" };
  for (const input of [{ output }, { output: { ...output, path: "/function/code" } }]) {
    assert.deepEqual(panelMemberInputSchema.parse(input), input);
    assert.equal(panelManifestSchema.safeParse({
      state: {},
      members: { form: { target }, reader: { target, inputs: { content: input } } },
    }).success, true);
  }
  for (const path of ["function/code", "/function/~2code", "/function/code~", ""]) {
    assert.equal(panelMemberInputSchema.safeParse({ output: { ...output, path } }).success, false);
  }
  assert.equal(panelMemberInputSchema.safeParse({ output: { ...output, extra: true } }).success, false);
  assert.equal(panelMemberInputSchema.safeParse({ output, state: "selected" }).success, false);
  for (const member of ["missing", "reader"]) {
    const result = panelManifestSchema.safeParse({
      state: {},
      members: { form: { target }, reader: { target, inputs: { content: { output: { ...output, member } } } } },
    });
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["members", "reader", "inputs", "content", "output", "member"]);
  }
});

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
    check: "node/panel-check.mjs",
    packageComponents: "node/package-components.mjs", libraries: { vue: "3.5.0" }, docs: "docs/index.md",
  };
  assert.deepEqual(appsSdkReleaseManifestSchema.parse(manifest), manifest);
  assert.equal(appsSdkReleaseManifestSchema.safeParse({ ...manifest, check: "/node/panel-check.mjs" }).success, false);
  const { packageComponents: _missing, ...legacy } = manifest;
  assert.equal(appsSdkReleaseManifestSchema.safeParse(legacy).success, false);
  assert.equal(appsSdkReleaseManifestSchema.safeParse({
    ...manifest, packageComponents: "../node/package-components.mjs",
  }).success, false);
});

test("the SDK catalogue separates supply, configuration and run inputs", async () => {
  const { appsSdkComponentCatalogSchema } = await import("./panel-check");
  const component = {
    componentId: "ObjectList", module: "@ontomato/sdk/base", exportName: "ObjectList",
    role: "presentation", meaning: "Show and select the rows supplied by the owner.",
    data: { rows: { results: ["panelRecordList"], required: true, runtimeParams: ["search"] } },
    config: [{ name: "fields", type: "string[]", description: "Visible fields", required: false }],
    inputs: { selected: { kind: "object", objectType: "@binding" } },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
    },
    ports: { props: [], events: [{ name: "navigate", type: "PanelObjectRef", description: "A navigation event" }], slots: [] },
  };
  const catalogue = { version: "1.1.2", components: [component] };
  assert.deepEqual(appsSdkComponentCatalogSchema.parse(catalogue), catalogue);
  assert.equal(appsSdkComponentCatalogSchema.safeParse({
    ...catalogue, components: [{ ...component, outputs: ["selected"] }],
  }).success, false);
  for (const datum of [{ results: [], required: true }, { results: ["notRegistered"], required: true }, { results: ["panelRecord"] }]) {
    assert.equal(appsSdkComponentCatalogSchema.safeParse({
      ...catalogue, components: [{ ...component, data: { rows: datum } }],
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

test("the checker accepts short data and operation members with reusable projection identities", async () => {
  const { panelAuthoringManifestSchema } = await import("./panel-check");
  const list = {
    id: "9da36511-7755-4b61-b526-3be2694c1f2f",
    component: "ObjectList", type: BUSINESS_KNOWLEDGE,
    data: { rows: "query" }, state: { selected: "selected", search: "search" },
  };
  const approve = { component: "OperationButton", operation: APPROVE_KNOWLEDGE, target: "selected", config: { type: "primary" } };
  const state = {
    selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    search: { type: { kind: "scalar", type: "string" } },
  };
  const reused = { target: { projectionId: "registered-summary" } };
  const manifest = { state, members: { list, approve, reused } };
  const parsed = panelAuthoringManifestSchema.parse(manifest);
  assert.deepEqual(parsed.members, manifest.members);
  assert.equal(panelAuthoringManifestSchema.safeParse({
    ...manifest, members: { list: {
      ...list, data: { rows: { read: "query", params: { search: { state: "search" }, status: { literal: "pending" } } } },
    } },
  }).success, true);
  assert.equal(panelAuthoringManifestSchema.safeParse({
    ...manifest, members: { list: { ...list, id: "previously-registered-list" } },
  }).success, true);
  for (const member of [{ ...list, id: "" }, { component: "ObjectList" }]) {
    assert.equal(panelAuthoringManifestSchema.safeParse({ ...manifest, members: { list: member } }).success, false);
  }
  assert.equal(panelAuthoringManifestSchema.safeParse({ ...manifest, members: { list: { ...list, inputs: {} } } }).success, true);
});

test("short panel members can open the page composer with an explicit agent and prefill", async () => {
  const { panelAuthoringMemberSchema } = await import("./panel-check");
  const member = { component: "ConversationEntry", agent: "page-default", prefill: "Review this domain's knowledge." };
  assert.deepEqual(panelAuthoringMemberSchema.parse(member), member);
  for (const agent of [{ kind: "id", id: "governance-agent" }, { kind: "preset", agentKind: "knowledge-governance" }]) {
    const qualified = { ...member, component: "@ontomato/sdk:ConversationEntry", agent };
    assert.deepEqual(panelAuthoringMemberSchema.parse(qualified), qualified);
  }
  for (const invalid of [
    { component: member.component, prefill: member.prefill },
    { ...member, agent: "governance-agent" },
    { ...member, data: { rows: "query" } },
    { ...member, component: "OperationButton", operation: APPROVE_KNOWLEDGE },
  ]) {
    assert.equal(panelAuthoringMemberSchema.safeParse(invalid).success, false);
  }
});

test("short members can name distinct data owners but need a read or operation", async () => {
  const { panelAuthoringMemberSchema } = await import("./panel-check");
  const graph = {
    component: "RecordGraph", type: "platform:ObjectType",
    data: { nodes: "list", edges: { type: "platform:Relationship", read: "list" } },
  };
  assert.deepEqual(panelAuthoringMemberSchema.parse(graph), graph);
  assert.equal(panelAuthoringMemberSchema.safeParse({ ...graph, type: undefined }).success, false);
  assert.equal(panelAuthoringMemberSchema.safeParse({
    ...graph, type: undefined,
    data: { ...graph.data, nodes: { type: "platform:ObjectType", read: "list" } },
  }).success, true);
  const mode = {
    component: "SegmentedControl", config: { options: [{ value: "instance", label: "Instance" }] },
    state: { value: "mode" },
  };
  assert.equal(panelAuthoringMemberSchema.safeParse(mode).success, false);
  const counts = {
    ...mode, type: BUSINESS_KNOWLEDGE,
    data: { counts: { read: "counts", params: { by: { literal: "status" } } } },
  };
  assert.deepEqual(panelAuthoringMemberSchema.parse(counts), counts);
});

test("a short metric chart names its source card and takes the projection from that owner", async () => {
  const { panelAuthoringMemberSchema } = await import("./panel-check");
  const chart = {
    component: "MetricChart", sourceCard: { dashboardId: "operations", cardId: "daily" },
    state: { term: "selectedTerm" },
  };
  for (const component of [chart.component, "@ontomato/sdk:MetricChart"]) {
    assert.deepEqual(panelAuthoringMemberSchema.parse({ ...chart, component }), { ...chart, component });
  }
  for (const invalid of [
    { component: chart.component },
    { ...chart, id: "9da36511-7755-4b61-b526-3be2694c1f2f" },
    { ...chart, sourceCard: { ...chart.sourceCard, metricId: "override" } },
    { ...chart, component: "ObjectList", type: BUSINESS_KNOWLEDGE, data: { rows: "query" } },
  ]) {
    assert.equal(panelAuthoringMemberSchema.safeParse(invalid).success, false);
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

test("reference pickers declare the named reads they use", async () => {
  const { registerDirectProjectionRequestSchema } = await import("./product-panels");
  const { panelReadResultSchemas } = await import("./panel-operations");
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

test("owner rows may give a status tone and a field's values as tags", async () => {
  const { panelRecordSchema } = await import("./panel-projection");
  const row = { primaryKey: "k-1", label: "Order rule", fields: { status: "Approved", knowledgeTags: "Business, Tech" } };
  const toned = { ...row, tones: { status: "success" }, tags: { knowledgeTags: ["Business", "Tech"] } };
  assert.deepEqual(panelRecordSchema.parse(toned), toned);
  assert.equal(panelRecordSchema.safeParse({ ...row, tones: { status: "green" } }).success, false);
  assert.equal(panelRecordSchema.safeParse({ ...row, tags: { knowledgeTags: "Business" } }).success, false);
});

test("owner rows may give a field's value a display text without changing the value", async () => {
  const { panelRecordSchema } = await import("./panel-projection");
  const row = { primaryKey: "k-1", label: "Order", fields: { status: "APPROVED", amount: "12.5" } };
  const labelled = { ...row, valueLabels: { status: "Approved", amount: "Twelve fifty" } };
  assert.deepEqual(panelRecordSchema.parse(labelled), labelled);
  // The stored value stays as it is, so a labelled record still reads back the same value.
  assert.equal(panelRecordSchema.parse(labelled).fields.status, "APPROVED");
  assert.equal(panelRecordSchema.safeParse({ ...row, valueLabels: { status: "" } }).success, false);
  assert.equal(panelRecordSchema.safeParse({ ...row, valueLabels: { status: { APPROVED: "Approved" } } }).success, false);
});

test("panel records carry optional className and strongly typed field values", async () => {
  const { panelRecordFieldValueSchema, panelRecordSchema } = await import("./panel-projection");
  const record = {
    primaryKey: "mcp-1",
    className: "platform:PublishedMcpService",
    label: "Order MCP",
    fields: {
      status: "enabled",
      toolCount: 3,
      enabled: true,
      title: { kind: "localized" as const, values: { "zh-CN": "订单服务", en: "Order Service" } },
      owner: { kind: "reference" as const, className: "platform:User", primaryKey: "u-1", label: "Alice" },
      paramRef: {
        kind: "child-reference" as const,
        parent: { objectType: "platform:Action", primaryKey: "act-1" },
        collection: "parameters",
        primaryKey: "order_id",
        label: "order_id",
      },
      tools: {
        kind: "json" as const,
        value: [{ name: "query_order", inputSchema: { type: "object", required: ["id"] } }],
      },
      tags: [
        "production",
        2,
        false,
        { kind: "reference" as const, className: "platform:Action", primaryKey: "a-1", label: "Sync" },
        {
          kind: "child-reference" as const,
          parent: { objectType: "platform:Action", primaryKey: "act-1" },
          collection: "codeSegments",
          primaryKey: "seg-1",
          label: "Update order (L2–5)",
        },
      ],
    },
  };
  assert.deepEqual(panelRecordSchema.parse(record), record);

  // Empty values must omit the key rather than carrying null or undefined; non-finite numbers are rejected.
  assert.equal(panelRecordFieldValueSchema.safeParse(null).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse(undefined).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse(Number.NaN).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse(Number.POSITIVE_INFINITY).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse(Number.NEGATIVE_INFINITY).success, false);
  assert.equal(panelRecordSchema.safeParse({ primaryKey: "k-1", label: "Row", fields: { missing: null } }).success, false);
  assert.equal(panelRecordSchema.safeParse({ primaryKey: "k-1", label: "Row", fields: { missing: undefined } }).success, false);

  // Strict tagged shapes and bounded className / array item unions.
  assert.equal(panelRecordSchema.safeParse({ ...record, className: "" }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "localized", values: { "": "bad" } }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "localized", values: { en: "ok" }, extra: true }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "reference", className: "", primaryKey: "p-1", label: "x" }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "reference", className: "platform:User", primaryKey: "u-1", label: "Alice", extra: 1 }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({
    kind: "child-reference",
    parent: { objectType: "platform:Action", primaryKey: "act-1" },
    collection: "",
    primaryKey: "order_id",
    label: "order_id",
  }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({
    kind: "child-reference",
    parent: { objectType: "platform:Action", primaryKey: "act-1" },
    collection: "parameters",
    primaryKey: "order_id",
    label: "order_id",
    extra: 1,
  }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "json", value: { ok: true }, extra: 1 }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse({ kind: "json", value: Number.POSITIVE_INFINITY }).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse([{ kind: "localized", values: { en: "nested" } }]).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse([{ kind: "json", value: {} }]).success, false);
  assert.equal(panelRecordFieldValueSchema.safeParse([null]).success, false);
});

test("panelRecordObjectRef resolves record className with fallback and rejects missing className", async () => {
  const { panelRecordObjectRef } = await import("./panel-projection");
  assert.deepEqual(
    panelRecordObjectRef({ primaryKey: "act-1", className: "platform:Action" }, "platform:ObjectType"),
    { className: "platform:Action", primaryKey: "act-1" },
  );
  assert.deepEqual(
    panelRecordObjectRef({ primaryKey: "task-1" }, "platform:ScheduledTask"),
    { className: "platform:ScheduledTask", primaryKey: "task-1" },
  );
  assert.throws(
    () => panelRecordObjectRef({ primaryKey: "task-1" }),
    /no className and no fallbackClassName/u,
  );
  assert.throws(
    () => panelRecordObjectRef({ primaryKey: "task-1" }, ""),
    /no className and no fallbackClassName/u,
  );
  assert.throws(() => panelRecordObjectRef({ primaryKey: "", className: "platform:ScheduledTask" }));
});

test("panelRecordFieldText formats scalars, localized maps, references, arrays and json payloads", async () => {
  const { panelRecordFieldText } = await import("./panel-projection");
  assert.equal(panelRecordFieldText(undefined, "zh-CN"), "");
  assert.equal(panelRecordFieldText("hello", "zh-CN"), "hello");
  assert.equal(panelRecordFieldText(42, "zh-CN"), "42");
  assert.equal(panelRecordFieldText(0, "zh-CN"), "0");
  assert.equal(panelRecordFieldText(true, "zh-CN"), "true");
  assert.equal(panelRecordFieldText(false, "zh-CN"), "false");
  assert.equal(
    panelRecordFieldText({
      kind: "child-reference",
      parent: { objectType: "platform:Action", primaryKey: "act-1" },
      collection: "parameters",
      primaryKey: "order_id",
      label: "order_id",
    }),
    "order_id",
  );
  assert.equal(
    panelRecordFieldText({
      kind: "child-reference",
      parent: { objectType: "platform:Action", primaryKey: "act-1" },
      collection: "parameters",
      primaryKey: "order_id",
      label: "",
    }),
    "order_id",
  );
  assert.equal(
    panelRecordFieldText([
      "Target:",
      {
        kind: "child-reference",
        parent: { objectType: "platform:Action", primaryKey: "act-1" },
        collection: "parameters",
        primaryKey: "order_id",
        label: "order_id",
      },
    ]),
    "Target:, order_id",
  );

  // Localized fallback chain: zh-CN -> zh -> fallbackLocale -> first non-empty entry.
  assert.equal(
    panelRecordFieldText({ kind: "localized", values: { "zh-CN": "订单", zh: "订单简", en: "Order" } }, "zh-CN", "en"),
    "订单",
  );
  assert.equal(
    panelRecordFieldText({ kind: "localized", values: { zh: "订单简", en: "Order" } }, "zh-CN", "en"),
    "订单简",
  );
  assert.equal(
    panelRecordFieldText({ kind: "localized", values: { "zh-CN": "  ", en: "Order", ja: "注文" } }, "zh-CN", "en-US"),
    "Order",
  );
  assert.equal(
    panelRecordFieldText({ kind: "localized", values: { ja: "注文", fr: "Commande" } }, "zh-CN", "en"),
    "注文",
  );
  assert.equal(panelRecordFieldText({ kind: "localized", values: {} }, "zh-CN", "en"), "");

  // References prefer label and fall back to primaryKey.
  assert.equal(
    panelRecordFieldText({ kind: "reference", className: "platform:User", primaryKey: "u-1", label: "Alice" }),
    "Alice",
  );
  assert.equal(
    panelRecordFieldText({ kind: "reference", className: "platform:User", primaryKey: "u-1", label: "" }),
    "u-1",
  );

  // Arrays join non-empty element texts cleanly.
  assert.equal(
    panelRecordFieldText([
      "core",
      "",
      3,
      true,
      { kind: "reference", className: "platform:Skill", primaryKey: "sk-1", label: "SQL" },
      { kind: "reference", className: "platform:Skill", primaryKey: "sk-2", label: "" },
    ]),
    "core, 3, true, SQL, sk-2",
  );
  assert.equal(panelRecordFieldText([]), "");

  // Structured JSON payloads: scalar to string, null to empty string, object/array via JSON.stringify.
  assert.equal(panelRecordFieldText({ kind: "json", value: null }), "");
  assert.equal(panelRecordFieldText({ kind: "json", value: "raw" }), "raw");
  assert.equal(panelRecordFieldText({ kind: "json", value: 99 }), "99");
  assert.equal(panelRecordFieldText({ kind: "json", value: false }), "false");
  assert.equal(
    panelRecordFieldText({ kind: "json", value: [{ name: "search" }] }),
    '[{"name":"search"}]',
  );
  assert.equal(
    panelRecordFieldText({ kind: "json", value: { ok: true, count: 2 } }),
    '{"ok":true,"count":2}',
  );
});

test("skill catalogues expose authorized diagnostics and panel reads carry only display text", async () => {
  const { assistantSkillCatalogSchema } = await import("./assistant-chat");
  const { panelOptionListSchema, panelRecordQuerySchema } = await import("./panel-projection");
  const diagnostic = {
    skill: { namespace: { kind: "domain", domainId: "domain-a" }, name: "pvt-panel-skill" },
    resourceId: "knowledge-panel",
    reason: "record_missing",
  };
  const diagnostics = { items: [diagnostic], sourceUnavailable: true };
  assert.deepEqual(assistantSkillCatalogSchema.parse({ skills: [], diagnostics }), { skills: [], diagnostics });
  assert.deepEqual(assistantSkillCatalogSchema.parse({ skills: [] }), { skills: [] });
  assert.equal(assistantSkillCatalogSchema.safeParse({
    skills: [], diagnostics: { ...diagnostics, items: [{ ...diagnostic, reason: "raw error message" }] },
  }).success, false);

  const messages = ["Some skill sources could not be read."];
  assert.deepEqual(panelOptionListSchema.parse({ options: [], diagnostics: messages }), { options: [], diagnostics: messages });
  assert.deepEqual(panelRecordQuerySchema.parse({ rows: [], diagnostics: messages }), { rows: [], diagnostics: messages });
  assert.equal(panelOptionListSchema.safeParse({ options: [], diagnostics }).success, false);
  assert.equal(panelRecordQuerySchema.safeParse({ rows: [], diagnostics: diagnostics.items }).success, false);
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
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, componentId: "@ontomato/sdk:ObjectForm", data: {
      createForm: { source: { type: { kind: "ObjectType", id: "Customer" } }, read: "createForm", params: {} },
    },
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...base, componentId: "@ontomato/sdk:ObjectForm", data: {
      form: { source: { type: { kind: "ObjectType", id: "Customer" } }, read: "form", params: {} },
    },
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

test("metric and function catalogue queries bind owner filters to enum inputs", async () => {
  const { panelReadInputMatches } = await import("./panel-projection");
  const list = {
    name: "Catalogue", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
  };
  const metricQuery = {
    source: { type: platformType(METRIC_VIEW) }, read: "query",
    params: { status: { literal: "PUBLISHED" }, origin: { literal: "USER" } },
  };
  const functionQuery = {
    source: { type: platformType(FUNCTION) }, read: "query",
    params: { operation: { literal: "OPERATION_READ" } },
  };
  assert.equal(productProjectionInputSchema.safeParse({ ...list, data: { rows: metricQuery } }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...list, data: { rows: { ...metricQuery, params: { status: { literal: "DRAFT" } } } },
  }).success, false);
  assert.equal(productProjectionInputSchema.safeParse({ ...list, data: { rows: functionQuery } }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...list, data: { rows: { ...functionQuery, params: { operation: { literal: "OPERATION_DELETE" } } } },
  }).success, false);
  assert.equal(panelReadInputMatches("metricViewStatus", { kind: "scalar", type: "string" }), true);
  assert.equal(panelReadInputMatches("metricViewOrigin", { kind: "scalar", type: "string" }), true);
  assert.equal(panelReadInputMatches("functionOperation", { kind: "scalar", type: "string" }), true);
});

test("audit log queries bind filters to string inputs", () => {
  const projection = {
    name: "Audit log", description: "", visibility: "domain", componentId: "@ontomato/sdk:PanelData",
    inputs: { business: { kind: "scalar", type: "string" }, operation: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { rows: { source: { type: platformType("platform:AuditLog") }, read: "query",
      params: { business: { input: "business" }, operation: { input: "operation" } } } },
  };
  assert.equal(productProjectionInputSchema.safeParse(projection).success, true);
});

test("ontology object lists use search while reference options keep keyword", () => {
  const projection = {
    name: "Find an ontology object", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
    inputs: {}, outputs: {}, config: {},
  };
  const instances = { source: { type: platformType(ONTOLOGY_TYPE) }, read: "instances" };
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { rows: { ...instances, params: { className: { literal: USER }, search: { literal: "Lee" } } } },
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { rows: { ...instances, params: { className: { literal: USER }, keyword: { literal: "Lee" } } } },
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
  assert.deepEqual(required(SKILL, "file"), ["path"]);
  assert.deepEqual(platformObjectTypes[SKILL].operations, [IMPORT_SKILL, DELETE_SKILL, EXPORT_SKILL]);
  assert.deepEqual(platformObjectTypes[FEEDBACK_RECORD].operations, [EXPORT_FEEDBACK]);
});

test("permission policy describes and saves all grants through its owner form", () => {
  const policy = platformObjectTypes[PERMISSION_POLICY];
  assert.deepEqual(Object.keys(policy.reads ?? {}).sort(), [
    "count", "createForm", "form", "options", "query", "record", "resolve",
  ]);
  assert.deepEqual(policy.operations, [
    `${PERMISSION_POLICY}.save`, DELETE_PERMISSION_POLICY,
    PREVIEW_POLICY_ENTRY_GRANT, GRANT_POLICY_ENTRIES, LIST_PENDING_POLICY_GRANTS,
    RESOLVE_PENDING_POLICY_GRANT, INSPECT_POLICY_ACCESS,
  ]);
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
    state: {}, members: { tasks: { target: { projectionId: "projection-schedules-tasks" } } },
  };
  const body = { name: "Scheduled tasks", description: "", visibility: "domain", revision: 0, content, manifest };
  const current = {
    ...body, id: "schedules", domainId: "domain", ownerId: "owner", revision: 1, editable: true,
    createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z",
  };
  assert.deepEqual(registerProductPanelRequestSchema.parse(body).content, content);
  assert.deepEqual(productPanelResponseSchema.parse({ panel: current }).panel.content, content);
  assert.equal(registerProductPanelRequestSchema.safeParse({ ...body, sdkVersion: "1.1.2" }).success, false);
  // Declarative/presentation-only panels may omit panel.mjs (content.module) while keeping html.
  const withoutModule = { html: content.html };
  for (const result of [
    panelDefinitionContentSchema.safeParse({ content: withoutModule, manifest }),
    registerProductPanelRequestSchema.safeParse({ ...body, content: withoutModule }),
    productPanelResponseSchema.safeParse({ panel: { ...current, content: withoutModule } }),
  ]) {
    assert.equal(result.success, true);
  }
  // Unrecognized keys in content are still rejected.
  assert.equal(panelDefinitionContentSchema.safeParse({ content: { html: content.html, bogus: "x" }, manifest }).success, false);
});

test("a panel manifest validates state, placements, and declared slot components", () => {
  const agent = { kind: "object", objectType: AGENT_DEFINITION };
  const input = {
    state: {
      agents: { type: { kind: "list", items: agent }, personal: true, default: [] },
      tags: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, deepLink: true, default: ["active"] },
      agent: { type: agent, default: { className: AGENT_DEFINITION, primaryKey: "default-agent" }, deepLink: true, external: true },
      mode: { type: { kind: "scalar", type: "string" }, deepLink: true },
      preview: { type: { kind: "placement", candidates: { rule: "usable" } } },
    },
    components: {
      "status-pill": "domain-component:11111111-1111-4111-8111-111111111111",
    },
    members: {
      row: { target: { panelId: "agent-detail" }, inputs: { agent: { state: "agent" } } },
      details: { target: { fromState: "agent", candidates: { rule: "objectDetail" } } },
    },
  };
  const manifest = panelManifestSchema.parse(input);
  assert.deepEqual(Object.keys(manifest.members), ["row", "details"]);
  assert.deepEqual(manifest.components, input.components);
  assert.equal(panelManifestSchema.safeParse({
    ...input, state: { selected: { type: { kind: "objects", objectType: AGENT_DEFINITION } } },
  }).success, false);
  assert.equal(panelManifestSchema.safeParse({
    ...input, commands: {},
  }).success, false);
});

test("application addresses carry flat named frame and entry state while preserving shell parameters", async () => {
  const {
    applicationPanelAddress,
    panelAddress,
    panelAddressState,
    parseApplicationPanelAddress,
    validateApplicationPanelAddressState,
  } = await import("./panel-host");
  const path = "/applications/app-school/orders";
  const query = new URLSearchParams([["standalone", "1"], ["from", "工作区"]]);
  const frame = { term: "秋季 & 春季" };
  const state = { mode: "list", term: "ignored", tags: ["one", "two"] };
  const encoded = applicationPanelAddress(path, { frame, state, query });
  assert.equal(encoded.includes("state="), false);
  assert.equal(encoded.includes("frame="), false);
  assert.equal(encoded.includes("frame.term="), true);
  assert.equal(encoded.includes("tags=one&tags=two"), true);
  const parsed = parseApplicationPanelAddress(encoded);
  assert.deepEqual(parsed, { path, frame, state, query });
  assert.equal(applicationPanelAddress(path), path);

  const manifest = panelManifestSchema.parse({
    state: {
      term: { type: { kind: "scalar", type: "string" }, deepLink: true },
      mode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "cards" },
      page: { type: { kind: "scalar", type: "number" }, deepLink: true, default: 1 },
      onlyMine: { type: { kind: "scalar", type: "boolean" }, deepLink: true, default: false },
      since: { type: { kind: "scalar", type: "date" }, deepLink: true },
      selected: { type: { kind: "object", objectType: "platform:Relationship" }, deepLink: true },
      unionNode: {
        type: { kind: "object-union", objectTypes: ["platform:Action", "platform:ObjectType"] },
        deepLink: true,
      },
      childAttr: {
        type: { kind: "child-object", parentType: "platform:ObjectType", collection: "attributes" },
        deepLink: true,
      },
      tags: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, deepLink: true },
      items: {
        type: { kind: "list", items: { kind: "object", objectType: "platform:Action" } },
        deepLink: true,
      },
      privateSelection: { type: { kind: "scalar", type: "string" } },
    },
    members: {},
  });

  // Flat encoding with manifest: omits defaults, encodes fixed object as primaryKey, object-union as className~primaryKey.
  const fullState = {
    mode: "cards", // equals default -> omitted
    page: 2,
    onlyMine: true,
    since: "2026-11-23",
    selected: { className: "platform:Relationship", primaryKey: "order_has_item" },
    unionNode: { className: "platform:Action", primaryKey: "act-1" },
    childAttr: { parent: { objectType: "platform:ObjectType", primaryKey: "Order" }, primaryKey: "amount" },
    tags: ["a", "b"],
    items: [
      { className: "platform:Action", primaryKey: "act-1" },
      { className: "platform:Action", primaryKey: "act-2" },
    ],
    privateSelection: "never-in-url",
  };
  const flatUrl = panelAddress(`${path}?standalone=1&from=workspace&frame.term=2026-fall`, fullState, manifest);
  assert.equal(
    flatUrl,
    `${path}?standalone=1&from=workspace&frame.term=2026-fall&page=2&onlyMine=true&since=2026-11-23&selected=order_has_item&unionNode=platform:Action~act-1&childAttr=Order~amount&tags=a&tags=b&items=act-1&items=act-2`,
  );
  // Round-trip decoding with manifest restores exact typed values while keeping shell & frame params separate.
  assert.deepEqual(panelAddressState(flatUrl, manifest), {
    page: 2,
    onlyMine: true,
    since: "2026-11-23",
    selected: { className: "platform:Relationship", primaryKey: "order_has_item" },
    unionNode: { className: "platform:Action", primaryKey: "act-1" },
    childAttr: { parent: { objectType: "platform:ObjectType", primaryKey: "Order" }, primaryKey: "amount" },
    tags: ["a", "b"],
    items: [
      { className: "platform:Action", primaryKey: "act-1" },
      { className: "platform:Action", primaryKey: "act-2" },
    ],
  });
  // Single-element list param decodes as 1-element array; primaryKey containing `~` round-trips via full form.
  const tildeState = {
    selected: { className: "platform:Relationship", primaryKey: "a~b" },
    tags: ["solo"],
  };
  const tildeUrl = panelAddress(path, tildeState, manifest);
  assert.equal(tildeUrl, `${path}?selected=platform:Relationship~a~b&tags=solo`);
  assert.deepEqual(panelAddressState(tildeUrl, manifest), tildeState);

  // Invalid values, mismatched object types, and legacy ?state=/?frame= JSON are safely ignored.
  const malformed = `${path}?page=nope&onlyMine=yes&since=2026/11/23&selected=platform:Other~id&unionNode=missing-sep&state=${encodeURIComponent(JSON.stringify({ mode: "list" }))}&frame=${encodeURIComponent(JSON.stringify({ term: "A" }))}`;
  assert.deepEqual(panelAddressState(malformed, manifest), {});
  assert.deepEqual(parseApplicationPanelAddress(malformed, { stateManifest: manifest, frameManifest: manifest }).frame, {});

  assert.deepEqual(validateApplicationPanelAddressState("frame", frame, manifest), frame);
  assert.deepEqual(validateApplicationPanelAddressState("state", { mode: "list", term: "ignored" }, manifest, ["term"]), { mode: "list" });
  assert.throws(() => validateApplicationPanelAddressState("frame", frame, undefined), /frame\.term/);
  assert.throws(() => validateApplicationPanelAddressState("frame", { term: 1 }, manifest), /frame\.term.*declared type/);
  assert.throws(() => validateApplicationPanelAddressState("state", { privateSelection: "x" }, manifest), /state\.privateSelection/);
});

test("flat panel URLs encode empty string lists as named empty parameters without unnamed auxiliary keys", async () => {
  const { applicationPanelAddress, panelAddress, panelAddressState, parseApplicationPanelAddress } = await import("./panel-host");
  const path = "/applications/app-school/orders";
  const type = { kind: "list", items: { kind: "scalar", type: "string" } };
  for (const defaultValue of [undefined, ["default"]]) {
    const manifest = panelManifestSchema.parse({ state: { tags: { type, deepLink: true, default: defaultValue } }, members: {} });
    // Empty list encodes as `?tags=` (distinguished from omitted param), and never adds unnamed auxiliary keys.
    const emptyUrl = panelAddress(path, { tags: [] }, manifest);
    assert.equal(emptyUrl, `${path}?tags=`);
    assert.deepEqual(panelAddressState(emptyUrl, manifest), { tags: [] });
    assert.deepEqual(panelAddressState(path, manifest), {});

    // A singleton empty string encodes as `?tags=` without auxiliary keys and restores as `[]`.
    const singletonEmptyUrl = panelAddress(path, { tags: [""] }, manifest);
    assert.equal(singletonEmptyUrl, `${path}?tags=`);
    assert.deepEqual(panelAddressState(singletonEmptyUrl, manifest), { tags: [] });

    for (const tags of [[], ["a"], ["a", ""], ["a", "b"]]) {
      const state = { tags };
      const panelUrl = panelAddress(path, state, manifest);
      assert.deepEqual(panelAddressState(panelUrl, manifest), state, panelUrl);
      const url = applicationPanelAddress(path, { frame: state, state, frameManifest: manifest, stateManifest: manifest });
      const raw = parseApplicationPanelAddress(url);
      const forwarded = applicationPanelAddress(raw.path, raw);
      const parsed = parseApplicationPanelAddress(forwarded, { frameManifest: manifest, stateManifest: manifest });
      assert.deepEqual(parsed.frame, state, forwarded);
      assert.deepEqual(parsed.state, state, forwarded);
    }
  }
});

test("unnamed query parameters (=x, tags=&=tags, frame.=x) are ignored without error when parsing or rebuilding panel addresses", async () => {
  const { applicationPanelAddress, panelAddress, panelAddressState, parseApplicationPanelAddress } = await import("./panel-host");
  const path = "/applications/app-school/orders";
  const manifest = panelManifestSchema.parse({
    state: {
      tags: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, deepLink: true },
      page: { type: { kind: "scalar", type: "number" }, deepLink: true, default: 1 },
      term: { type: { kind: "scalar", type: "string" }, deepLink: true },
    },
    members: {},
  });

  const cases = [
    {
      url: `${path}?tags=&=tags`,
      untypedState: { tags: "" },
      typedState: { tags: [] },
      rebuilt: `${path}?tags=`,
    },
    {
      url: `${path}?=x`,
      untypedState: {},
      typedState: {},
      rebuilt: path,
    },
    {
      url: `${path}?frame.=x&page=2`,
      untypedState: { page: "2" },
      typedState: { page: 2 },
      rebuilt: `${path}?page=2`,
    },
  ];

  for (const { url, untypedState, typedState, rebuilt } of cases) {
    // Manifest-free parsing and rebuilding: unnamed keys never enter frame/state/query and never throw on re-encode.
    const raw = parseApplicationPanelAddress(url);
    assert.deepEqual(raw.frame, {}, url);
    assert.deepEqual(raw.state, untypedState, url);
    assert.deepEqual([...raw.query.entries()], [], url);
    assert.equal(applicationPanelAddress(raw.path, raw), rebuilt, url);
    assert.deepEqual(panelAddressState(url), untypedState, url);
    assert.equal(panelAddress(url, {}), rebuilt, url);

    // Manifest-aware parsing and rebuilding: unnamed keys are ignored while valid named parameters round-trip cleanly.
    const parsed = parseApplicationPanelAddress(url, { frameManifest: manifest, stateManifest: manifest });
    assert.deepEqual(parsed.frame, {}, url);
    assert.deepEqual(parsed.state, typedState, url);
    assert.deepEqual([...parsed.query.entries()], [], url);
    assert.equal(
      applicationPanelAddress(parsed.path, { ...parsed, frameManifest: manifest, stateManifest: manifest }),
      rebuilt,
      url,
    );
    assert.deepEqual(panelAddressState(url, manifest), typedState, url);
    assert.equal(panelAddress(url, parsed.state, manifest), rebuilt, url);
  }
});

test("clearing non-empty defaults encodes explicit empty markers and round-trips without snapping back", async () => {
  const {
    applicationPanelAddress,
    panelAddress,
    panelAddressState,
    parseApplicationPanelAddress,
  } = await import("./panel-host");
  const path = "/applications/app-school/orders";
  const defaultAction = { className: "platform:Action", primaryKey: "act-default" };
  const defaultChild = { parent: { objectType: "platform:ObjectType", primaryKey: "Order" }, primaryKey: "id" };
  const manifest = panelManifestSchema.parse({
    state: {
      tags: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, deepLink: true, default: ["a", "b"] },
      emptyDefaultTags: { type: { kind: "list", items: { kind: "scalar", type: "string" } }, deepLink: true, default: [] },
      items: { type: { kind: "list", items: { kind: "object", objectType: "platform:Action" } }, deepLink: true, default: [defaultAction] },
      mode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "cards" },
      emptyDefaultMode: { type: { kind: "scalar", type: "string" }, deepLink: true, default: "" },
      page: { type: { kind: "scalar", type: "number" }, deepLink: true, default: 1 },
      onlyMine: { type: { kind: "scalar", type: "boolean" }, deepLink: true, default: true },
      since: { type: { kind: "scalar", type: "date" }, deepLink: true, default: "2026-11-01" },
      selected: { type: { kind: "object", objectType: "platform:Action" }, deepLink: true, default: defaultAction },
      unionNode: {
        type: { kind: "object-union", objectTypes: ["platform:Action", "platform:ObjectType"] },
        deepLink: true,
        default: defaultAction,
      },
      childAttr: {
        type: { kind: "child-object", parentType: "platform:ObjectType", collection: "attributes" },
        deepLink: true,
        default: defaultChild,
      },
      optionalSelected: { type: { kind: "object", objectType: "platform:Action" }, deepLink: true },
    },
    members: {},
  });

  // Values matching declared defaults (including non-empty lists and empty defaults) are omitted cleanly.
  assert.equal(
    panelAddress(path, {
      tags: ["a", "b"],
      emptyDefaultTags: [],
      items: [defaultAction],
      mode: "cards",
      emptyDefaultMode: "",
      page: 1,
      onlyMine: true,
      since: "2026-11-01",
      selected: defaultAction,
      unionNode: defaultAction,
      childAttr: defaultChild,
      optionalSelected: null,
    }, manifest),
    path,
  );

  // Clearing non-empty list defaults to `[]`, non-empty string default to `""`, and non-null scalar/object
  // defaults to `null` emits explicit `?k=` markers that round-trip to empty/null instead of snapping back.
  const clearedUrl = panelAddress(path, {
    tags: [],
    emptyDefaultTags: [],
    items: [],
    mode: "",
    emptyDefaultMode: "",
    page: null,
    onlyMine: null,
    since: null,
    selected: null,
    unionNode: null,
    childAttr: null,
    optionalSelected: null,
  }, manifest);
  assert.equal(
    clearedUrl,
    `${path}?tags=&items=&mode=&page=&onlyMine=&since=&selected=&unionNode=&childAttr=`,
  );
  assert.deepEqual(panelAddressState(clearedUrl, manifest), {
    tags: [],
    items: [],
    mode: "",
    page: null,
    onlyMine: null,
    since: null,
    selected: null,
    unionNode: null,
    childAttr: null,
  });

  // Manifest-free parse -> serialize preserves explicit empty markers in both frame and entry segments.
  const framedCleared = `${path}?frame.term=&tags=`;
  const parsedRaw = parseApplicationPanelAddress(framedCleared);
  assert.deepEqual(parsedRaw.frame, { term: "" });
  assert.deepEqual(parsedRaw.state, { tags: "" });
  assert.equal(applicationPanelAddress(parsedRaw.path, { frame: parsedRaw.frame, state: parsedRaw.state, query: parsedRaw.query }), framedCleared);

  // An empty segment mixed into a multi-value non-string list is rejected rather than producing `[null, ...]`.
  assert.deepEqual(panelAddressState(`${path}?items=&items=act-1`, manifest), {});
});

test("the application reference check carries both theme modes as literal strings", async () => {
  const { applicationPanelReferencesRequestSchema } = await import("./product-panels");
  const theme = { light: { "--radius-md": "6px" }, dark: { "--radius-md": "8px" } };
  const reference = { domainId: "school", uses: [], delivery: { panels: [], projections: [] }, theme };
  assert.deepEqual(applicationPanelReferencesRequestSchema.parse(reference).theme, theme);
  const invalid = applicationPanelReferencesRequestSchema.safeParse({ ...reference, theme: { dark: { "--radius-md": 4 } } });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.deepEqual(invalid.error.issues[0]?.path, ["theme", "dark", "--radius-md"]);
});

test("current entry is supplied from the resolved use and its slot cannot override inputs", async () => {
  const { applicationEntryResolutionQuerySchema, applicationFrameContextOf, applicationFrameSourceSchema } = await import("./product-panels");
  const applicationId = "app-school", useId = "orders";
  const path = "/applications/app-school/orders";
  assert.deepEqual(applicationEntryResolutionQuerySchema.parse({ path }), { path });
  assert.deepEqual(applicationEntryResolutionQuerySchema.parse({ applicationId, useId }), { applicationId, useId });
  assert.equal(applicationEntryResolutionQuerySchema.safeParse({ path, applicationId, useId }).success, false);
  const use = {
    id: useId, pageKey: "school.orders", panelId: "orders-panel", path,
    inputs: { term: { literal: "A" } },
  };
  const menu = { singleEntry: true, groups: [], panelUses: [use] };
  const frameContext = applicationFrameContextOf({ applicationId, use, menu });
  assert.deepEqual(frameContext, { currentEntry: { applicationId, useId, pageKey: use.pageKey, panelId: use.panelId, path, kind: "panel" }, menu });
  assert.equal(Object.isFrozen(frameContext.currentEntry), true);
  assert.equal(applicationFrameSourceSchema.safeParse({ kind: "frame", applicationId, useId, panelId: "another" }).success, false);
  const content = { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } };
  const manifest = { state: {}, members: { content } };
  assert.deepEqual(panelManifestSchema.parse(manifest).members.content, content);
  assert.equal(panelManifestSchema.safeParse({
    ...manifest, members: { content: { ...content, inputs: { term: { literal: "B" } } } },
  }).success, false);
});

test("entry resolution and personal-state scope use the actual use and nested path", async () => {
  const { applicationEntryResolutionSchema, applicationPanelReferencesRequestSchema } = await import("./product-panels");
  const { panelPersonalStateWriteRequestSchema } = await import("./panel-host");
  const { panelDefinitionSnapshotSchema } = await import("./product-subscriptions");
  const use = {
    id: "tasks", pageKey: "tasks", path: "/applications/app-tasks/tasks", panelId: "schedule-list",
    names: { en: "Tasks" }, groupKey: "plan",
    inputs: { term: { frameState: "term" }, role: { literal: null } },
  };
  const response = {
    applicationId: "app-tasks", use, framePanelId: "site-frame", theme: { dark: { "--radius-md": "10px" } },
    menu: { singleEntry: true, groups: [{ key: "plan", names: { en: "Plan" }, sort: 0 }], panelUses: [use] },
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

test("success receipts carry a strictly shaped created object identity", () => {
  const created = { objectType: ATTRIBUTE, primaryKey: "Order.code" };
  const outcome = { kind: "success", data: {}, created };
  assert.deepEqual(panelOperationOutcomeSchema.parse(outcome), outcome);
  const dispatch = { kind: "dispatched", intentId: "eeb5fc31-8ecf-46a9-882f-728ce4ba3fff", outcome };
  assert.deepEqual(panelHumanOperationDispatchResponseSchema.parse(dispatch), dispatch);
  for (const invalid of [null, { objectType: ATTRIBUTE }, { ...created, primaryKey: "" }, { ...created, objectType: "" }, { ...created, extra: true }]) {
    assert.equal(panelOperationOutcomeSchema.safeParse({ ...outcome, created: invalid }).success, false);
  }
});

test("completed operations preserve and validate the created identity through the panel host message", () => {
  const operation = { operationId: "form.save", panelId: "attributes", target: null };
  const created = { objectType: ATTRIBUTE, primaryKey: "Order.code" };
  const completed = { ...operation, created };
  assert.deepEqual(panelCompletedOperationSchema.parse(operation), operation);
  assert.deepEqual(panelCompletedOperationSchema.parse(completed), completed);
  const event = { kind: "object-changed", target: null, operation: completed };
  assert.deepEqual(panelHostFrameMessageSchema.parse(event), event);
  for (const invalid of [null, { objectType: ATTRIBUTE }, { ...created, primaryKey: "" }, { ...created, extra: true }]) {
    assert.equal(panelCompletedOperationSchema.safeParse({ ...operation, created: invalid }).success, false);
  }
});

test("legacy formField member attachments are rejected in favour of ObjectForm Vue slots", () => {
  const picker = { target: { projectionId: "skill-picker" }, formField: { slot: "definition", path: "/skills" } };
  const members = { definition: { target: { projectionId: "definition-form" } }, picker };
  assert.equal(panelManifestSchema.safeParse({ state: {}, members }).success, false);
  const rowPicker = { target: { projectionId: "action-picker" }, formField: { slot: "workflow", path: "/steps", itemPath: "/actionId" } };
  assert.equal(panelManifestSchema.safeParse({ state: {}, members: { workflow: { target: { projectionId: "workflow-form" } }, picker: rowPicker } }).success, false);
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

test("read operations can bind a draft, parameters and a binding ID in this panel instance", () => {
  const bindingId = { state: "bindingId" };
  const draft = { slot: "metricEditor" };
  const parameters = { formField: { slot: "execution", path: "/parameters" } };
  const manifest = {
    state: { bindingId: { type: { kind: "scalar", type: "string" } } },
    members: {
      metricEditor: { target: { projectionId: "metric-form" } },
      execution: { target: { projectionId: "runtime-form" } },
      trial: { target: { projectionId: "trial" }, readOperationInputs: { testExecute: { draft, parameters, bindingId } } },
    },
  };
  assert.deepEqual(panelManifestSchema.parse(manifest).members.trial?.readOperationInputs?.testExecute, { draft, parameters, bindingId });
  assert.equal(panelManifestSchema.safeParse({ ...manifest, state: {} }).success, false);
  const named = { draft, parameters: { fields: { amount: { formField: { slot: "execution", path: "/amount" } }, binding: bindingId } } };
  const trial = { ...manifest.members.trial, readOperationInputs: { testExecute: named } };
  assert.deepEqual(panelManifestSchema.parse({ ...manifest, members: { ...manifest.members, trial } }).members.trial?.readOperationInputs?.testExecute, named);
  const missingDraft = panelManifestSchema.safeParse({ ...manifest, members: { execution: manifest.members.execution, trial } });
  assert.equal(missingDraft.success, false);
  if (!missingDraft.success) assert.deepEqual(missingDraft.error.issues[0].path,
    ["members", "trial", "readOperationInputs", "testExecute", "draft", "slot"]);
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
  const panel = { content: { html: "", module: "" }, manifest: { state: {}, members: {} } };
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
const ownerSave = { method: "PUT", path: "/workflows/example", bodySchema: {} };

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

const defaultAgentOption = {
  value: { kind: "preset", agentKind: "knowledge-governance" },
  label: "Knowledge governance", description: null, disabled: false, disabledReason: null,
};

test("object select values round-trip and match the declared option regardless of object key order", () => {
  const field = {
    ...editableField, required: false, path: "/defaultAgent", label: "Default agent", valueSchema: { type: "object" },
    control: { kind: "select", options: [defaultAgentOption] },
  };
  const selection = { agentKind: "knowledge-governance", kind: "preset" };
  const input = panelFormSaveInputSchema.parse({ values: { defaultAgent: selection } });
  const form = panelFormDescriptionSchema.parse({ fields: [field], values: input.values, errors: [], save: ownerSave });
  const { control } = form.fields[0];
  assert.equal(control.kind, "select");
  assert.deepEqual(findPanelFormOption(control.options, form.values.defaultAgent), defaultAgentOption);
  assert.equal(panelFormObjectSelectError(field.path, input.values.defaultAgent, { ...field, options: control.options }), undefined);
  assert.equal(panelFormObjectSelectError(field.path, undefined, { ...field, options: [] }), undefined);
});

test("object select rejects undeclared values and points to the invalid field and value", () => {
  const field = "/panelUses/1/defaultAgent";
  const choices = { required: false, options: [defaultAgentOption] };
  const unknown = { kind: "preset", agentKind: "elsewhere" };
  assert.deepEqual(panelFormObjectSelectError(field, unknown, choices), {
    field, code: "invalid_option", message: `Field '${field}' has no declared option for ${JSON.stringify(unknown)}`,
  });
  assert.deepEqual(panelFormObjectSelectError(field, "elsewhere", choices), {
    field, code: "invalid_object", message: `Field '${field}' expects an object option, received "elsewhere"`,
  });
  assert.equal(panelFormObjectSelectError(field, defaultAgentOption.value, { ...choices, options: [] })?.code, "invalid_option");
  assert.equal(panelFormFieldSchema.safeParse({
    ...editableField, path: field, label: "Default agent", valueSchema: { type: "object" },
    control: { kind: "select", options: choices.options, allowCreate: true },
  }).success, false);
});

test("localized text keeps the owner's language map and language-level field pointers", () => {
  const control = {
    kind: "localized-text", primaryLocale: "zh-CN",
    locales: [{ code: "zh-CN", label: "中文" }, { code: "en", label: "英语" }],
    multiline: true, maxLength: 120,
  };
  const field = {
    ...editableField, path: "/names", label: "名称", control, valueSchema: { type: "object" },
  };
  const values = { names: { en: "", "zh-CN": "应用", fr: "Application" } };
  const errors = [{ field: "/names/en", code: "required", message: "填写英文名称" }];
  const form = { fields: [field], values, errors, save: ownerSave };
  // Omitted, no language is required; the description keeps it omitted, so its input and output types are one.
  assert.deepEqual(panelFormDescriptionSchema.parse(form), form);

  const requiredControl = { ...control, requiredLocales: ["en"] };
  const nested = { ...form, fields: [{
    ...editableField, path: "/identity", label: "Identity", valueSchema: { type: "object" },
    control: { kind: "object", fields: [{ ...field, control: requiredControl }] },
  }] };
  assert.deepEqual(panelFormDescriptionSchema.parse(nested), nested);

  for (const invalid of [
    { ...control, maxLength: 0 }, { ...control, maxLength: 1.2 }, { ...control, requiredLocales: null },
    { ...control, locales: [{ code: "en", label: "英语", selected: true }] }, { ...control, custom: true },
  ]) assert.equal(panelFormDescriptionSchema.safeParse({ ...form, fields: [{ ...field, control: invalid }] }).success, false);
  const input = { values, submittedFields: ["/names/en"] };
  assert.deepEqual(panelFormSaveInputSchema.parse(input), input);
});

test("an application icon control preserves the owner's existing icon key", () => {
  const field = {
    ...editableField, path: "/icon", label: "Application icon",
    control: { kind: "application-icon" }, valueSchema: { type: "string" },
  };
  for (const icon of ["settings", "legacy-icon-key"]) {
    const form = { fields: [field], values: { icon }, errors: [], save: ownerSave };
    assert.deepEqual(panelFormDescriptionSchema.parse(form), form);
    assert.equal(panelFormDescriptionSchema.safeParse({
      ...form, fields: [{ ...field, control: { ...field.control, options: [] } }],
    }).success, false);
  }
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
  const manifest = panelManifestSchema.parse({
    state: {},
    members: { definition: { target: { projectionId: "workflow-form" } }, picker: { target: { projectionId: "action-picker" } } },
  });
  assert.deepEqual(Object.keys(manifest.members), ["definition", "picker"]);
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

test("form save preserves omitted and explicit null values alongside submitted field pointers", () => {
  const omitted = { steps: [{ actionId: "review" }] };
  const explicitNull = { ...omitted, runContract: null };
  assert.deepEqual(panelFormSaveInputSchema.parse({ values: omitted }).values, omitted);

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
  for (const timeFormat of ["relative", "datetime", "date"] as const) {
    const timeColumn = { key: "createdAt", kind: "time" as const, timeFormat };
    assert.deepEqual(panelObjectListColumnSchema.parse(timeColumn), timeColumn);
  }
  assert.equal(panelObjectListColumnSchema.safeParse({ key: "createdAt", kind: "time", timeFormat: "iso" }).success, false);
  assert.equal(panelObjectListColumnSchema.safeParse({ ...ownerField, label: "Status" }).success, false);
  assert.equal(panelObjectListColumnSchema.safeParse({ ...panelColumn, empty: "No notes" }).success, false);
});

test("panel record and snapshot reads do not accept entry skill context", () => {
  assert.equal(productPanelSnapshotQuerySchema, productPanelReadQuerySchema);
  const use = { applicationId: "ontology", useId: "ontology-agent-settings" };
  const pageKey = "agent-settings";
  const menu = { ...use, pageKey, permissionCode: "analysis-agent" };
  const member = { ...use, pageKey, access: "domain-member" };
  const frame = { ...use, source: "frame" };
  for (const query of [{}, frame]) assert.deepEqual(productPanelReadQuerySchema.parse(query), query);
  for (const query of [
    use, menu, member, { pageKey }, { ...use, pageKey }, { ...menu, useId: undefined }, { ...menu, access: member.access },
    { source: "frame" }, { ...frame, useId: undefined }, { ...menu, source: "frame" },
  ]) {
    assert.equal(productPanelReadQuerySchema.safeParse(query).success, false);
  }
});

test("an opening carries the admitted entry and page skill separately from the panel record", async () => {
  const { applicationEntryResolutionSchema } = await import("./product-panels");
  const panel = {
    id: "agent-settings", domainId: "domain", ownerId: "owner", revision: 1,
    createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", editable: false,
    name: "Agent settings", description: "", visibility: "domain",
    content: { html: "<main></main>", module: "export {}" },
    manifest: { members: {}, state: {} },
  };
  const pageSkillContext = {
    mode: "member",
    locator: { applicationId: "ontology", entryKey: "ontology-agent-settings", pageKey: "agent-settings" },
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
    manifest: { state: {}, members: { tasks: { target: { projectionId: "task-list" } } } },
  };
  assert.deepEqual(productPanelResponseSchema.parse({ panel: directPanel }), { panel: directPanel });
  assert.deepEqual(productPanelResponseSchema.parse({ panel }), { panel });
  assert.equal(productPanelResponseSchema.safeParse({ panel, pageSkillContext }).success, false);
  const resolution = { applicationId: "ontology",
    use: { id: "ontology-agent-settings", panelId: panel.id, pageKey: "agent-settings",
      path: "/ontology/agents" },
    menu: { singleEntry: true, panelUses: [], groups: [] } };
  assert.deepEqual(applicationEntryResolutionSchema.parse({ ...resolution, pageSkillContext }).pageSkillContext, pageSkillContext);
  const unavailable = { ...pageSkillContext, entry: pageSkillContext.member.source, member: null };
  assert.deepEqual(applicationEntryResolutionSchema.parse({ ...resolution, pageSkillContext: unavailable }).pageSkillContext, unavailable);
  assert.equal(applicationEntryResolutionSchema.safeParse({ ...resolution, pageSkillContext: { ...pageSkillContext, member: {} } }).success, false);
});

test("panel definition snapshots do not carry entry skill context", () => {
  const snapshot = {
    panel: { id: "agent-settings", revision: 1 },
    projections: [{ id: "definition-form", revision: 2 }],
  };
  const pageSkillContext = {
    mode: "member",
    locator: { applicationId: "agents", entryKey: "agents-agent-settings", pageKey: "agents-agent-settings" },
    member: null,
  };
  assert.deepEqual(panelDefinitionSnapshotSchema.parse(snapshot), snapshot);
  assert.equal(panelDefinitionSnapshotSchema.safeParse({ ...snapshot, pageSkillContext }).success, false);
});

test("a graph has two admitted sources and can use either a form field or separate selection outputs", () => {
  const projection = productProjectionInputSchema.parse({
    name: "Ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:RecordGraph",
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
    state: {},
    members: {
      definition: { target: { projectionId: "definition-form" } },
      range: { target: { projectionId: "data-scope" } },
    },
  });
  assert.equal(range.members.range?.target && "projectionId" in range.members.range.target ? range.members.range.target.projectionId : undefined, "data-scope");
  const state = { node: { type: { kind: "object", objectType: OBJECT_TYPE } }, edge: { type: { kind: "object", objectType: RELATIONSHIP } } };
  const outputs = { selectedNode: { state: "node" }, selectedEdge: { state: "edge" } };
  const graph = { members: { graph: { target: { projectionId: "ontology-model" }, outputs } } };
  assert.deepEqual(panelManifestSchema.parse({ ...graph, state }).members.graph?.outputs, outputs);
  assert.equal(panelManifestSchema.safeParse({ ...graph, state: { node: state.node } }).success, false);
});

test("a named relationship is a binding identity and supplies no inferred edge selection type", () => {
  const relationship = { kind: "Relationship", id: "manages" };
  const projection = productProjectionInputSchema.parse({
    name: "Ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:InstanceGraph",
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

test("candidate source needs only workspace identity, content and build-test context", () => {
  const candidate = {
    kind: "candidate",
    workspace: { id: "5931a639-a70d-4dae-96db-6b8a4460d228", ref: "a".repeat(40) },
    panel: { content: { html: "", module: "" }, manifest: { state: {}, members: {} } },
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
  assert.ok(clientSends([binding(EXTERNAL_MCP_SERVICE)], "GET", "", "/mcp/services/names"));
  assert.ok(!clientSends([binding(EXTERNAL_MCP_SERVICE)], "GET", "", "/mcp/services"));
  for (const type of [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP])
    assert.ok(clientSends([binding(type)], "POST", "/data-query", "/admin/getMetas"));
  assert.ok(!clientSends([binding(OBJECT_TYPE)], "POST", "/data-query", "/admin/getschemamarkdown"));
  assert.ok(clientSends([binding(USER)], "GET", "/data-query", "/platform/agent-execution/options?selected=u"));
});

test("Action definition reads and writes use distinct exact binding requests", () => {
  const definitions = binding(ACTION);
  const trial = bindingKey({ kind: "PlatformOperation", id: TRIAL_ACTION });
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
  assert.ok(clientSends([trial], "POST", "/data-query", "/action/trial", { id: "example" }));
  assert.ok(!clientSends([definitions], "POST", "/data-query", "/action/trial"));
  assert.ok(!clientSends([trial], "GET", "/data-query", "/action/trial"));
  assert.ok(platformObjectTypes[ACTION].operations?.includes(TRIAL_ACTION));
});

test("Trigger definition reads and writes use exact binding requests", () => {
  const definitions = binding(TRIGGER);
  const deletion = bindingKey({ kind: "PlatformOperation", id: DELETE_TRIGGER });
  const status = bindingKey({ kind: "PlatformOperation", id: SET_TRIGGER_STATUS });
  for (const path of ["/trigger/queryList", "/trigger/queryById", "/trigger/form"]) {
    assert.ok(panelClientReads(definitions).some(read => read.method === "POST" && read.service === "/data-query" && read.path.test(path)));
    assert.ok(clientSends([definitions], "POST", "/data-query", path));
  }
  assert.ok(clientSends([definitions], "POST", "/data-query", "/trigger/save"));
  assert.ok(!panelClientReads(definitions).some(read => read.path.test("/trigger/save")));
  assert.ok(!clientSends([definitions], "POST", "/data-query", "/trigger/delete"));
  assert.ok(clientSends([deletion], "POST", "/data-query", "/trigger/delete", { id: "tr-1" }));
  assert.ok(clientSends([status], "POST", "/data-query", "/trigger/status", { id: "tr-1", status: "PUBLISHED" }));
  assert.ok(!clientSends([status], "POST", "", "/trigger/status"));
  assert.equal(platformObjectTypes[TRIGGER].reads?.count.result, "panelRecordQuery");
  assert.equal(platformObjectTypes[TRIGGER].reads?.armedCount.result, "panelRecordQuery");
  assert.deepEqual(platformObjectTypes[TRIGGER].operations, [`${TRIGGER}.save`, SET_TRIGGER_STATUS, DELETE_TRIGGER]);
});

test("Workflow definition reads and writes use exact binding requests", () => {
  const workflows = binding(WORKFLOW);
  const reads = platformObjectTypes[WORKFLOW].reads;
  assert.ok(reads);
  for (const path of ["/workflow/query", "/workflow/grants", "/workflow/subjects", "/action/queryList"]) {
    assert.ok(panelClientReads(workflows).some(read => read.method === "POST" && read.service === "/data-query" && read.path.test(path)));
    assert.ok(clientSends([workflows], "POST", "/data-query", path));
  }
  assert.ok(clientSends([workflows], "POST", "/data-query", "/workflow/save"));
  assert.ok(!panelClientReads(workflows).some(read => read.path.test("/workflow/save")));
  assert.equal(reads.list.result, "panelRecordList");
  assert.equal(reads.query.parameterMode, "fixed");
  assert.deepEqual(reads.query.params, { search: "keyword", cursor: "cursor", size: "size" });
  assert.equal(reads.count.result, "panelRecordQuery");
  assert.equal(reads.record.result, "panelRecord");
  assert.equal(reads.form.result, "panelFormDescription");
  assert.equal(reads.createForm.result, "panelFormDescription");
  for (const name of ["grantCaseScopedSteps", "grantInForce", "grantSuperseded", "grantDirect"] as const) {
    assert.equal(reads[name].source, "object");
    assert.equal(reads[name].result, "panelRecordList");
  }
  assert.deepEqual(platformObjectTypes[WORKFLOW].operations, [`${WORKFLOW}.save`, ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW]);
  for (const [id, path] of [
    [ACTIVATE_WORKFLOW, "/workflow/activate"],
    [DEACTIVATE_WORKFLOW, "/workflow/deactivate"],
    [DELETE_WORKFLOW, "/workflow/delete"],
  ]) {
    const operation = bindingKey({ kind: "PlatformOperation", id });
    assert.ok(clientSends([operation], "POST", "/data-query", path));
    assert.ok(clientSends([operation], "POST", "", "/panel-operations/inspect-impact"));
    assert.ok(!clientSends([workflows], "POST", "/data-query", path));
  }
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

test("an upload declaration names a file input whose value is a staged upload, and the confirmation names the file", async () => {
  const {
    PANEL_UPLOAD_MAX_BYTES, panelFileInputSchema, panelUploadAccepted, panelUploadDeclarationSchema, panelUploadReceiptSchema,
  } = await import("./panel-upload");
  const { panelHumanOperationConfirmationSchema, panelUploadRequestSchema } = await import("./panel-agent");
  const declaration = { input: "file", accept: [{ mime: "application/zip", extension: ".zip" }], maxBytes: 20 * 1024 * 1024 };
  assert.deepEqual(panelUploadDeclarationSchema.parse(declaration), declaration);
  for (const invalid of [{ maxBytes: PANEL_UPLOAD_MAX_BYTES + 1 }, { accept: [] }, { accept: [{ mime: "application/zip", extension: "zip" }] }])
    assert.equal(panelUploadDeclarationSchema.safeParse({ ...declaration, ...invalid }).success, false);
  assert.equal(panelUploadAccepted(declaration, "Report.ZIP")?.mime, "application/zip");
  assert.equal(panelUploadAccepted(declaration, "report.zip.exe"), undefined);

  const uploadId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(panelFileInputSchema.parse({ kind: "upload", uploadId }), { kind: "upload", uploadId });
  // Only the staged branch exists; a bare id or another source is not a file input yet.
  assert.equal(panelFileInputSchema.safeParse({ uploadId }).success, false);
  assert.equal(panelFileInputSchema.safeParse({ kind: "artifact", uploadId }).success, false);
  const receipt = { uploadId, name: "技能.zip", size: 1024, mime: "application/zip" };
  assert.deepEqual(panelUploadReceiptSchema.parse(receipt), receipt);
  assert.equal(panelUploadReceiptSchema.safeParse({ ...receipt, name: "../x.zip" }).success, false);
  assert.equal(panelUploadReceiptSchema.safeParse({ ...receipt, size: 0 }).success, false);

  const operation = { applicationId: "skills", useId: "library", operationId: "list.import" };
  assert.deepEqual(panelUploadRequestSchema.parse({ operation }), { operation });
  const { uploadId: _id, ...file } = receipt;
  const confirmation = {
    kind: "impact", upload: file,
    impact: { summary: "Overwrites skill Alpha", total: 1, objects: [{ target: { objectType: "skill", primaryKey: "alpha" }, label: "Alpha" }] },
  };
  assert.deepEqual(panelHumanOperationConfirmationSchema.parse(confirmation), confirmation);
  assert.equal(panelHumanOperationConfirmationSchema.safeParse({ ...confirmation, upload: receipt }).success, false);
});

test("a read-only trial carries the current draft and parameters without a write intent", () => {
  const input = { draft: { query: { select: ["name"] } }, parameters: { limit: 3 } };
  const request = {
    applicationId: "ontology", useId: "metrics", operationId: "test.execute",
    call: { target: { kind: "draft" }, input },
  };
  assert.deepEqual(readPanelOperationRequestSchema.parse(request), request);
  const agentRequest = {
    ...request, agentRun: { runId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002", toolCallId: "read-1" },
  };
  assert.deepEqual(readPanelOperationRequestSchema.parse(agentRequest), agentRequest);
  assert.equal(readPanelOperationRequestSchema.safeParse({ ...request, agentRun: { runId: "run-1" } }).success, false);
  assert.equal(readPanelOperationRequestSchema.safeParse({ ...request, effect: "read" }).success, false);
  const owner = {
    handlerRef: "metricViews.testExecute", label: "Test", kind: "action", effect: "read", batch: false, target: { source: "draft", slot: "definition" },
    inputSchema: { type: "object" }, resultSchema: { type: "object" },
  };
  assert.deepEqual(panelReadOperationDescriptorSchema.parse(owner), owner);
  assert.equal(panelReadOperationDescriptorSchema.safeParse({ ...owner, effect: "write" }).success, false);
  for (const result of [
    { kind: "markdown", markdown: "Preview" },
    { kind: "json", value: [{ count: 1 }] },
    { kind: "json", value: [{ count: 1 }], truncation: { rowLimit: 20000, hint: "Narrow the range" } },
    { kind: "json", value: null, truncation: { rowLimit: null, hint: null } },
    {
      kind: "sections",
      defaultSectionId: "raw",
      sections: [
        {
          id: "table",
          label: "Records",
          emptyText: "No rows",
          kind: "records",
          columns: [{ key: "id", label: "ID" }, { key: "active", label: "Active" }],
          rows: [{ id: "r1", active: true }, { id: "r2", active: null }],
        },
        {
          id: "query",
          label: "Generated query",
          kind: "code",
          language: "javascript",
          content: "db.items.find({})",
        },
        {
          id: "raw",
          label: "Raw payload",
          kind: "json",
          value: { count: 2 },
          truncation: { rowLimit: 100, hint: null },
        },
      ],
    },
  ]) {
    assert.deepEqual(panelReadOperationResultSchema.parse(result), result);
    assert.deepEqual(readPanelOperationResponseSchema.parse(result), result);
    assert.equal(panelReadOperationResultSchema.safeParse({ ...result, affected: { objects: [] } }).success, false);
  }
  for (const invalidSectionResult of [
    { kind: "sections", sections: [] },
    { kind: "sections", defaultSectionId: "missing", sections: [{ id: "raw", label: "Raw", kind: "json", value: {} }] },
    { kind: "sections", sections: [{ id: "s1", label: "Table", kind: "records", columns: [], rows: [{ a: { nested: true } }] }] },
    { kind: "sections", sections: [{ id: "s1", label: "Code", kind: "code", language: "", content: "x" }] },
    { kind: "sections", sections: [{ id: "s1", label: "Unknown", kind: "html", content: "<div/>" }] },
    { kind: "sections", sections: [{ id: "s1", label: "Json", kind: "json", value: {}, extra: 1 }] },
    { kind: "sections", sections: [{ id: "s1", label: "Table", kind: "records", columns: [{ key: "a", label: "A", extra: 1 }], rows: [] }] },
  ]) {
    assert.equal(panelReadOperationResultSchema.safeParse(invalidSectionResult).success, false);
  }
  assert.equal(
    panelReadOperationResultSchema.safeParse({
      kind: "json", value: [], truncation: { rowLimit: 100, hint: null, extra: true },
    }).success,
    false,
  );
  assert.equal(
    panelReadOperationResultSchema.safeParse({
      kind: "markdown", markdown: "Preview", truncation: { rowLimit: 10, hint: null },
    }).success,
    false,
  );
});

test("the author type table and live descriptions share operation declarations", async () => {
  const { panelOperationDeclarationSchema, describePanelOperationFromDeclaration, panelReadResultSchemas } = await import("./panel-operations");
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const run = panelOperationDeclarationSchema.parse({
    id: RUN_NOW, kind: "action", effect: "write", batch: false, target: { source: "input", input: "task" }, inputSchema: { type: "object" },
  });
  const save = panelOperationDeclarationSchema.parse({
    id: SCHEDULED_TASK + ".save", kind: "form.save", effect: "write", batch: false, target: { source: "draft" }, inputSchema: { type: "object" },
  });
  const reads = platformObjectTypes[SCHEDULED_TASK].reads!;
  const resultIds = new Set(Object.values(reads).map(read => read.result));
  const resultSchemas = Object.fromEntries([...resultIds].map(id => [id, zodToJsonSchema(panelReadResultSchemas[id])]));
  const table = { objectTypes: { [SCHEDULED_TASK]: { reads, operations: [run, save] } }, resultSchemas };
  assert.deepEqual(platformTypeTableResponseSchema.parse(table), table);
  const { panelFormDescription: _form, ...incomplete } = resultSchemas;
  assert.equal(platformTypeTableResponseSchema.safeParse({ ...table, resultSchemas: incomplete }).success, false);
  assert.equal(panelOperationDeclarationSchema.safeParse({ ...run, label: "Run now" }).success, false);

  const { id, ...staticFields } = run;
  assert.deepEqual(describePanelOperationFromDeclaration(run, { label: "Run now", resultSchema: {} }), {
    handlerRef: id, ...staticFields, label: "Run now", resultSchema: {},
  });
  assert.deepEqual(describePanelOperationFromDeclaration(save, { label: "Save", resultSchema: {}, slot: "form" }).target,
    { source: "draft", slot: "form" });
});


test("live operation availability preserves the owner's reason without putting it in a write snapshot", async () => {
  const { describePanelOperationFromDeclaration, panelOperationDeclarationSchema } = await import("./panel-operations");
  const { productPanelOperationsReadResponseSchema } = await import("./panel-host");
  const declaration = panelOperationDeclarationSchema.parse({
    id: DELETE_FUNCTION, kind: "action", effect: "write", batch: false,
    target: { source: "input", input: "function" }, inputSchema: {},
  });
  const unavailable = { reason: "被动作引用的函数不能删除。" };
  const described = describePanelOperationFromDeclaration(declaration, { label: "删除", resultSchema: {}, unavailable });
  const reply = { status: "ready", value: { remove: described } };
  assert.deepEqual(productPanelOperationsReadResponseSchema.parse(reply), reply);
  for (const invalid of [{ reason: "" }, { reason: "x".repeat(501) }, { ...unavailable, readonly: true }]) {
    assert.equal(productPanelOperationsReadResponseSchema.safeParse({
      status: "ready", value: { remove: { ...described, unavailable: invalid } },
    }).success, false);
  }

  const manifest = panelManifestSchema.parse({
    state: { selected: { type: { kind: "object", objectType: FUNCTION } } },
    members: { remove: { target: { projectionId: "delete-function" }, inputs: { function: { state: "selected" } } } },
  });
  const placed = projectionOperation(manifest, "remove", "delete", described);
  assert.deepEqual(panelOperationSchema.parse(placed).unavailable, unavailable);

  const { unavailable: _display, ...snapshot } = described;
  assert.equal(panelWriteOperationSnapshotSchema.safeParse({ ...snapshot, id: placed.id, slot: "remove" }).success, true);
  assert.equal(panelWriteOperationSnapshotSchema.safeParse({ ...described, id: placed.id, slot: "remove" }).success, false);
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

test("knowledge, feedback and skill reads stay at their declared owners", () => {
  for (const [resource, method, service, path] of [
    [BUSINESS_KNOWLEDGE, "POST", "/data-query", "/admin/getBussinessKnowledge"],
    [BUSINESS_KNOWLEDGE, "POST", "/data-query", "/admin/bussinessKnowledge/form"],
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
    [EXPORT_SKILL, "GET", "", "/skills/skill/export"],
    [EXPORT_SKILL, "POST", "", "/panel-operations/read"],
    [EXPORT_FEEDBACK, "GET", "", "/feedback/export?keyword=sample"],
    [EXPORT_FEEDBACK, "POST", "", "/panel-operations/read"],
  ] as const) {
    const key = bindingKey({ kind: "PlatformOperation", id: operation });
    assert.ok(clientSends([key], method, service, path));
    assert.ok(!panelClientReads(key).some(read => read.path.test(path)));
  }

  // An import stages its file through the panel upload contract; a frame never posts to the old route.
  const importBinding = bindingKey({ kind: "PlatformOperation", id: IMPORT_SKILL });
  assert.ok(!clientSends([importBinding], "POST", "", "/skills/import"));
  assert.ok(clientSends([importBinding], "POST", "", "/panel-operations/uploads"));
  assert.ok(!clientSends([binding(SKILL)], "POST", "", "/panel-operations/uploads"));
  assert.ok(!clientSends([binding(SKILL)], "GET", "", "/skills/skill/export"));
  assert.ok(!clientSends([binding(FEEDBACK_RECORD)], "GET", "", "/feedback/export"));
  assert.ok(!clientSends([binding(FEEDBACK_RECORD)], "GET", "", "/feedback/state"));
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
  // Custom/domain child-object types are accepted without requiring a platform-only allowlist.
  assert.equal(panelStateFieldSchema.safeParse({ type: { kind: "child-object", parentType: "Order", collection: "lineItems" } }).success, true);

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

test("typed list state supports both object collections and string arrays, including deep-link state", () => {
  const field = { kind: "list", items: { kind: "object", objectType: METRIC_VIEW } };
  const stringList = { kind: "list", items: { kind: "scalar", type: "string" } };
  const refs = [{ className: METRIC_VIEW, primaryKey: "metric-a" }, { className: METRIC_VIEW, primaryKey: "metric-b" }];
  const state = { checked: refs };
  assert.deepEqual(panelStateFieldSchema.parse({ type: field }), { type: field, deepLink: false, personal: false, external: false });
  assert.equal(panelStateFieldSchema.safeParse({ type: field, deepLink: true }).success, true);
  assert.equal(panelStateFieldSchema.safeParse({ type: stringList, deepLink: true, default: ["a", "b"] }).success, true);
  assert.deepEqual(ontologyParameterTypeSchema.parse(field), field);
  assert.equal(singleOntologyParameterTypeSchema.safeParse(field).success, false);
  assert.deepEqual(panelStateValueSchema.parse(refs), refs);
  assert.deepEqual(panelStateValueSchema.parse([]), []);
  assert.deepEqual(panelStateOperationSchema.parse({ id: "clear", labelKey: "selection.clear", kind: "state", sets: { checked: [] } }).sets, { checked: [] });
  assert.deepEqual(panelOpenRequestSchema.parse({ useId: "metrics", state }).state, state);
});

test("mixed graphs declare selected node types separately from the read bindings", () => {
  const nodeIdentity = { kind: "object-union", layers: [...platformOntologyLayers], objectTypes: [ONTOLOGY_TYPE] };
  const projection = productProjectionInputSchema.parse({
    name: "Platform ontology graph", description: "", visibility: "domain", componentId: "@ontomato/sdk:InstanceGraph",
    inputs: { start: nodeIdentity }, outputs: { selectedNode: nodeIdentity }, config: {},
    data: { neighbors: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "neighbors", params: { node: { input: "start" } } } },
  });
  assert.deepEqual(projectionPorts(projection).outputs?.selectedNode, nodeIdentity);
  assert.deepEqual(projection.inputs.start, nodeIdentity);
  const manifest = panelManifestSchema.parse({
    state: { selected: { type: nodeIdentity } },
    members: { graph: { target: { projectionId: "mixed" }, outputs: { selectedNode: { state: "selected" } } } },
  });
  assert.deepEqual(manifest.state.selected, { type: nodeIdentity, deepLink: false, personal: false, external: false });
  const user = panelStateValueSchema.parse({ className: ONTOLOGY_USER, primaryKey: "shared-key" });
  const definition = panelStateValueSchema.parse({ className: DEFINITION, primaryKey: "shared-key" });
  assert.notDeepEqual(user, definition);
});

test("generic json state replaces legacy node-positions and supports personal layouts and structured state", async () => {
  const { matchesDirectPanelValue, panelPortAccepts } = await import("./panel-manifest");
  const { directProjectionInputAccepts } = await import("./panel-projection");
  const type = { kind: "json" } as const;
  const layout = { "class:Employee": { x: -120.5, y: 0 } };
  const field = { type, personal: true, default: layout };
  assert.deepEqual(panelStateValueSchema.parse(layout), layout);
  assert.equal(panelStateFieldSchema.safeParse(field).success, true);
  assert.equal(panelStateFieldSchema.safeParse({ ...field, personal: false }).success, true);
  assert.equal(panelStateFieldSchema.safeParse({ type: { kind: "node-positions" }, personal: true }).success, false);
  assert.equal(matchesDirectPanelValue(type, null), true);
  assert.equal(matchesDirectPanelValue(type, layout), true);
  assert.equal(panelPortAccepts(type, type), true);
  assert.equal(directProjectionInputAccepts({ kind: "json" }, type), true);
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

test("object union contracts require a non-empty selector, allow domain types, and reject unknown layers", () => {
  assert.equal(ontologyObjectUnionTypeSchema.safeParse({ kind: "object-union", objectTypes: [DEFINITION, "CustomerOrder"] }).success, true);
  for (const selector of [
    { layers: ["unclassified"] },
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

test("platform ontology catalogues publish standard list, record and required detail reads to the type table", () => {
  const typeReads = platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[ONTOLOGY_TYPE].reads }).reads!;
  const relationReads = platformTypeTableEntrySchema.parse({ reads: platformObjectTypes[ONTOLOGY_RELATION_KIND].reads }).reads!;
  for (const list of [typeReads.list, relationReads.list]) {
    assert.deepEqual(list, { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" });
  }
  assert.deepEqual(typeReads.record, {
    source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
    outputs: {
      directoryPath: { kind: "scalar", type: "string" },
      directoryName: { kind: "scalar", type: "string" },
    },
  });
  for (const name of ["properties", "reads", "operations"]) {
    assert.deepEqual(typeReads[name], {
      source: "type", parameterMode: "fixed", params: { type: "ontologyType" },
      requiredParams: ["type"], result: "panelRecordList",
    });
  }
  // A type's relations are the expanded edges, one row per target rather than per relation kind.
  assert.deepEqual(typeReads.typeRelations, {
    source: "type", parameterMode: "fixed", params: { type: "ontologyType" },
    requiredParams: ["type"], result: "panelRecordList", rowType: ONTOLOGY_RELATION_KIND,
  });
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
  assert.deepEqual(platformOntologySchemaResponseSchema.parse(response), response);
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
    assert.ok(platformRelationGroups.includes(relation.group), relation.id);
  }
  assert.equal(platformRelationKinds.find(relation => relation.id === "panel.contains-panel")?.derived, false);
  assert.equal(platformRelationKinds.find(relation => relation.id === "panel.provides-skill")?.derived, true);
  assert.equal(platformRelationKinds.find(relation => relation.id === "role.owns-workflow-step")?.derived, true);
  assert.equal(platformObjectTypes[APPLICATION_PANEL_USE]?.layer, undefined);
  assert.equal(platformObjectTypes[ORG_MEMBERSHIP]?.layer, undefined);
  assert.equal(platformObjectTypes[ORG_UNIT]?.layer, "fact");
  assert.equal(platformObjectTypes[ORG_POSITION]?.layer, "fact");
  assert.equal(platformObjectTypes[PERMISSION_POLICY]?.layer, "governance");
  assert.equal(platformObjectTypes[ORG_GRANT]?.layer, "governance");
  for (const id of [
    "org-unit.has-child",
    "org-unit.has-position",
    "user.member-of-org-unit",
    "user.holds-org-position",
    "org-grant.applies-to-org-unit",
    "org-grant.applies-to-org-position",
    "org-grant.grants-role",
    "role.uses-permission-policy",
    "permission-policy.governs-object-type",
    "permission-policy.can-enter-application",
    "permission-policy.can-execute-action",
    "permission-policy.can-use-object",
  ]) {
    assert.equal(platformRelationKinds.find(relation => relation.id === id)?.derived, false, id);
  }
  /** The type graph draws one sentence instead of a kind's target edges; instance reads keep the declaration. */
  assert.equal(platformRelationKinds.find(relation => relation.id === "projection.binds-target")?.typeEdges, false);
  assert.deepEqual(
    platformRelationKinds.filter(relation => relation.typeEdges === false).map(relation => relation.id),
    ["projection.binds-target"],
  );
  assert.deepEqual(
    [...new Set(platformRelationKinds.map(relation => relation.group))].sort(),
    [...platformRelationGroups].sort(),
  );
  assert.equal(
    platformRelationKinds.some(relation => relation.from === ORG_UNIT && (relation.to === ROLE || (Array.isArray(relation.to) && relation.to.includes(ROLE)))),
    false,
  );

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
  const batch = { ...use, calls };
  assert.deepEqual(createPanelHumanOperationIntentRequestSchema.parse(batch), batch);
  assert.deepEqual(inspectPanelOperationImpactRequestSchema.parse({ ...use, calls }), { ...use, calls });
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({ ...batch, call }).success, false);
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({
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

test("batch receipts accept owner-unavailable items with or without successful writes", () => {
  const skipped = {
    target: { ...operationTarget, primaryKey: "already-approved" },
    outcome: { kind: "skipped", reason: "Already approved", code: "ALREADY_APPROVED" },
  };
  const allSkipped = { kind: "batch", items: [skipped] };
  const affected = { objects: [operationTarget], objectTypes: [operationTarget.objectType] };
  const mixed = {
    kind: "batch",
    items: [skipped, { target: operationTarget, outcome: { kind: "success", data: {}, affected } }],
    affected,
  };
  for (const batch of [allSkipped, mixed]) {
    const parsed = panelOperationOutcomeSchema.parse(batch);
    assert.deepEqual(parsed, batch);
    const classified = classifyPanelOperationOutcome(parsed);
    assert.equal(classified.kind, "executed");
    assert.match(classified.summary, /1 skipped/u);
  }
  assert.equal(panelOperationOutcomeSchema.safeParse({ ...allSkipped, affected }).success, false);
  assert.equal(panelOperationOutcomeSchema.safeParse(skipped.outcome).success, false);
  assert.equal(panelOperationOutcomeSchema.safeParse({
    ...allSkipped, items: [{ ...skipped, outcome: { kind: "skipped", reason: "" } }],
  }).success, false);
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
  for (const forged of [{ confirmed: true }, { questionId: operationIntentId }, { call }]) {
    assert.equal(dispatchPanelHumanOperationIntentRequestSchema.safeParse(forged).success, false);
  }
  const reply = { kind: "dispatched", intentId: operationIntentId, outcome: { kind: "unknown", message: "No receipt" } };
  assert.deepEqual(panelHumanOperationDispatchResponseSchema.parse(reply), reply);
});

test("application uses and page-skill defaults share the explicit agent target", () => {
  const use = { id: "governance", pageKey: "report", panelId: "reports", path: "/governance/reports" };
  const preset = { kind: "preset", agentKind: "knowledge-governance" };
  const concrete = { kind: "id", id: "saved-agent" };
  assert.deepEqual(applicationPanelUseSchema.parse({ ...use, defaultAgent: concrete }).defaultAgent, concrete);
  assert.equal(applicationPanelUseSchema.safeParse({ ...use, defaultAgentId: "saved-agent" }).success, false);
  const mapping = {
    entryKey: use.id,
    pageKey: use.pageKey,
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

test("page candidate directories can identify the offered agents by preset", async () => {
  const { assistantAgentListSchema } = await import("./assistant-chat");
  const id = "7bec96be-2b73-4fe5-b0e1-9c4e12ed2697";
  const agents = [{ id, name: "Knowledge governance", description: "", icon: null, enabled: true }];
  const directory = { agents, presetAgentIds: { "knowledge-governance": id } };
  assert.deepEqual(assistantAgentListSchema.parse(directory), directory);
  assert.deepEqual(assistantAgentListSchema.parse({ agents }), { agents });
  assert.equal(assistantAgentListSchema.safeParse({ agents, presetAgentIds: { "": id } }).success, false);
  assert.equal(assistantAgentListSchema.safeParse({ agents, presetAgentIds: { regular: "not-an-id" } }).success, false);
});

test("a state placement selects a product's kind and carries the complete nested operation path", async () => {
  const { panelManifestSchema, panelMemberPathSchema, panelOperationId } = await import("./panel-manifest");
  const { productPanelNestedReadRequestSchema, productPanelNestedReadResponseSchema } = await import("./panel-host");
  const { pageContextSchema } = await import("./page-context");
  const selected = { type: { kind: "object", objectType: "platform:ProductProjection" } };
  const manifest = (candidates: object, state = selected) => ({
    state: { selected: state }, members: { detail: { target: { fromState: "selected", candidates } } },
  });
  assert.equal(panelManifestSchema.safeParse(manifest({ projectionIds: ["approve-card"] })).success, true);
  assert.equal(panelManifestSchema.safeParse(manifest({ rule: "usable" })).success, true);
  assert.equal(panelManifestSchema.safeParse(manifest({ panelIds: ["approve-card"] })).success, false);
  assert.equal(panelManifestSchema.safeParse(manifest({ rule: "catalogSelection" })).success, false);
  const panelState = { type: { kind: "object", objectType: "platform:ProductPanel" } };
  assert.equal(panelManifestSchema.safeParse(manifest({ panelIds: ["detail-panel"] }, panelState)).success, true);
  assert.equal(panelManifestSchema.safeParse(manifest({ rule: "usable" }, panelState)).success, true);

  const memberPath = [
    { member: "detail", selection: {
      stateValue: { className: "platform:ProductPanel", primaryKey: "detail-panel" }, target: { panelId: "detail-panel" },
    } },
    { member: "approve", selection: {
      stateValue: { className: "platform:ProductProjection", primaryKey: "approve-card" }, target: { projectionId: "approve-card" },
    } },
  ];
  assert.deepEqual(panelMemberPathSchema.parse(memberPath), memberPath);
  const operationId = panelOperationId(memberPath.map(({ member }) => member), "run");
  assert.equal(operationId, "detail.approve.run");
  const use = { applicationId: "app-example", useId: "home" };
  assert.deepEqual(panelOperationRefSchema.parse({ ...use, operationId, memberPath }), { ...use, operationId, memberPath });
  const nestedRequest = { source: { kind: "registered", ...use }, memberPath: [memberPath[0]] };
  assert.deepEqual(productPanelNestedReadRequestSchema.parse(nestedRequest), nestedRequest);
  assert.equal(productPanelNestedReadRequestSchema.safeParse({ ...nestedRequest, memberPath: [] }).success, false);
  const unresolvedDetail = {
    member: "objectDetails",
    selection: { stateValue: { className: "platform:ScheduledTask", primaryKey: "task-1" } },
  };
  const unresolved = { ...nestedRequest, memberPath: [memberPath[0], unresolvedDetail] };
  assert.deepEqual(productPanelNestedReadRequestSchema.parse(unresolved), unresolved);
  for (const invalidPath of [
    [unresolvedDetail, memberPath[0]],
    [{ ...unresolvedDetail, selection: { stateValue: "task-1" } }],
  ]) {
    assert.equal(productPanelNestedReadRequestSchema.safeParse({ ...nestedRequest, memberPath: invalidPath }).success, false);
  }
  const { productPanelReadRequestSchema } = await import("./panel-host");
  assert.equal(productPanelReadRequestSchema.safeParse({ ...unresolved, dataName: "record", inputs: {} }).success, false);
  assert.equal(panelOperationRefSchema.safeParse({ ...use, operationId, memberPath: unresolved.memberPath }).success, false);
  const nested = {
    panel: {
      id: "detail-panel", revision: 1, content: { html: "", module: "" },
      manifest: { state: {}, members: {} },
    },
  };
  assert.deepEqual(productPanelNestedReadResponseSchema.parse(nested), nested);
  const context = {
    label: "Example", url: "/home", selection: [{
      kind: "platform:ProductPanel", id: "detail-panel", label: "Selected panel", memberPath: [memberPath[0]],
    }],
  };
  assert.deepEqual(pageContextSchema.parse(context), context);
  const withHighlights = {
    ...context,
    highlights: [
      {
        kind: "search" as const,
        summary: "Search matches (1): Person",
        items: [{ kind: "platform:ObjectType", id: "person", label: "Person" }],
      },
      {
        kind: "path" as const,
        summary: "Path from Person to Organization (1 hop): Person → Organization",
        from: { kind: "platform:ObjectType", id: "person", label: "Person" },
        to: { kind: "platform:ObjectType", id: "org", label: "Organization" },
        found: true,
        hops: 1,
        nodes: [
          { kind: "platform:ObjectType", id: "person", label: "Person" },
          { kind: "platform:ObjectType", id: "org", label: "Organization" },
        ],
        edges: [{ kind: "platform:Relationship", id: "works-in", label: "Works in" }],
      },
    ],
  };
  assert.deepEqual(pageContextSchema.parse(withHighlights), withHighlights);
});

test("only the host can send frame activity messages", () => {
  assert.deepEqual(panelHostFrameMessageSchema.parse({ kind: "activity", active: false }), { kind: "activity", active: false });
  assert.equal(panelFrameMessageSchema.safeParse({ kind: "activity", active: true }).success, false);
});
test("the direct panel import policy accepts only the host's literal module names", async () => {
  const imports = await panelModuleImports(`
    import { ref } from "vue";
    export { mountPanel } from "@ontomato/sdk/panel";
    await import("vue");
    import.meta.url;
  `);
  assert.deepEqual(imports.map(({ specifier, dynamic }) => [specifier, dynamic]), [
    ["vue", false], ["@ontomato/sdk/panel", false], ["vue", true],
  ]);
  await assert.rejects(panelModuleImports('import { ElButton } from "element-plus";'), /imports element-plus/);
  await assert.rejects(panelModuleImports('export { mountPanel } from "./panel-tools.mjs";'), /imports \.\/panel-tools\.mjs/);
  await assert.rejects(panelModuleImports('await import("element-plus");'), /imports element-plus/);
  await assert.rejects(panelModuleImports('await import(moduleName);'), /imports a computed module/);
});

test("a conversation entry names its opening sentence by a key of the panel's messages, or writes it out, not both", async () => {
  const { panelConversationEntrySchema, missingEntryMessageKeys } = await import("./panel-conversation-entry");
  const target = { kind: "page-default" as const };
  assert.deepEqual(panelConversationEntrySchema.parse({ target, prefillKey: "actions.create" }), { target, prefillKey: "actions.create" });
  assert.equal(panelConversationEntrySchema.safeParse({ target, prefill: "Help me", prefillKey: "actions.create" }).success, false);
  const messages = { en: { "actions.create": "Help me create an action:" }, "zh-CN": {} };
  assert.deepEqual(missingEntryMessageKeys([{ target, prefillKey: "actions.create" }, { target, prefill: "Written" }, undefined], messages),
    [{ key: "actions.create", locale: "zh-CN" }]);
  assert.deepEqual(missingEntryMessageKeys([{ target, prefillKey: "actions.create" }], undefined), [{ key: "actions.create", locale: null }]);
  // A name every object inherits is no key of the panel's.
  assert.deepEqual(missingEntryMessageKeys([{ target, prefillKey: "toString" }], { en: {} }), [{ key: "toString", locale: "en" }]);
  // A frame's request to open the composer carries the sentence written out, as it always did.
  const { appBridgeExpandPageComposerSchema } = await import("./app-bridge");
  assert.equal(appBridgeExpandPageComposerSchema.safeParse({ slot: "entry", target, prefill: "Help me" }).success, true);
  assert.equal(appBridgeExpandPageComposerSchema.safeParse({ slot: "entry", target, prefillKey: "actions.create" }).success, false);
});

test("a component package declares a static release and inspection returns the installation shape", async () => {
  const module = "@acme/widgets/base";
  const manifest = {
    name: "@acme/widgets", version: "1.2.0", author: { name: "Acme" },
    ontomato: { components: "components.json", entries: { [module]: "dist/base.mjs" }, styles: ["dist/style.css"] },
  };
  assert.deepEqual(componentPackageManifestSchema.parse({ ...manifest, scripts: { postinstall: "anything" } }), manifest);
  for (const ontomato of [
    { ...manifest.ontomato, tokens: "tokens.json" },
    { ...manifest.ontomato, components: "../components.json" },
    { ...manifest.ontomato, entries: { "@other/widgets": "dist/base.mjs" } },
    { ...manifest.ontomato, entries: { "@acme/widgets/../base": "dist/base.mjs" } },
  ]) assert.equal(componentPackageManifestSchema.safeParse({ ...manifest, ontomato }).success, false);

  const bytes = new Uint8Array([1, 2]);
  assert.deepEqual(componentPackageInstallRequestSchema.parse({ mode: "inspect", archive: bytes }), { mode: "inspect", archive: bytes });
  const files = [{ path: "dist/base.mjs", bytes }];
  assert.deepEqual(componentPackageInstallRequestSchema.parse({ mode: "install", files }), { mode: "install", files });
  assert.equal(componentPackageInstallRequestSchema.safeParse({ mode: "install", archive: bytes, files }).success, false);
  assert.equal(componentPackageInstallRequestSchema.safeParse({ mode: "install", files: [{ path: "/dist/base.mjs", bytes }] }).success, false);

  const current = {
    name: manifest.name, version: manifest.version, author: manifest.author, digest: "a".repeat(64),
    artifactRoot: "/deployment/apps-sdk/component-packages/%40acme%2Fwidgets/" + "a".repeat(64) + "/",
  };
  assert.deepEqual(currentComponentPackageSchema.parse(current), current);
  const component = {
    componentId: "@acme/widgets:SaveButton", module, exportName: "SaveButton", role: "control", meaning: "Shows a save button",
    ports: { props: [], events: [], slots: [] }, data: {},
    operations: [{ name: "save", handlerRef: "platform:ScheduledTask.save" }],
  };
  const response = { ...current, entries: manifest.ontomato.entries, styles: manifest.ontomato.styles, components: [component] };
  assert.deepEqual(componentPackageResponseSchema.parse(response), response);
  assert.equal(componentPackageInstallResponseSchema, componentPackageResponseSchema);
  for (const invalid of [
    { ...response, components: [{ ...component, componentId: "@other/widgets:SaveButton" }] },
    { ...response, components: [{ ...component, module: "@acme/widgets/missing" }] },
    { ...response, components: [component, component] },
    { ...response, artifactRoot: "//other.example/widgets/" },
  ]) assert.equal(componentPackageResponseSchema.safeParse(invalid).success, false);

  const { imports, exports } = await readModuleFacts('export { SaveButton } from "./chunks/save.mjs";', "dist/base.mjs");
  assert.equal(imports[0]?.specifier, "./chunks/save.mjs");
  assert.equal(exports[0]?.type, "reexport");
  if (exports[0]?.type === "reexport") assert.equal(exports[0].name, component.exportName);
});

test("a refused component package upgrade reports the changed shape and its affected records", () => {
  const change = {
    component: "@acme/widgets:SaveButton", field: "inputs.task",
    before: { kind: "object", objectType: SCHEDULED_TASK },
    projectionIds: ["save-task"], panelIds: ["manage-tasks"],
    projections: [{ id: "save-task", domainId: "domain" }], panels: [{ id: "manage-tasks", domainId: "domain" }],
  };
  const response = {
    success: false, error: "The task input is still in use", code: COMPONENT_PACKAGE_INCOMPATIBLE,
    details: { package: "@acme/widgets", scope: "deployment", changes: [change] },
  };
  assert.deepEqual(componentPackageUpgradeErrorSchema.parse(response), response);
  assert.equal(componentPackageUpgradeErrorSchema.safeParse({
    ...response, details: { ...response.details, changes: [{ ...change, after: new Date() }] },
  }).success, false);
});

test("removed listColumn, listRowDetail, formField, and row input syntax are rejected by panelManifestSchema", async () => {
  const { panelTemplatePlacedMemberKeys } = await import("./panel-manifest");
  const baseState = {
    filter: { type: { kind: "scalar" as const, type: "string" as const } },
    selected: { type: { kind: "object" as const, objectType: SCHEDULED_TASK } },
  };
  const cleanManifest = panelManifestSchema.parse({
    state: baseState,
    members: {
      list: { target: { projectionId: "tasks-list" } },
      form: { target: { projectionId: "task-form" } },
    },
  });
  assert.deepEqual(panelTemplatePlacedMemberKeys(cleanManifest), ["list", "form"]);

  for (const invalidMember of [
    { target: { projectionId: "p" }, formField: { slot: "form", path: "/a" } },
    { target: { projectionId: "p" }, listColumn: { slot: "list", column: "a" } },
    { target: { projectionId: "p" }, listRowDetail: { slot: "list" } },
    { target: { projectionId: "p" }, inputs: { row: { item: true } } },
    { target: { projectionId: "p" }, inputs: { id: { item: "primaryKey" } } },
    { target: { projectionId: "p" }, inputs: { tools: { itemField: "tools" } } },
  ]) {
    assert.equal(panelManifestSchema.safeParse({
      state: baseState,
      members: {
        list: { target: { projectionId: "tasks-list" } },
        form: { target: { projectionId: "task-form" } },
        bad: invalidMember,
      },
    }).success, false);
  }
});

test("operations support author-bound params and object-union targets for heterogeneous lists", async () => {
  const { panelOperationTargetPort, projectionOperationTargetMatches } = await import("./panel-projection");
  const unionPort = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", objectTypes: [BUSINESS_KNOWLEDGE, SCHEDULED_TASK] });
  const layerUnion = ontologyObjectUnionTypeSchema.parse({ kind: "object-union", layers: ["capability"] });
  assert.deepEqual(panelOperationTargetPort(unionPort, BUSINESS_KNOWLEDGE, false), unionPort);
  assert.equal(panelOperationTargetPort(unionPort, "platform:Skill", false), undefined);
  assert.deepEqual(panelOperationTargetPort(layerUnion, DEFINITION, false), layerUnion);

  const projection = {
    name: "Row disable", description: "", visibility: "domain" as const,
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {
      target: unionPort,
      reason: { kind: "scalar" as const, type: "string" as const },
    },
    outputs: {}, data: {}, config: { operation: "approve" },
    operations: {
      approve: {
        operation: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE },
        target: { input: "target" },
        params: { reason: { input: "reason" }, silent: { literal: true } },
      },
    },
  };
  assert.equal(productProjectionInputSchema.safeParse(projection).success, true);
  assert.equal(
    projectionOperationTargetMatches(
      projection,
      projection.operations.approve,
      { target: { source: "input", input: "target" }, batch: false },
      BUSINESS_KNOWLEDGE,
    ),
    true,
  );
  assert.equal(
    projectionOperationTargetMatches(
      projection,
      projection.operations.approve,
      { target: { source: "input", input: "target" }, batch: false },
      "platform:Skill",
    ),
    false,
  );

  // Undeclared input inside operation params is rejected.
  assert.equal(productProjectionInputSchema.safeParse({
    ...projection,
    operations: {
      approve: {
        ...projection.operations.approve,
        params: { reason: { input: "missingInput" } },
      },
    },
  }).success, false);
});

test("row operations reject legacy rowContext and omitted targets while list reads carry batch rowOperations", async () => {
  const { panelMemberItemKeySchema } = await import("./panel-manifest");
  const { productPanelReadRequestSchema, productPanelReadResponseSchema } = await import("./panel-host");

  assert.equal(panelMemberItemKeySchema.parse("row-1"), "row-1");
  assert.deepEqual(
    panelMemberItemKeySchema.parse({ className: SCHEDULED_TASK, primaryKey: "task-1" }),
    { className: SCHEDULED_TASK, primaryKey: "task-1" },
  );
  assert.equal(panelMemberItemKeySchema.safeParse("").success, false);
  assert.equal(panelMemberItemKeySchema.safeParse(0).success, false);

  const target = { kind: "object" as const, objectType: SCHEDULED_TASK, primaryKey: "task-1" };
  const humanRowReq = {
    applicationId: "app-1", useId: "use-1", operationId: "list.delete",
    memberPath: [{ member: "list" }], call: { target, input: {} },
  };
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse(humanRowReq).success, true);
  // Legacy rowContext and omitted call.target are rejected.
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({
    ...humanRowReq, rowContext: { state: {} },
  }).success, false);
  assert.equal(createPanelHumanOperationIntentRequestSchema.safeParse({
    applicationId: "app-1", useId: "use-1", operationId: "list.delete",
    memberPath: [{ member: "list", itemKey: "task-1" }], call: { input: {} },
  }).success, false);

  // Batch per-row operation availability returned alongside a list read response.
  const readResp = {
    status: "ready" as const,
    value: { rows: [] },
    rowOperations: {
      "platform:ScheduledTask:task-1": {
        delete: { available: false, unavailable: { reason: "System task cannot be deleted" } },
        runNow: { available: true },
      },
    },
  };
  assert.deepEqual(productPanelReadResponseSchema.parse(readResp), readResp);

  const baseRead = {
    source: { kind: "registered" as const, applicationId: "app-1", useId: "use-1" },
    memberPath: [{ member: "rowDetail" }],
    inputs: { target: { className: SCHEDULED_TASK, primaryKey: "task-1" } },
    dataName: "record",
  };
  assert.equal(productPanelReadRequestSchema.safeParse(baseRead).success, true);
  assert.equal(productPanelReadRequestSchema.safeParse({ ...baseRead, memberPath: [{ member: "list", itemKey: "task-1" }] }).success, false);
});

test("panelRecordItemKey and matchPanelRecordItemKey provide one shared contract", async () => {
  const { matchPanelRecordItemKey, panelRecordItemKey } = await import("./panel-projection");
  const homogeneousRow = { primaryKey: "task-1" };
  const typedRow = { primaryKey: "act-1", className: "platform:Action" };
  assert.equal(panelRecordItemKey(homogeneousRow), "task-1");
  assert.deepEqual(panelRecordItemKey(typedRow), { className: "platform:Action", primaryKey: "act-1" });
  assert.equal(panelRecordItemKey(typedRow, { heterogeneous: false }), "act-1");
  assert.deepEqual(
    panelRecordItemKey(homogeneousRow, { heterogeneous: true, fallbackClassName: SCHEDULED_TASK }),
    { className: SCHEDULED_TASK, primaryKey: "task-1" },
  );

  assert.equal(matchPanelRecordItemKey(homogeneousRow, "task-1"), true);
  assert.equal(matchPanelRecordItemKey(homogeneousRow, "task-2"), false);
  assert.equal(matchPanelRecordItemKey(typedRow, "act-1"), true);
  assert.equal(matchPanelRecordItemKey(typedRow, { className: "platform:Action", primaryKey: "act-1" }), true);
  assert.equal(matchPanelRecordItemKey(typedRow, { className: "platform:Skill", primaryKey: "act-1" }), false);
  assert.equal(
    matchPanelRecordItemKey(homogeneousRow, { className: SCHEDULED_TASK, primaryKey: "task-1" }, SCHEDULED_TASK),
    true,
  );
  assert.equal(
    matchPanelRecordItemKey(homogeneousRow, { className: SCHEDULED_TASK, primaryKey: "task-1" }),
    false,
  );
});

test("panel form fields accept an optional non-empty warning message", async () => {
  const { panelFormFieldSchema } = await import("./panel-projection");
  const baseField = {
    path: "/defaultModel",
    label: "Default model",
    valueSchema: { type: "string" },
    required: false,
    readOnly: false,
    control: { kind: "text" as const },
  };
  assert.equal(panelFormFieldSchema.parse({ ...baseField, warning: "Changes affect all new sessions." }).warning, "Changes affect all new sessions.");
  assert.equal(panelFormFieldSchema.safeParse({ ...baseField, warning: "" }).success, false);
});

test("an object control must declare the child fields a reader fills", async () => {
  const { panelFormFieldSchema } = await import("./panel-projection");
  const child = { ...editableField, path: "/mode", label: "Mode", valueSchema: { type: "string" }, control: { kind: "text" as const } };
  const baseField = {
    ...editableField,
    path: "/function/queryPackage",
    label: "Query package",
    valueSchema: { type: "object" },
    required: true,
  };
  const parses = (control: unknown) => panelFormFieldSchema.safeParse({ ...baseField, control });

  // An object with no child field is a declaration error: the generic form would draw an empty field, which reads as no value.
  const childless = parses({ kind: "object", fields: [] });
  assert.equal(childless.success, false);
  assert.deepEqual(childless.error?.issues.map(issue => issue.path.join("/")), ["control/fields"]);
  assert.equal(parses({ kind: "object", fields: [], variants: { none: [] } }).success, false);
  assert.equal(parses({ kind: "object", fields: [child] }).success, true);
  // A whole JSON document a reader takes as source is a code control, not an object.
  assert.equal(parses({ kind: "code", language: "json" }).success, true);
});

test("a Markdown string is a text control in its Markdown presentation, with no kind of its own", async () => {
  const { panelFormFieldSchema } = await import("./panel-projection");
  const field = { ...editableField, path: "/prompt", label: "Prompt", valueSchema: { type: "string" } };
  const parses = (control: unknown) => panelFormFieldSchema.safeParse({ ...field, control });

  // The owner's value stays a plain string; only how it is drawn changes.
  assert.equal(parses({ kind: "text", presentation: "markdown" }).success, true);
  assert.equal(parses({ kind: "text" }).success, true);
  // Markdown is no longer a control kind of its own.
  assert.equal(parses({ kind: "markdown" }).success, false);
  assert.equal(parses({ kind: "text", presentation: "rich-text" }).success, false);
});

test("object form fields declare discriminated variants, validate invariants, and prune inactive values recursively", () => {
  const opt = (value: string | number, label: string, disabled = false) => ({
    value, label, description: null, disabled, disabledReason: disabled ? "Unavailable" : null,
  });
  const textField = (path: string, label: string): PanelFormField => ({
    ...editableField, path, label, valueSchema: { type: "string" }, control: { kind: "text" },
  });

  const handoffControl: PanelFormObjectControl = {
    kind: "object",
    defaultObject: { kind: "none" },
    fields: [{
      ...editableField, path: "/kind", label: "Handoff kind", valueSchema: { type: "string", enum: ["none", "webhook", "queue"] },
      control: { kind: "select", options: [opt("none", "None"), opt("webhook", "Webhook"), opt("queue", "Queue")] },
    }],
    variantBy: "/kind",
    variants: {
      none: [],
      webhook: [textField("/url", "Webhook URL")],
      queue: [textField("/topic", "Queue topic")],
    },
  };

  const executorValueSchema: PanelFormValues = {
    oneOf: [
      { type: "object", properties: { mode: { const: "none" } }, required: ["mode"], additionalProperties: false },
      {
        type: "object",
        properties: {
          mode: { const: "rule" },
          ruleId: { type: "string" },
          target: { type: "string" },
          extra: { type: "object", properties: { expr: { type: "string" } } },
        },
        required: ["mode", "ruleId"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          mode: { const: "agent" },
          agentId: { type: "string" },
          target: { type: "string" },
          handoff: { type: "object" },
        },
        required: ["mode", "agentId"],
        additionalProperties: false,
      },
    ],
  };

  const executorControl: PanelFormObjectControl = {
    kind: "object",
    defaultObject: { mode: "none" },
    fields: [
      {
        ...editableField, path: "/mode", label: "Execution mode",
        valueSchema: { type: "string", enum: ["none", "rule", "agent"] },
        control: { kind: "select", options: [opt("none", "None"), opt("rule", "Rule"), opt("agent", "Agent", true)] },
      },
      textField("/note", "Note"),
    ],
    variantBy: "/mode",
    variants: {
      // "none" intentionally omitted to verify omitted option means no extra fields.
      rule: [
        textField("/ruleId", "Rule"),
        textField("/target", "Rule target"),
        textField("/extra/expr", "Expression"),
      ],
      agent: [
        textField("/agentId", "Agent"),
        textField("/target", "Agent target"),
        { ...editableField, path: "/handoff", label: "Handoff", valueSchema: { type: "object" }, control: handoffControl },
      ],
    },
  };

  const executorField: PanelFormField = {
    ...editableField, path: "/executor", label: "Executor", valueSchema: executorValueSchema, control: executorControl,
  };
  const stepsField: PanelFormField = {
    ...editableField, path: "/steps", label: "Steps", valueSchema: { type: "array" },
    control: {
      kind: "object-array", itemKeyPath: "/id", defaultItem: { id: "s1", executor: { mode: "none" } },
      itemFields: [textField("/id", "ID"), executorField],
    },
  };

  const form = {
    fields: [stepsField, executorField],
    values: {
      steps: [{ id: "s1", executor: { mode: "rule", ruleId: "r-1" } }],
      executor: { mode: "none" },
    },
    errors: [],
    save: ownerSave,
  };
  assert.deepEqual(panelFormDescriptionSchema.parse(form), form);

  // Numeric scalar select options work and distinguish number from string at runtime.
  const versionField = panelFormFieldSchema.parse({
    ...editableField, path: "/versioned", label: "Versioned", valueSchema: { type: "object" },
    control: {
      kind: "object",
      fields: [{
        ...editableField, path: "/version", label: "Version", valueSchema: { type: "number" },
        control: { kind: "select", options: [opt(1, "V1"), opt(2, "V2")] },
      }],
      variantBy: "/version",
      variants: { "1": [textField("/legacy", "Legacy")], "2": [textField("/modern", "Modern")] },
    },
  });
  assert.equal(versionField.control.kind, "object");
  assert.equal(panelFormObjectActiveVariant(versionField.control, { version: 1 }), "1");
  assert.equal(panelFormObjectActiveVariant(versionField.control, { version: "1" }), undefined);
  assert.deepEqual(
    panelFormObjectActiveFields(versionField.control, { version: 2 }).map(field => field.path),
    ["/version", "/modern"],
  );

  // Pure helpers: all fields, active variant, active fields.
  assert.deepEqual(
    panelFormObjectAllFields(executorControl).map(field => field.path),
    ["/mode", "/note", "/ruleId", "/target", "/extra/expr", "/agentId", "/target", "/handoff"],
  );
  assert.equal(panelFormObjectActiveVariant(executorControl, { mode: "none" }), "none");
  assert.deepEqual(
    panelFormObjectActiveFields(executorControl, { mode: "none" }).map(field => field.path),
    ["/mode", "/note"],
  );
  assert.deepEqual(
    panelFormObjectActiveFields(executorControl, { mode: "rule" }).map(field => field.path),
    ["/mode", "/note", "/ruleId", "/target", "/extra/expr"],
  );
  assert.deepEqual(
    panelFormObjectActiveFields(executorControl, { mode: "agent" }).map(field => field.path),
    ["/mode", "/note", "/agentId", "/target", "/handoff"],
  );
  assert.equal(panelFormObjectActiveVariant(executorControl, { mode: "unknown" }), undefined);
  assert.equal(panelFormObjectActiveVariant(executorControl, null), undefined);
  assert.deepEqual(
    panelFormObjectActiveFields(executorControl, null).map(field => field.path),
    ["/mode", "/note"],
  );

  // Recursive pruning strips inactive variant values without mutating the edit draft.
  const draft: PanelFormValues = {
    steps: [
      {
        id: "s1",
        executor: {
          mode: "agent",
          note: "keep",
          ownerMeta: "preserve-undeclared",
          ruleId: "stale-rule",
          target: "shared-agent-target",
          extra: { expr: "x > 1" },
          agentId: "agent-1",
          handoff: { kind: "webhook", url: "https://example.invalid/hook", topic: "stale-topic" },
        },
      },
      {
        id: "s2",
        executor: {
          mode: "none",
          ruleId: "stale-rule",
          agentId: "stale-agent",
          target: "stale-target",
          extra: { expr: "stale-expr", keptSibling: "keep" },
          handoff: { kind: "queue", topic: "stale-topic" },
        },
      },
      { id: "s3", executor: null },
      { id: "s4" },
    ],
    executor: { mode: "rule", ruleId: "r-2", agentId: "stale-agent", untouchedEmpty: {} },
  };
  const snapshot = JSON.stringify(draft);
  const pruned = pruneInactivePanelFormVariants([stepsField, executorField], draft);
  assert.equal(JSON.stringify(draft), snapshot);
  assert.deepEqual(pruned, {
    steps: [
      {
        id: "s1",
        executor: {
          mode: "agent",
          note: "keep",
          ownerMeta: "preserve-undeclared",
          target: "shared-agent-target",
          agentId: "agent-1",
          handoff: { kind: "webhook", url: "https://example.invalid/hook" },
        },
      },
      {
        id: "s2",
        executor: {
          mode: "none",
          extra: { keptSibling: "keep" },
        },
      },
      { id: "s3", executor: null },
      { id: "s4" },
    ],
    executor: { mode: "rule", ruleId: "r-2", untouchedEmpty: {} },
  });

  // Invariant rejections in superRefine.
  const invalidControls: unknown[] = [
    // Incomplete variant declarations.
    { kind: "object", fields: executorControl.fields, variantBy: "/mode" },
    { kind: "object", fields: executorControl.fields, variants: { rule: [textField("/ruleId", "Rule")] } },
    // Missing or non-select discriminator.
    { kind: "object", fields: executorControl.fields, variantBy: "/missing", variants: {} },
    { kind: "object", fields: executorControl.fields, variantBy: "/note", variants: {} },
    // Multi-select or allowCreate select discriminator.
    {
      kind: "object",
      fields: [{ ...editableField, path: "/mode", label: "Mode", valueSchema: { type: "array" },
        control: { kind: "select", multiple: true, options: [opt("rule", "Rule")] } }],
      variantBy: "/mode", variants: { rule: [] },
    },
    {
      kind: "object",
      fields: [{ ...editableField, path: "/mode", label: "Mode", valueSchema: { type: "string" },
        control: { kind: "select", allowCreate: true, options: [opt("rule", "Rule")] } }],
      variantBy: "/mode", variants: { rule: [] },
    },
    // Object-valued select discriminator.
    {
      kind: "object",
      fields: [{ ...editableField, path: "/mode", label: "Mode", valueSchema: { type: "object" },
        control: { kind: "select", options: [{ value: { kind: "rule" }, label: "Rule", description: null, disabled: false, disabledReason: null }] } }],
      variantBy: "/mode", variants: {},
    },
    // Ambiguous scalar option keys ("1" vs 1).
    {
      kind: "object",
      fields: [{ ...editableField, path: "/mode", label: "Mode", valueSchema: { type: ["string", "number"] },
        control: { kind: "select", options: [opt(1, "Num 1"), opt("1", "Str 1")] } }],
      variantBy: "/mode", variants: { "1": [] },
    },
    // Undeclared variant key and reserved prototype key.
    { ...executorControl, variants: { manual: [textField("/owner", "Owner")] } },
    { ...executorControl, variants: { constructor: [textField("/owner", "Owner")] } },
    // Conflict with discriminator, common field, or ancestor/descendant of common field.
    { ...executorControl, variants: { rule: [textField("/mode", "Duplicate mode")] } },
    { ...executorControl, variants: { rule: [textField("/note", "Duplicate note")] } },
    { ...executorControl, variants: { rule: [textField("/note/detail", "Nested under common")] } },
    // Duplicate or overlapping paths within one variant.
    { ...executorControl, variants: { rule: [textField("/ruleId", "A"), textField("/ruleId", "B")] } },
    { ...executorControl, variants: { rule: [textField("/cfg", "A"), textField("/cfg/x", "B")] } },
  ];
  for (const invalid of invalidControls) {
    assert.equal(panelFormFieldSchema.safeParse({ ...executorField, control: invalid }).success, false);
  }

  // Recursive validation catches invalid variant inside object-array row and inside another variant's nested object.
  const badNested = { ...executorControl, variants: { bogus: [] } };
  assert.equal(panelFormFieldSchema.safeParse({
    ...stepsField,
    control: { ...stepsField.control, itemFields: [{ ...executorField, control: badNested }] },
  }).success, false);
  assert.equal(panelFormFieldSchema.safeParse({
    ...executorField,
    control: {
      ...executorControl,
      variants: {
        agent: [{ ...editableField, path: "/handoff", label: "Handoff", valueSchema: { type: "object" }, control: badNested }],
      },
    },
  }).success, false);
});

test("operationDrafts validates target form member and directs projectionOperation to the declared draft slot", async () => {
  const { projectionOperation } = await import("./panel-projection");
  const { dashboardMetricOutputSchema } = await import("./dashboard");
  const manifest = panelManifestSchema.parse({
    state: {},
    members: {
      relationForm: { target: { projectionId: "form-proj" } },
      headerSave: {
        target: { projectionId: "save-btn" },
        operationDrafts: { save: { slot: "relationForm" } },
      },
    },
  });
  assert.deepEqual(manifest.members.headerSave.operationDrafts, { save: { slot: "relationForm" } });

  const badManifest = panelManifestSchema.safeParse({
    state: {},
    members: {
      headerSave: {
        target: { projectionId: "save-btn" },
        operationDrafts: { save: { slot: "missingForm" } },
      },
    },
  });
  assert.equal(badManifest.success, false);
  assert.deepEqual(badManifest.error.issues[0]?.path, ["members", "headerSave", "operationDrafts", "save", "slot"]);

  const placedSave = projectionOperation(manifest, "headerSave", "save", {
    kind: "form.save",
    effect: "write",
    batch: false,
    handlerRef: "platform:Relationship.save",
    label: "Save",
    target: { source: "draft", slot: "relationForm" },
    inputSchema: {},
    resultSchema: {},
  });
  assert.equal(placedSave.slot, "headerSave");
  assert.deepEqual(placedSave.target, { source: "draft", slot: "relationForm" });

  // Metric output contract carries optional sourceObjectTypes for write-triggered refresh invalidation.
  const metricOut = dashboardMetricOutputSchema.parse({
    columns: [{ key: "total", label: "Total", type: "number" }],
    rows: [{ total: 12 }],
    truncation: null,
    sourceObjectTypes: ["Student"],
  });
  assert.deepEqual(metricOut.sourceObjectTypes, ["Student"]);
});

test("targetless customer Actions live in top-level type table operations and omit object on action snapshots", async () => {
  const { platformTypeTableResponseSchema } = await import("./platform-type-table");
  const { panelWriteOperationSnapshotSchema } = await import("./panel-agent");
  const { EXECUTE_OBJECT_ACTION } = await import("./platform-object-types");

  const createOrder = {
    id: "create-order",
    kind: "action" as const,
    effect: "write" as const,
    target: { source: "none" as const },
    inputSchema: {
      type: "object",
      properties: { values: { type: "object", properties: { customer: { type: "string" } }, additionalProperties: false } },
      required: ["values"],
      additionalProperties: false,
    },
    batch: false,
    affects: ["Order", "AuditLog"],
  };

  const parsedTable = platformTypeTableResponseSchema.parse({
    objectTypes: { Order: {} },
    operations: [createOrder],
    resultSchemas: {},
  });
  assert.deepEqual(parsedTable.operations, [createOrder]);

  // Duplicate top-level operation IDs are rejected.
  assert.equal(platformTypeTableResponseSchema.safeParse({
    objectTypes: { Order: {} },
    operations: [createOrder, createOrder],
    resultSchemas: {},
  }).success, false);

  // Targetless actions.execute snapshot omits action.object and optionally records affects.
  const snapshot = panelWriteOperationSnapshotSchema.parse({
    id: "createForm.save",
    slot: "createForm",
    kind: "action",
    effect: "write",
    handlerRef: EXECUTE_OBJECT_ACTION,
    label: "Create order",
    target: { source: "none" },
    inputSchema: createOrder.inputSchema,
    resultSchema: {},
    batch: false,
    action: {
      actionId: "create-order",
      codeHash: "a".repeat(64),
      affects: ["Order"],
    },
  });
  assert.equal(snapshot.action?.object, undefined);
  assert.deepEqual(snapshot.action?.affects, ["Order"]);

});

test("projectionOperation places a row target without a member input binding", () => {
  const manifest = panelManifestSchema.parse({
    state: {},
    members: { list: { target: { projectionId: "skills-list" } } },
  });
  const placed = projectionOperation(manifest, "list", "export", {
    kind: "action",
    effect: "read",
    batch: false,
    handlerRef: "skills.export",
    label: "Export",
    target: { source: "row" },
    inputSchema: {},
    resultSchema: {},
  });
  assert.deepEqual(panelOperationSchema.parse(placed).target, { source: "row" });
});

test("projectionOperation preserves draft targets on read actions so panelOperationSchema accepts them", () => {
  const manifest = panelManifestSchema.parse({
    state: {},
    members: {
      definition: {
        target: { projectionId: "metric-definition-form" },
        readOperationInputs: {
          test: { draft: { slot: "definition" }, parameters: { fields: {} } },
          testExecute: { draft: { slot: "definition" }, parameters: { fields: {} } },
        },
      },
    },
  });
  const placed = projectionOperation(manifest, "definition", "test", {
    kind: "action",
    effect: "read",
    batch: false,
    handlerRef: "platform:MetricView.test",
    label: "Test",
    target: { source: "draft", slot: "definition" },
    inputSchema: { type: "object", properties: {} },
    resultSchema: {},
  });
  assert.deepEqual(placed.target, { source: "draft", slot: "definition" });
  const parsed = panelOperationSchema.parse(placed);
  assert.equal(parsed.id, "definition.test");
  assert.deepEqual(parsed.target, { source: "draft", slot: "definition" });
});

const controlField = { path: "/field", label: "Field", valueSchema: {}, required: false, readOnly: false };
const choiceOption = { label: "Read", value: 1, description: null, disabled: false, disabledReason: null };
const parsesControl = (control: unknown) => panelFormFieldSchema.safeParse({ ...controlField, control }).success;

test("form submit timing is optional and rejects unsupported triggers", () => {
  const field = { ...controlField, control: { kind: "text" } };
  const form = { fields: [field], values: {}, errors: [], save: ownerSave };
  assert.equal(panelFormDescriptionSchema.parse(form).submitOn, undefined);
  assert.equal(panelFormFieldSchema.parse(field).submitOn, undefined);
  for (const submitOn of ["manual", "blur", "change"]) {
    const parsed = panelFormDescriptionSchema.parse({ ...form, submitOn, fields: [{ ...field, submitOn }] });
    assert.equal(parsed.submitOn, submitOn);
    assert.equal(parsed.fields[0]?.submitOn, submitOn);
  }
  assert.equal(panelFormDescriptionSchema.safeParse({ ...form, submitOn: "input" }).success, false);
  assert.equal(panelFormFieldSchema.safeParse({ ...field, submitOn: "input" }).success, false);
});

test("select presentation follows cardinality and presets reference declared values", () => {
  const value = { kind: "api", id: 1 };
  const option = { ...choiceOption, value, badge: "GET", groupPath: ["API", "Reports"] };
  const select = { kind: "select", multiple: true, options: [option] };
  const presets = [{ label: "Readers", values: [{ id: 1, kind: "api" }] }];
  for (const presentation of ["dropdown", "checklist", "tree"]) {
    assert.equal(parsesControl({ ...select, presentation, presets }), true);
  }
  assert.equal(parsesControl({ ...select, presentation: "radio" }), false);
  assert.equal(parsesControl({ ...select, multiple: false, presentation: "radio" }), true);
  for (const presentation of ["tree", "checklist"]) {
    assert.equal(parsesControl({ ...select, multiple: false, presentation }), false);
  }
  assert.equal(parsesControl({ ...select, multiple: false, presets }), false);
  assert.equal(parsesControl({ ...select, presets: [{ label: "Unknown", values: [{ id: 2 }] }] }), false);
  for (const metadata of [{ badge: "" }, { groupPath: [] }, { groupPath: [""] }]) {
    assert.equal(parsesControl({ ...select, options: [{ ...option, ...metadata }] }), false);
  }
});

test("choice matrix requires unique row keys and scalar tiers, and explains disabled rows", () => {
  const row = { key: "reports", label: "Reports", badge: "API", disabled: false, disabledReason: null };
  const disabled = { ...row, key: "users", disabled: true, disabledReason: "Managed by the owner" };
  const matrix = { kind: "choice-matrix", rows: [row, disabled], options: [choiceOption, { ...choiceOption, value: "1" }] };
  assert.equal(parsesControl(matrix), true);
  assert.equal(parsesControl({ ...matrix, rows: [row, { ...disabled, key: row.key }] }), false);
  assert.equal(parsesControl({ ...matrix, rows: [{ ...disabled, disabledReason: null }] }), false);
  assert.equal(parsesControl({ ...matrix, rows: [{ ...row, disabledReason: "Unexpected" }] }), false);
  assert.equal(parsesControl({ ...matrix, options: [choiceOption, { ...choiceOption, label: "Duplicate" }] }), false);
  assert.equal(parsesControl({ ...matrix, options: [{ ...choiceOption, value: { tier: 1 } }] }), false);
});

test("text variables admit empty groups and require meaningful labels and insertion text", () => {
  const item = { label: "Name", value: "{{name}}", badge: "Single" };
  const group = { label: "Context", items: [item] };
  const text = { kind: "text", variables: [group, { label: "Inputs", emptyHint: "Add an input", items: [] }] };
  assert.equal(parsesControl(text), true);
  assert.equal(parsesControl({ ...text, variables: [{ ...group, label: "" }] }), false);
  assert.equal(parsesControl({ ...text, variables: [{ ...group, emptyHint: "" }] }), false);
  for (const key of ["label", "value", "badge"]) {
    assert.equal(parsesControl({ ...text, variables: [{ ...group, items: [{ ...item, [key]: "" }] }] }), false);
  }
});

test("panel form revision accepts both positive integers and non-empty opaque strings", () => {
  const ownerSave = { method: "POST" as const, path: "/api/dashboards/save-card-parameters", bodySchema: { type: "object" } };
  const field = {
    path: "/region", label: "Region", valueSchema: { type: "string" }, required: false, readOnly: false,
    control: { kind: "text" as const },
  };
  for (const revision of [1, "rev-abc-123"]) {
    assert.equal(panelFormDescriptionSchema.parse({ fields: [field], values: { region: "APAC" }, errors: [], revision, save: ownerSave }).revision, revision);
    assert.equal(panelFormSaveInputSchema.parse({ values: { region: "APAC" }, revision }).revision, revision);
  }
  for (const invalid of ["", 0, -1, 1.5]) {
    assert.equal(panelFormDescriptionSchema.safeParse({ fields: [field], values: {}, errors: [], revision: invalid, save: ownerSave }).success, false);
    assert.equal(panelFormSaveInputSchema.safeParse({ values: {}, revision: invalid }).success, false);
  }
});

test("parent-scoped objects and child-objects use short URL query keys when a unique sibling parent deep-link exists", async () => {
  const {
    applicationPanelAddress, panelAddress, panelAddressState, parseApplicationPanelAddress,
    validateApplicationPanelAddressState,
  } = await import("./panel-host");
  const dashboardManifest = {
    state: {
      dashboardId: { type: { kind: "object" as const, objectType: "platform:Dashboard" }, deepLink: true, personal: false, external: false },
      cardId: { type: { kind: "object" as const, objectType: "platform:DashboardCard" }, deepLink: true, personal: false, external: false },
    },
  };
  const dashRef = { className: "platform:Dashboard", primaryKey: "dash-1" };
  const cardRef = { className: "platform:DashboardCard", primaryKey: dashboardCardPrimaryKey({ dashboardId: "dash-1", cardId: "card-1" }) };
  const encoded = panelAddress("/dashboards", { dashboardId: dashRef, cardId: cardRef }, dashboardManifest);
  assert.equal(encoded, "/dashboards?dashboardId=dash-1&cardId=card-1");
  assert.deepEqual(panelAddressState(encoded, dashboardManifest), { dashboardId: dashRef, cardId: cardRef });

  // A card belonging to a different dashboard keeps its full composite primaryKey losslessly.
  const otherCard = { className: "platform:DashboardCard", primaryKey: dashboardCardPrimaryKey({ dashboardId: "dash-2", cardId: "card-9" }) };
  const crossEncoded = panelAddress("/dashboards", { dashboardId: dashRef, cardId: otherCard }, dashboardManifest);
  assert.equal(crossEncoded, "/dashboards?dashboardId=dash-1&cardId=dash-2%2Fcard-9");
  assert.deepEqual(panelAddressState(crossEncoded, dashboardManifest), { dashboardId: dashRef, cardId: otherCard });

  // Orphan bare cardId without a sibling dashboardId is safely ignored rather than creating a broken composite key.
  assert.deepEqual(panelAddressState("/dashboards?cardId=card-1", dashboardManifest), {});

  // Application-level address encoding and validation follow the exact same shorthand rule.
  const appAddr = applicationPanelAddress("/dashboards", {
    state: { dashboardId: dashRef, cardId: cardRef },
    stateManifest: dashboardManifest,
  });
  assert.equal(appAddr, "/dashboards?dashboardId=dash-1&cardId=card-1");
  const parsedApp = parseApplicationPanelAddress(appAddr, { stateManifest: dashboardManifest });
  assert.deepEqual(parsedApp.state, { dashboardId: dashRef, cardId: cardRef });
  assert.deepEqual(
    validateApplicationPanelAddressState("state", { dashboardId: "dash-1", cardId: "card-1" }, dashboardManifest),
    { dashboardId: dashRef, cardId: cardRef },
  );

  // Child-object state also uses short URL query keys when a unique sibling parent deep-link exists.
  const childManifest = {
    state: {
      dashboardId: { type: { kind: "object" as const, objectType: "platform:Dashboard" }, deepLink: true, personal: false, external: false },
      item: { type: { kind: "child-object" as const, parentType: "platform:Dashboard", collection: "cards" }, deepLink: true, personal: false, external: false },
    },
  };
  const childIdentity = { parent: { objectType: "platform:Dashboard", primaryKey: "dash-1" }, primaryKey: "card-1" };
  const childAddr = panelAddress("/dashboards", { dashboardId: dashRef, item: childIdentity }, childManifest);
  assert.equal(childAddr, "/dashboards?dashboardId=dash-1&item=card-1");
  assert.deepEqual(panelAddressState(childAddr, childManifest), { dashboardId: dashRef, item: childIdentity });
});

test("inline MetricChart without sourceCard accepts explicit slot-supplied card data bindings", async () => {
  const { panelAuthoringMemberSchema } = await import("./panel-check");
  const slotChart = {
    component: "MetricChart",
    type: DASHBOARD_CARD,
    target: { fromSlot: true },
    data: { template: "chartTemplate", result: "result" },
  };
  assert.deepEqual(panelAuthoringMemberSchema.parse(slotChart), slotChart);
});

test("grid-layout state port validates values, bounds, unique IDs, and port compatibility", async () => {
  const {
    directPanelPortTypeSchema,
    matchesDirectPanelValue,
    normalizeExternalPanelValue,
    panelGridLayoutTypeSchema,
    panelGridLayoutValueSchema,
    panelPortAccepts,
  } = await import("./panel-manifest");

  const constrainedType = panelGridLayoutTypeSchema.parse({
    kind: "grid-layout",
    columns: 12,
    maxRowSpan: 6,
    groupIds: ["main", "secondary"],
    itemIds: ["block-a", "block-b", "block-c"],
  });
  assert.deepEqual(directPanelPortTypeSchema.parse(constrainedType), constrainedType);

  const validValue = panelGridLayoutValueSchema.parse({
    groups: [
      {
        id: "main",
        title: "Primary",
        items: [
          { id: "block-a", colSpan: 6, rowSpan: 2 },
          { id: "block-b", colSpan: 6, rowSpan: 2, hidden: true },
        ],
      },
      {
        id: "secondary",
        items: [{ id: "block-c", colSpan: 12, rowSpan: 4 }],
      },
    ],
  });
  assert.equal(matchesDirectPanelValue(constrainedType, validValue), true);
  assert.equal(matchesDirectPanelValue(constrainedType, null), true);
  assert.deepEqual(normalizeExternalPanelValue(constrainedType, validValue), { ok: true, value: validValue });

  // Duplicate group ID rejected
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [
      { id: "main", items: [{ id: "block-a", colSpan: 6, rowSpan: 2 }] },
      { id: "main", items: [{ id: "block-b", colSpan: 6, rowSpan: 2 }] },
    ],
  }), false);

  // Duplicate item ID across groups rejected
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [
      { id: "main", items: [{ id: "block-a", colSpan: 6, rowSpan: 2 }] },
      { id: "secondary", items: [{ id: "block-a", colSpan: 6, rowSpan: 2 }] },
    ],
  }), false);

  // Unknown itemId rejected
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [{ id: "main", items: [{ id: "unknown-block", colSpan: 6, rowSpan: 2 }] }],
  }), false);

  // Unknown groupId rejected
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [{ id: "unknown-group", items: [{ id: "block-a", colSpan: 6, rowSpan: 2 }] }],
  }), false);

  // Out-of-bounds colSpan and rowSpan rejected
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [{ id: "main", items: [{ id: "block-a", colSpan: 13, rowSpan: 2 }] }],
  }), false);
  assert.equal(matchesDirectPanelValue(constrainedType, {
    groups: [{ id: "main", items: [{ id: "block-a", colSpan: 6, rowSpan: 7 }] }],
  }), false);
  assert.equal(normalizeExternalPanelValue(constrainedType, {
    groups: [{ id: "main", items: [{ id: "block-a", colSpan: 13, rowSpan: 2 }] }],
  }).ok, false);

  // Port compatibility checks
  const unbounded = panelGridLayoutTypeSchema.parse({ kind: "grid-layout" });
  const narrower = panelGridLayoutTypeSchema.parse({
    kind: "grid-layout",
    columns: 8,
    maxRowSpan: 4,
    groupIds: ["main"],
    itemIds: ["block-a", "block-b"],
  });
  const widerColumns = panelGridLayoutTypeSchema.parse({
    kind: "grid-layout",
    columns: 16,
    maxRowSpan: 6,
    groupIds: ["main"],
    itemIds: ["block-a"],
  });
  const extraItem = panelGridLayoutTypeSchema.parse({
    kind: "grid-layout",
    columns: 12,
    maxRowSpan: 6,
    groupIds: ["main"],
    itemIds: ["block-a", "extra"],
  });

  assert.equal(panelPortAccepts(unbounded, constrainedType), true);
  assert.equal(panelPortAccepts(constrainedType, unbounded), false);
  assert.equal(panelPortAccepts(constrainedType, narrower), true);
  assert.equal(panelPortAccepts(constrainedType, widerColumns), false);
  assert.equal(panelPortAccepts(constrainedType, extraItem), false);
  assert.equal(panelPortAccepts(constrainedType, { kind: "scalar", type: "string" }), false);
  assert.equal(panelPortAccepts({ kind: "json" }, constrainedType), true);
  assert.equal(panelPortAccepts(constrainedType, { kind: "json" }), false);
});

test("expandPanelAuthoringMember supports static GroupedGrid with constrained personal grid-layout state and no data", async () => {
  const { expandPanelAuthoringMember, panelAuthoringManifestSchema } = await import("./panel-check");

  const groupedGridComponent = {
    componentId: "GroupedGrid",
    module: "@ontomato/sdk/base",
    exportName: "GroupedGrid",
    role: "control" as const,
    meaning: "Generic grouped grid.",
    effects: "Reads and writes layout state.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      record: { results: ["panelRecord" as const], required: false },
      rows: { results: ["panelRecordList" as const], required: false },
    },
    inputs: {
      selected: { kind: "object" as const, objectType: "@data:rows" },
      layout: { kind: "grid-layout" as const },
    },
    outputs: {
      selected: { kind: "object" as const, objectType: "@data:rows" },
      layout: { kind: "grid-layout" as const },
    },
    readOnlyOutputs: {
      status: { kind: "scalar" as const, type: "string" as const },
      groupCount: { kind: "scalar" as const, type: "number" as const },
      itemCount: { kind: "scalar" as const, type: "number" as const },
      hiddenCount: { kind: "scalar" as const, type: "number" as const },
    },
    ports: { props: [], events: [], slots: [] },
  };

  const manifest = panelAuthoringManifestSchema.parse({
    state: {
      layout: {
        type: {
          kind: "grid-layout",
          columns: 12,
          maxRowSpan: 6,
          groupIds: ["main"],
          itemIds: ["summary", "activity"],
        },
        personal: true,
        default: {
          groups: [
            {
              id: "main",
              items: [
                { id: "summary", colSpan: 6, rowSpan: 2 },
                { id: "activity", colSpan: 6, rowSpan: 2 },
              ],
            },
          ],
        },
      },
    },
    members: {
      canvas: {
        component: "GroupedGrid",
        state: { layout: "layout" },
        config: {
          columns: 12,
          showGroupHeaders: false,
          items: [
            { id: "summary", title: "Summary", groupId: "main", colSpan: 6, rowSpan: 2 },
            { id: "activity", title: "Activity", groupId: "main", colSpan: 6, rowSpan: 2 },
          ],
        },
      },
    },
  });

  const member = manifest.members.canvas;
  assert.ok("component" in member);
  const expanded = expandPanelAuthoringMember("canvas", member, {
    state: manifest.state,
    components: [groupedGridComponent],
    typeTable: { objectTypes: {} },
  });

  assert.equal(expanded.projection.componentId, "@ontomato/sdk:GroupedGrid");
  assert.deepEqual(expanded.projection.data, {});
  assert.deepEqual(expanded.projection.inputs.layout, manifest.state.layout.type);
  assert.deepEqual(expanded.projection.outputs.layout, manifest.state.layout.type);
  assert.deepEqual(expanded.placement.inputs, { layout: { state: "layout" } });
  assert.deepEqual(expanded.placement.outputs, { layout: { state: "layout" } });

  // Static config.items referencing an item ID outside state.layout.itemIds is rejected.
  const badMember = panelAuthoringManifestSchema.parse({
    state: manifest.state,
    members: {
      canvas: {
        component: "GroupedGrid",
        state: { layout: "layout" },
        config: {
          items: [{ id: "undeclared-item", title: "Bad" }],
        },
      },
    },
  }).members.canvas;
  assert.ok("component" in badMember);
  assert.throws(
    () => expandPanelAuthoringMember("canvas", badMember, {
      state: manifest.state,
      components: [groupedGridComponent],
      typeTable: { objectTypes: {} },
    }),
    /itemIds/,
  );
});

test("group E pack 1 contracts validate secret autoDownload and extended form control presentation options", async () => {
  const { panelSecretDeliverySchema } = await import("./panel-agent");
  const { panelFormFieldSchema } = await import("./panel-projection");

  const secret = panelSecretDeliverySchema.parse({
    title: "API Keys",
    download: {
      filename: "keys.csv",
      contentType: "text/csv",
      content: "a,b\n1,2",
      autoDownload: true,
    },
  });
  assert.equal(secret.download?.autoDownload, true);

  const option = { value: "a", label: "Alpha", description: "Desc", disabled: false, disabledReason: null };
  assert.equal(panelFormFieldSchema.safeParse({
    path: "/roles", label: "Roles", valueSchema: {}, required: false, readOnly: false,
    control: {
      kind: "select", multiple: true, options: [option],
      filterable: true, clearable: true, collapseTags: true, presentation: "checkbox",
    },
  }).success, true);

  // Single select rejects checkbox presentation and collapseTags.
  assert.equal(panelFormFieldSchema.safeParse({
    path: "/role", label: "Role", valueSchema: {}, required: false, readOnly: false,
    control: { kind: "select", multiple: false, options: [option], presentation: "checkbox" },
  }).success, false);
  assert.equal(panelFormFieldSchema.safeParse({
    path: "/role", label: "Role", valueSchema: {}, required: false, readOnly: false,
    control: { kind: "select", multiple: false, options: [option], collapseTags: true },
  }).success, false);

  // Choice matrix table presentation with headers and indented child row.
  assert.equal(panelFormFieldSchema.safeParse({
    path: "/columns", label: "Columns", valueSchema: {}, required: false, readOnly: false,
    control: {
      kind: "choice-matrix",
      presentation: "table",
      rowHeader: "Field",
      choiceHeader: "Access",
      options: [option],
      rows: [
        { key: "attr", label: "Attribute", disabled: false, disabledReason: null },
        { key: "attr.metric", label: "Metric", indent: true, disabled: false, disabledReason: null },
      ],
    },
  }).success, true);

  // Collapsible rows variable picker and multi-column/numbered object-array + panel object.
  assert.equal(panelFormFieldSchema.safeParse({
    path: "/filter", label: "Filter", valueSchema: {}, required: false, readOnly: false,
    control: {
      kind: "text", multiline: true, variablesCollapsible: true, variablesPresentation: "rows",
      variables: [{ label: "Account", items: [{ label: "ID", value: "${user.id}", badge: "string" }] }],
    },
  }).success, true);

  assert.equal(panelFormFieldSchema.safeParse({
    path: "/steps", label: "Steps", valueSchema: {}, required: false, readOnly: false,
    control: {
      kind: "object-array",
      columns: 4,
      numbered: true,
      reorderable: false,
      itemFields: [
        {
          path: "/policy", label: "Policy", valueSchema: {}, required: false, readOnly: false,
          control: {
            kind: "object",
            columns: 3,
            presentation: "panel",
            fields: [
              { path: "/mode", label: "Mode", valueSchema: {}, required: false, readOnly: false, control: { kind: "text" } },
            ],
          },
        },
      ],
    },
  }).success, true);
});

test("value-carried tag field values, form option tones, and ObjectList column tooltip/tagEffect contracts", () => {
  const activeTag = panelRecordTagFieldValueSchema.parse({
    kind: "tag",
    label: "Active",
    tone: "success",
    icon: "check-circle",
  });
  assert.deepEqual(activeTag, { kind: "tag", label: "Active", tone: "success", icon: "check-circle" });

  // Standalone and array-embedded tag values validate and extract plain text via label.
  const draftTag = { kind: "tag", label: "Draft", tone: "warning" } as const;
  assert.equal(panelRecordFieldValueSchema.safeParse(activeTag).success, true);
  assert.equal(panelRecordFieldArrayItemSchema.safeParse(draftTag).success, true);
  assert.equal(panelRecordFieldValueSchema.safeParse([activeTag, draftTag, "Plain"]).success, true);
  assert.equal(panelRecordFieldText(activeTag), "Active");
  assert.equal(panelRecordFieldText([activeTag, draftTag, "Plain"]), "Active, Draft, Plain");

  // Strict schema rejects unknown keys, invalid tone, and empty icon.
  assert.equal(panelRecordTagFieldValueSchema.safeParse({ kind: "tag", label: "Bad", extra: true }).success, false);
  assert.equal(panelRecordTagFieldValueSchema.safeParse({ kind: "tag", label: "Bad", tone: "purple" }).success, false);
  assert.equal(panelRecordTagFieldValueSchema.safeParse({ kind: "tag", label: "Bad", icon: "" }).success, false);

  // panelFormOptionSchema supports the 5-level semantic tone taxonomy.
  for (const tone of ["default", "info", "success", "warning", "danger"] as const) {
    assert.equal(panelFormOptionSchema.safeParse({
      value: tone,
      label: tone,
      description: null,
      disabled: false,
      disabledReason: null,
      tone,
    }).success, true);
  }
  assert.equal(panelFormOptionSchema.safeParse({
    value: "bad",
    label: "Bad",
    description: null,
    disabled: false,
    disabledReason: null,
    tone: "muted",
  }).success, false);

  // ObjectList column supports headerTooltipKey and tagEffect ("light" | "plain").
  assert.deepEqual(panelObjectListColumnSchema.parse({
    key: "status",
    kind: "tags",
    headerTooltipKey: "status.tooltip",
    tagEffect: "plain",
  }), {
    key: "status",
    kind: "tags",
    headerTooltipKey: "status.tooltip",
    tagEffect: "plain",
  });
  assert.equal(panelObjectListColumnSchema.safeParse({ key: "status", tagEffect: "light" }).success, true);
  assert.equal(panelObjectListColumnSchema.safeParse({ key: "status", tagEffect: "dark" }).success, false);
  assert.equal(panelObjectListColumnSchema.safeParse({ key: "status", headerTooltipKey: "" }).success, false);

  // Column valueMap only carries display label and icon; semantic tone comes from the value or row.tones.
  assert.equal(panelObjectListColumnSchema.safeParse({
    key: "status",
    valueMap: {
      APPROVED: { labelKey: "status.approved", icon: "check-circle" },
    },
  }).success, true);
  assert.equal(panelObjectListColumnSchema.safeParse({
    key: "status",
    valueMap: {
      APPROVED: { labelKey: "status.approved", tone: "success" },
    },
  }).success, false);
});

test("ObjectList rowActions align conversation fields with PanelConversationEntry and unify 5-level tone", async () => {
  const { panelObjectListRowActionItemSchema, panelObjectListColumnSchema } = await import("./panel-projection");
  const { panelReadOperationJsonResultSchema } = await import("./panel-operations");

  // Conversation action accepts PanelConversationEntry-aligned fields and semantic tone.
  const validConv = panelObjectListRowActionItemSchema.parse({
    kind: "conversation",
    id: "ask",
    target: { kind: "id", id: "analyst-agent" },
    prefillKey: "gallery.askPrompt",
    submit: false,
    newSession: true,
    tone: "primary",
  });
  assert.equal(validConv.kind, "conversation");
  assert.deepEqual(validConv.target, { kind: "id", id: "analyst-agent" });
  assert.equal(validConv.prefillKey, "gallery.askPrompt");
  assert.equal(validConv.submit, false);
  assert.equal(validConv.newSession, true);
  assert.equal(validConv.tone, "primary");

  // All 5 semantic tones are accepted on row actions.
  for (const tone of ["default", "primary", "success", "warning", "danger"] as const) {
    const parsed = panelObjectListRowActionItemSchema.parse({
      kind: "operation",
      operation: "act",
      tone,
    });
    assert.equal(parsed.tone, tone);
  }

  // Mutual exclusion between prefill and prefillKey.
  assert.equal(
    panelObjectListRowActionItemSchema.safeParse({
      kind: "conversation",
      id: "ask",
      prefill: "Hello",
      prefillKey: "gallery.askPrompt",
    }).success,
    false,
  );

  // Legacy prompt/promptKey/agent and removed danger/primary booleans are rejected.
  assert.equal(
    panelObjectListRowActionItemSchema.safeParse({
      kind: "conversation",
      id: "ask",
      prompt: "Legacy",
    }).success,
    false,
  );
  assert.equal(
    panelObjectListRowActionItemSchema.safeParse({
      kind: "operation",
      operation: "remove",
      danger: true,
    }).success,
    false,
  );
  assert.equal(
    panelObjectListRowActionItemSchema.safeParse({
      kind: "local",
      id: "open",
      primary: true,
    }).success,
    false,
  );

  // ObjectListColumn.resultFrom accepts { operation, field? } and rejects toneField.
  const col = panelObjectListColumnSchema.parse({
    key: "status",
    resultFrom: { operation: "probe", field: "status" },
  });
  assert.deepEqual(col.resultFrom, { operation: "probe", field: "status" });
  assert.equal(
    panelObjectListColumnSchema.safeParse({
      key: "status",
      resultFrom: { operation: "probe", field: "status", toneField: "tone" },
    }).success,
    false,
  );

  // Read operation JSON results accept optional top-level `message` on all 3 variants and reject `summary`.
  assert.equal(
    panelReadOperationJsonResultSchema.parse({ kind: "json", value: { ok: true }, message: "Connected" }).message,
    "Connected",
  );
  assert.equal(
    panelReadOperationJsonResultSchema.parse({ kind: "markdown", markdown: "# OK", message: "Loaded report" }).message,
    "Loaded report",
  );
  assert.equal(
    panelReadOperationJsonResultSchema.parse({
      kind: "sections",
      sections: [{ id: "s1", label: "Overview", kind: "json", value: { ok: true } }],
      message: "Generated sections",
    }).message,
    "Generated sections",
  );
  assert.equal(
    panelReadOperationJsonResultSchema.safeParse({ kind: "json", value: { ok: true }, summary: "Legacy" }).success,
    false,
  );
});
