import { describe, expect, it } from "vitest";
import { createObjectView, createViewWidget, objectViewDependencies, objectViewDocumentSchema, objectViewEmbedSchema, resolveViewBinding, resolveViewInputs } from "@ontomato/contracts/object-views";

describe("Object View embedding contract", () => {
  it("normalizes a declaration and rejects invalid revisions and object identities", () => {
    const declaration = { kind: "objectView", view: { className: "Order" }, object: { primaryKey: "00123" } };
    expect(objectViewEmbedSchema.parse(declaration)).toMatchObject({ view: { form: "full", revision: "published" }, inputs: {}, navigation: "host" });
    expect(objectViewEmbedSchema.safeParse({ ...declaration, view: { className: "Order", revision: 0 } }).success).toBe(false);
    expect(objectViewEmbedSchema.safeParse({ ...declaration, object: { primaryKey: "" } }).success).toBe(false);
  });
  it("validates host inputs independently from internal variables", () => {
    const document = createObjectView("Order");
    document.inputs = { period: { type: "string", description: "", required: true, default: "month", enum: ["month", "year"] } };
    expect(resolveViewInputs(document)).toEqual({ period: "month" });
    expect(resolveViewBinding({ source: "input", path: "period" }, {}, { period: "internal" }, resolveViewInputs(document))).toBe("month");
    expect(() => resolveViewInputs(document, { period: "week" })).toThrow("Invalid view input");
    expect(() => resolveViewInputs(document, { period: null })).toThrow("Missing view input");
    expect(() => resolveViewInputs(document, { unexpected: true })).toThrow("Unknown view input");
    document.inputs.period.default = 2;
    expect(objectViewDocumentSchema.safeParse(document).success).toBe(false);
  });
  it("collects unique dependencies from the actual widget kinds", () => {
    const document = createObjectView("Order");
    const metric = createViewWidget("metric"); metric.resourceId = "summary";
    const chart = createViewWidget("chart"); chart.resourceId = "summary";
    const action = createViewWidget("action"); action.resourceId = "approve";
    const table = createViewWidget("table"); table.targetClass = "Customer";
    document.tabs[0].sections[0].widgets = [metric, chart, action, table];
    expect(objectViewDependencies(document)).toEqual({ metricViews: ["summary"], actions: ["approve"], skills: ["echarts"], classes: ["Customer", "Order"] });
  });
});
