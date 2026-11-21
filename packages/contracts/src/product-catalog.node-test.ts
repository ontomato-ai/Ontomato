import assert from "node:assert/strict";
import test from "node:test";
import {
  copyProductCurrentRequestSchema,
  deleteProductCurrentQuerySchema,
  deleteProductCurrentResponseSchema,
  deleteProductPanelResponseSchema,
  productCatalogQuerySchema,
  productCurrentIdParamsSchema,
  productPanelInUseErrorSchema,
  productPanelListResponseSchema,
  productPanelUsedBySchema,
  productProjectionInUseErrorSchema,
  productProjectionListResponseSchema,
  productProjectionUsedBySchema,
} from "./product-panels";
import {
  changeProductDomainGrantRequestSchema,
  changeProductPanelDomainGrantResponseSchema,
  changeProductGrantRequestSchema,
  productGrantChangeResponseSchema,
  productGrantsResponseSchema,
} from "./product-governance";

test("the product catalog accepts HTTP queries and returns cursor pages of summaries", () => {
  assert.deepEqual(productCatalogQuerySchema.parse({}), {
    q: "", scope: "all", sort: "updated", limit: 20,
  });
  assert.deepEqual(productCatalogQuerySchema.parse({
    q: " Sales ", scope: "shared", sort: "name", cursor: "owner:cursor==", limit: "100",
  }), { q: "Sales", scope: "shared", sort: "name", cursor: "owner:cursor==", limit: 100 });
  assert.equal(productCatalogQuerySchema.safeParse({ limit: "101" }).success, false);

  const summary = {
    id: "sales", name: "Sales", description: "", ownerId: "owner", visibility: "private",
    updatedAt: "2026-11-20T00:00:00Z", revision: 1, editable: false,
  };
  const panels = { items: [{ ...summary, template: true }, { ...summary, id: "regular" }], nextCursor: null };
  const projections = {
    items: [{ ...summary, componentId: "@ontomato/sdk:ObjectList" }],
    nextCursor: "owner:cursor==",
  };
  assert.deepEqual(productPanelListResponseSchema.parse(panels), panels);
  assert.deepEqual(productProjectionListResponseSchema.parse(projections), projections);
  assert.equal(productProjectionListResponseSchema.safeParse(panels).success, false);
});

test("a panel name uses authored locale messages and falls back to its stored name", async () => {
  const { PANEL_NAME_MESSAGE_KEY, panelMessagesSchema, productPanelDisplayName } = await import("./product-panels");
  const messages = panelMessagesSchema.parse({
    "zh-CN": { [PANEL_NAME_MESSAGE_KEY]: "治理报告" },
    en: { [PANEL_NAME_MESSAGE_KEY]: "Governance report" },
  });
  const panel = { name: "Stored panel name", content: { html: "", module: "", messages } };
  assert.equal(productPanelDisplayName(panel, "zh-CN", "en"), "治理报告");
  assert.equal(productPanelDisplayName(panel, "fr", "en"), "Governance report");
  assert.equal(productPanelDisplayName(panel, "fr", "de"), panel.name);
  assert.equal(panelMessagesSchema.safeParse({ en: { [PANEL_NAME_MESSAGE_KEY]: "  " } }).success, false);
});

test("copy and deletion reuse current ID rules and require a valid revision for deletion", () => {
  assert.equal(copyProductCurrentRequestSchema.shape.id, productCurrentIdParamsSchema.shape.id);
  assert.deepEqual(copyProductCurrentRequestSchema.parse({ id: "copy", name: " Copy " }), { id: "copy", name: "Copy" });
  assert.deepEqual(deleteProductCurrentQuerySchema.parse({ revision: "2" }), { revision: 2 });
  for (const query of [{}, { revision: "0" }, { revision: "2.5" }]) {
    assert.equal(deleteProductCurrentQuerySchema.safeParse(query).success, false);
  }
  assert.deepEqual(deleteProductCurrentResponseSchema.parse({ success: true }), { success: true });
  const panelDeletion = { success: true, deletedProjectionIds: ["removed"], retainedProjectionIdsWithoutEdit: ["retained"] };
  assert.deepEqual(deleteProductPanelResponseSchema.parse(panelDeletion), panelDeletion);
});

test("a blocked deletion returns exactly the corresponding used-by details", () => {
  const projection = { panels: [{ id: "p", name: "Panel" }], hiddenCount: 2 };
  const panel = { ...projection, classNames: ["Account"], applicationEntries: [{ applicationId: "app", applicationName: "App", entryId: "entry", path: "/sales" }] };
  const error = { success: false, error: "In use", code: "PRODUCT_IN_USE" };
  assert.equal(productProjectionInUseErrorSchema.shape.details, productProjectionUsedBySchema);
  assert.equal(productPanelInUseErrorSchema.shape.details, productPanelUsedBySchema);
  assert.deepEqual(productProjectionInUseErrorSchema.parse({ ...error, details: projection }).details, projection);
  assert.deepEqual(productPanelInUseErrorSchema.parse({ ...error, details: panel }).details, panel);
  assert.equal(productPanelInUseErrorSchema.safeParse({ ...error, details: projection }).success, false);
  assert.equal(productProjectionUsedBySchema.safeParse({ ...projection, hiddenCount: -1 }).success, false);
  assert.equal(productPanelUsedBySchema.safeParse({ ...panel, classNames: [42] }).success, false);
});

