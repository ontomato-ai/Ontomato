import assert from "node:assert/strict";
import test from "node:test";
import * as detail from "./object-detail";

test("object detail mapping writes use one class and one panel in the caller's domain", () => {
  assert.deepEqual(detail.objectDetailClassParamsSchema.parse({ className: "sales:Account" }), { className: "sales:Account" });
  assert.deepEqual(detail.setObjectDetailRequestSchema.parse({ panelId: "panel-accounts" }), { panelId: "panel-accounts" });
  assert.equal(detail.objectDetailClassParamsSchema.safeParse({ className: "" }).success, false);
  assert.equal(detail.setObjectDetailRequestSchema.safeParse({ panelId: "" }).success, false);
  assert.equal(detail.setObjectDetailRequestSchema.safeParse({ panelId: "panel-accounts", domainId: "another-domain" }).success, false);
});

test("only an explicit unconfigured result allows the default detail", () => {
  assert.deepEqual(detail.objectDetailResponseSchema.parse({ panelId: "panel-accounts" }), { panelId: "panel-accounts" });
  assert.deepEqual(detail.objectDetailResponseSchema.parse({ panelId: null }), { panelId: null });
  assert.equal(detail.objectDetailResponseSchema.safeParse({}).success, false);
  assert.equal(detail.objectDetailResponseSchema.safeParse({ panelId: null, error: "PRODUCT_FORBIDDEN" }).success, false);
  assert.deepEqual(detail.setObjectDetailResponseSchema.parse({ panelId: "panel-accounts" }), { panelId: "panel-accounts" });
  assert.equal(detail.setObjectDetailResponseSchema.safeParse({ panelId: null }).success, false);
  assert.deepEqual(detail.clearObjectDetailResponseSchema.parse({ panelId: null }), { panelId: null });
  assert.equal(detail.clearObjectDetailResponseSchema.safeParse({ panelId: "panel-accounts" }).success, false);
});

test("the reverse lookup returns the classes that use a detail panel", () => {
  assert.deepEqual(detail.objectDetailPanelParamsSchema.parse({ panelId: "panel-accounts" }), { panelId: "panel-accounts" });
  assert.deepEqual(detail.objectDetailUsedByResponseSchema.parse({ classNames: ["sales:Account"] }), { classNames: ["sales:Account"] });
  assert.deepEqual(detail.objectDetailUsedByResponseSchema.parse({ classNames: [] }), { classNames: [] });
});

test("the internal mapping lookup takes an explicit domain and class", () => {
  const query = { domainId: "domain-a", className: "sales:Account" };
  assert.deepEqual(detail.objectDetailInternalQuerySchema.parse(query), query);
  assert.equal(detail.objectDetailInternalQuerySchema.safeParse({ className: "sales:Account" }).success, false);
  assert.equal(detail.objectDetailClassParamsSchema.safeParse(query).success, false);
});
