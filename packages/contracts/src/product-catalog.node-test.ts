import assert from "node:assert/strict";
import test from "node:test";
import {
  copyProductCurrentRequestSchema,
  deleteProductCurrentQuerySchema,
  deleteProductCurrentResponseSchema,
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
  const panels = { items: [summary], nextCursor: null };
  const projections = {
    items: [{ ...summary, componentId: "@ontomato/sdk:ObjectList" }],
    nextCursor: "owner:cursor==",
  };
  assert.deepEqual(productPanelListResponseSchema.parse(panels), panels);
  assert.deepEqual(productProjectionListResponseSchema.parse(projections), projections);
  assert.equal(productProjectionListResponseSchema.safeParse(panels).success, false);
});

test("copy and deletion reuse current ID rules and require a valid revision for deletion", () => {
  assert.equal(copyProductCurrentRequestSchema.shape.id, productCurrentIdParamsSchema.shape.id);
  assert.deepEqual(copyProductCurrentRequestSchema.parse({ id: "copy", name: " Copy " }), { id: "copy", name: "Copy" });
  assert.deepEqual(deleteProductCurrentQuerySchema.parse({ revision: "2" }), { revision: 2 });
  for (const query of [{}, { revision: "0" }, { revision: "2.5" }]) {
    assert.equal(deleteProductCurrentQuerySchema.safeParse(query).success, false);
  }
  assert.deepEqual(deleteProductCurrentResponseSchema.parse({ success: true }), { success: true });
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
});