test("product governance lists domain grants and changes domain sharing through its own request", () => {
  const domainGrant = { principalKind: "domain", principalId: "domain", verb: "use" };
  const grants = { grants: [domainGrant, { principalKind: "role", principalId: "editor", verb: "edit" }] };
  assert.deepEqual(productGrantsResponseSchema.parse(grants), grants);
  const revoke = { principalKind: "role", principalId: "editor", verb: "edit", remove: true };
  assert.deepEqual(changeProductGrantRequestSchema.parse(revoke), revoke);
  assert.equal(changeProductGrantRequestSchema.safeParse({ ...domainGrant, remove: true }).success, false);
  assert.deepEqual(changeProductDomainGrantRequestSchema.parse({ shared: false }), { shared: false });
  assert.deepEqual(productGrantChangeResponseSchema.parse({ success: true }), { success: true });
  const panelSharing = { success: true, skippedProjectionIds: ["restricted"] };
  assert.deepEqual(changeProductPanelDomainGrantResponseSchema.parse(panelSharing), panelSharing);
});

test("declares typed catalogue reads that reuse the current product records and list responses", async () => {
  const { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION, platformObjectTypes } = await import("./platform-object-types");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const { panelReadParameterSchemas } = await import("./panel-projection");
  const { currentPanelRecordSchema, currentProjectionRecordSchema } = await import("./product-panels");

  assert.equal(platformObjectTypes[PRODUCT_PROJECTION].reads?.query.result, "productProjectionList");
  assert.equal(platformObjectTypes[PRODUCT_PANEL].reads?.usedBy.result, "productPanelUsedBy");
  assert.equal(platformObjectTypes[APPLICATION].reads?.form.result, "panelFormDescription");
  assert.equal(panelReadResultSchemas.productProjectionRecord, currentProjectionRecordSchema);
  assert.equal(panelReadResultSchemas.productPanelRecord, currentPanelRecordSchema);
  assert.equal(panelReadParameterSchemas.productScope.safeParse("mine").success, true);
  assert.equal(panelReadParameterSchemas.productScope.safeParse("maintainable").success, false);
  assert.equal(panelReadParameterSchemas.applicationScope.safeParse("maintainable").success, true);
});

test("accepts a legacy hosted application entry without widening the panel registration response", async () => {
  const { applicationCatalogueEntriesSchema, applicationCatalogueRecordSchema } = await import("./application-catalogue");
  const { applicationPanelUsesResponseSchema } = await import("./product-panels");
  const entry = { path: "/applications/hosted-example" };
  const record = {
    id: "hosted-example", names: { en: "Existing hosted application" }, descriptions: {}, icon: "pages",
    source: "domain", canMaintain: true, canEditEntries: false, canGrant: true, entryCount: 0,
    entry, panelUses: [], groups: [],
  };
  assert.deepEqual(applicationCatalogueRecordSchema.parse(record).entry, entry);
  assert.equal(applicationCatalogueRecordSchema.safeParse({ ...record, entry: { ...entry, upstream: "private" } }).success, false);
  const entries = { applicationId: record.id, entry, panelUses: [] };
  assert.deepEqual(applicationCatalogueEntriesSchema.parse(entries), entries);
  assert.equal(applicationPanelUsesResponseSchema.safeParse(entries).success, false);
});

test("declares application creation and editing forms from their actual sources", async () => {
  const { APPLICATION, platformObjectTypes } = await import("./platform-object-types");
  const { missingRequiredReadParameters } = await import("./panel-projection");
  const { productProjectionInputSchema } = await import("./product-panels");
  const projection = {
    name: "Application forms", description: "", visibility: "private", componentId: "@ontomato/sdk:PanelData",
    inputs: { application: { kind: "object", objectType: APPLICATION } }, outputs: {}, config: {},
  };
  const draft = { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "createForm", params: {} };
  const edit = (section: string) => ({
    source: { object: { input: "application" } }, read: "form", params: { section: { literal: section } },
  });

  assert.equal(productProjectionInputSchema.safeParse({
    ...projection, data: { draft, identity: edit("identity"), entries: edit("entries") },
  }).success, true);
  assert.equal(productProjectionInputSchema.safeParse({ ...projection, data: { wrong: edit("create") } }).success, false);
  assert.deepEqual(missingRequiredReadParameters(platformObjectTypes[APPLICATION].reads!.form, {}), ["section"]);
});

test("declares grant reads for both resource classes and a panel-only template filter", async () => {
  const { PRODUCT_PANEL, PRODUCT_PROJECTION, platformObjectTypes } = await import("./platform-object-types");
  const { panelReadResultSchemas } = await import("./panel-operations");
  const { panelReadParameterSchemas } = await import("./panel-projection");

  for (const type of [PRODUCT_PANEL, PRODUCT_PROJECTION]) {
    assert.deepEqual(platformObjectTypes[type].reads?.grants,
      { source: "object", parameterMode: "fixed", params: {}, result: "productCatalogueGrants" });
  }
  assert.deepEqual(panelReadResultSchemas.productCatalogueGrants.parse({ grants: [], shared: false }), { grants: [], shared: false });
  const panelQuery = platformObjectTypes[PRODUCT_PANEL].reads?.query;
  assert.equal(panelQuery?.parameterMode === "fixed" && panelQuery.params.template, "productTemplate");
  assert.equal(panelReadParameterSchemas.productTemplate.safeParse(true).success, true);
  assert.equal(panelReadParameterSchemas.productTemplate.safeParse("true").success, false);
  const projectionQuery = platformObjectTypes[PRODUCT_PROJECTION].reads?.query;
  assert.equal(projectionQuery?.parameterMode === "fixed" && Object.hasOwn(projectionQuery.params, "template"), false);
});
