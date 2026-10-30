import { describe, expect, it, vi, afterEach } from "vitest";
import { createObjectView, createViewWidget, objectViewDocumentSchema, readViewPath, resolveViewBinding, viewConditionMatches } from "@ontomato/contracts/object-views";
import { createManagerClient } from "../api";
import { englishMessages } from "../i18n";
import { parseActionValue } from "../object-views/action-values";
import { instanceName } from "../object-views/instance-name";

afterEach(() => { vi.unstubAllGlobals(); });
describe("object view bindings and documents", () => {
  it("uses enabled business keys for names and never falls back to technical identifiers", () => {
    const attrs = [{ name: "id" }, { name: "code", bizzkey: true }, { name: "org_name", bizzkey: true }];
    expect(instanceName(attrs, { id: "internal-1", code: "business-code", org_name: "Business name" })).toBe("Business name");
    expect(instanceName([{ name: "id" }], { id: "internal-1" })).toBe("—");
    expect(instanceName(attrs, { id: "internal-1", code: "business-code", org_name: null })).toBe("—");
    expect(instanceName([{ name: "name", bizzkey: true, enable: false }], { name: "Hidden" })).toBe("—");
  });
  it("converts engine parameter types without changing textual identifiers", () => {
    expect(parseActionValue("00123", "TYPE_STRING")).toBe("00123");
    expect(parseActionValue("12.5", "TYPE_NUMBER")).toBe(12.5);
    expect(parseActionValue('[1,2]', "TYPE_NUMBER_ARRAY")).toEqual([1, 2]);
    expect(parseActionValue('["001"]', "TYPE_STRING_ARRAY")).toEqual(["001"]);
    expect(() => parseActionValue('"12"', "TYPE_NUMBER")).toThrow();
    expect(() => parseActionValue('["12"]', "TYPE_NUMBER_ARRAY")).toThrow();
  });
  it("binds a selected row to downstream parameters and conditions without evaluating code", () => {
    const object = { id: "order-1", status: "open" };
    const variables = { selected: { product: "product-2" }, filter: "active" };
    expect(resolveViewBinding({ source: "variable", path: "selected.product" }, object, variables)).toBe("product-2");
    expect(resolveViewBinding({ source: "object", path: "id" }, object, variables)).toBe("order-1");
    expect(viewConditionMatches({ binding: { source: "object", path: "status" }, operator: "eq", value: "open" }, object, variables)).toBe(true);
    expect(viewConditionMatches({ binding: { source: "variable", path: "missing" }, operator: "present", value: "" }, object, variables)).toBe(false);
    expect(readViewPath({}, "constructor.constructor")).toBeUndefined();
    expect(readViewPath({ inherited: Object.create({ secret: "hidden" }) }, "inherited.secret")).toBeUndefined();
  });
  it("rejects duplicate component identities and invalid layouts", () => {
    const document = createObjectView("Order");
    document.tabs[0].sections[0].widgets.push({ ...document.tabs[0].sections[0].widgets[0] });
    expect(objectViewDocumentSchema.safeParse(document).success).toBe(false);
    document.tabs[0].sections[0].widgets = [createViewWidget("metric")];
    document.tabs[0].sections[0].widgets[0].span = 13;
    expect(objectViewDocumentSchema.safeParse(document).success).toBe(false);
  });
});

describe("object view requests", () => {
  function client() {
    return createManagerClient({ apiBase: "/api", credential: { type: "token", token: "test-token" }, locale: "en", messages: englishMessages,
      dataFallbacks: { noBusinessDescription: "", unnamedAsset: "" } }, () => {});
  }
  it("keeps optimistic revision and form on save and surfaces conflicts", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: false, message: "The view changed. Reload before saving or publishing." }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(client().saveObjectView(createObjectView("Order"), "panel", 7, "Update layout")).rejects.toThrow("The view changed");
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ className: "Order", form: "panel", expectedRevision: 7, description: "Update layout" });
  });
  it("keeps action strings intact and sends multipart parameters through the host credential", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal("fetch", fetch);
    await client().executeViewAction("action-id", { order: "00123", quantity: 4 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/data-query/action/execute");
    expect((init.headers as Record<string, string>).tk).toBe("test-token");
    expect(JSON.parse(String((init.body as FormData).get("param")))).toEqual({ order: "00123", quantity: 4 });
  });
  it("builds bounded, directional relationship reads using the permission-aware DSL route", async () => {
    const calls: Array<{ url: string; body: Record<string, any> }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith("getMetas")) return new Response(JSON.stringify({ data: {
        classDef: ["Order", "Line"].map(className => ({ className, attrs: [{ name: "id", primaryKey: true }, { name: "name" }] })),
        relationDef: [{ relationship: "contains", fromclass: "Order", toclass: "Line" }],
      } }));
      return new Response(JSON.stringify({ data: [{ answer: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })) }] }));
    });
    const result = await client().loadViewLinks("Line", "line-1", "contains", "incoming", 50);
    expect(result).toMatchObject({ targetClass: "Order", targetPk: "id", hasMore: true });
    expect(result.rows).toHaveLength(50);
    const request = calls[1];
    expect(request.url).toBe("/api/data-query/dsl/executeV1");
    const step = request.body.answer.steps[0];
    expect(step.graph.patterns[0].relationship).toEqual([{ from: 1, to: 0, type: ["contains"] }]);
    expect(step.output.limit).toEqual({ count: 51, offset: 50 });
    expect(step.graph.patterns[0].objects[0].conditions.properties.value).toBe("line-1");
  });
});
