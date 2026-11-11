import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardDatasetInput } from "../types";
import type { DashboardMetricClient } from "../metric-client";
import { mapMetricFields, planReferenceDashboard } from "../reference-planning";
import { requireMatchingOutput } from "../metric-data";

const model = vi.hoisted(() => ({ run: vi.fn(), warn: vi.fn() }));
vi.mock("../../../platform/agent-runtime/runtime", () => ({ runAuxiliary: model.run }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: (key: string) => key }));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ warn: model.warn }) }));

const dataset = {
  datasetKey: "source-1", subQuestion: "Counts by category",
  recipe: { kind: "metric", metricId: "metric-1", revision: "revision-1", parameters: {} },
  columns: [{ key: "category", label: "Category", type: null }, { key: "amount", label: "Amount", type: null }],
  data: [{ category: "One", amount: 3 }, { category: "Two", amount: 4 }],
} satisfies DashboardDatasetInput;
const output = { columns: dataset.columns, rows: dataset.data, truncation: null };
const charts = [
  { datasetKey: "source-1", name: "Counts by category", chartType: "bar" },
  { datasetKey: "source-1", name: "Category composition", chartType: "pie" },
];
function client() {
  return {
    credentials: { locale: "en" },
    settle: vi.fn().mockResolvedValue({ metricId: "metric-1", parameters: {}, revision: "revision-1" }),
    execute: vi.fn().mockResolvedValue(output),
  };
}
function requestedSchema(index = 0) {
  const prompt = model.run.mock.calls[index][0].systemPrompt as string;
  return JSON.parse(prompt.split("Output JSON Schema:\n")[1]);
}
function loggedOutput() {
  const message = model.warn.mock.calls[0][0] as string;
  return JSON.parse(message.slice("Dashboard planning rejected model output: ".length));
}
beforeEach(() => { vi.resetAllMocks(); });

describe("metric reference planning output boundary", () => {
  it("declares both required card arrays and reports the omitted metrics path from the recorded reply shape", async () => {
    // Production returned charts but omitted the empty metrics array; identifiers and labels are anonymized.
    const raw = JSON.stringify({ name: "Overview", groups: [{ title: "Categories", charts }] });
    model.run.mockResolvedValueOnce(raw);
    const api = client();
    await expect(planReferenceDashboard([dataset], api as unknown as DashboardMetricClient)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID",
      message: expect.stringContaining("groups.0.metrics: Required"),
      details: { stage: "dashboard.reference-planner.system", issues: [expect.objectContaining({ path: ["groups", 0, "metrics"] })] },
    });
    const group = requestedSchema().anyOf[0].properties.groups.items;
    expect(group.required).toEqual(expect.arrayContaining(["charts", "metrics"]));
    expect(group.additionalProperties).toBe(false);
    expect(loggedOutput()).toMatchObject({ stage: "dashboard.reference-planner.system", rawOutput: raw });
    expect(api.settle).not.toHaveBeenCalled();
  });

  it("accepts a charts-only group when its required metrics array is explicitly empty", async () => {
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{ title: "Categories", charts, metrics: [] }] }))
      .mockResolvedValueOnce('{"fields":{"xAxis":"category","yAxis":"amount"}}')
      .mockResolvedValueOnce('{"fields":{"name":"category","value":"amount"}}');
    const result = await planReferenceDashboard([dataset], client() as unknown as DashboardMetricClient);
    expect(result.groups[0].charts).toHaveLength(2);
    expect(result.groups[0].metrics).toEqual([]);
    expect(model.warn).not.toHaveBeenCalled();
  });

  it("keeps mapping output strict and logs its raw reply with the required fields path", async () => {
    const raw = '{"formats":{},"unexpected":"not accepted"}';
    model.run.mockResolvedValueOnce(raw);
    await expect(mapMetricFields("bar", "Counts", output)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("fields: Required"),
      details: { stage: "dashboard.reference-fields.system", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["fields"] }), expect.objectContaining({ code: "unrecognized_keys", keys: ["unexpected"] }),
      ]) },
    });
    const mapping = requestedSchema().anyOf[0];
    expect(mapping.required).toEqual(["fields"]);
    expect(mapping.additionalProperties).toBe(false);
    expect(loggedOutput()).toMatchObject({ stage: "dashboard.reference-fields.system", rawOutput: raw });
  });

  it("preserves malformed JSON in the log and identifies the JSON parsing failure", async () => {
    model.run.mockResolvedValueOnce('{"fields":');
    await expect(mapMetricFields("bar", "Counts", output)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("JSON:"),
    });
    expect(loggedOutput().rawOutput).toBe('{"fields":');
  });

  it("rejects the recorded translated-role reply during creation as a planning error", async () => {
    const raw = '{"fields":{"角色":"category","数值":"amount"},"formats":{"amount":{"kind":"number","decimals":0}}}';
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{ title: "Categories", charts: [charts[0]], metrics: [] }] }))
      .mockResolvedValueOnce(raw);
    await expect(planReferenceDashboard([dataset], client() as unknown as DashboardMetricClient)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("fields.xAxis: Required"),
      details: { stage: "dashboard.reference-fields.system", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["fields", "xAxis"] }),
        expect.objectContaining({ path: ["fields", "yAxis"] }),
        expect.objectContaining({ path: ["fields"], code: "unrecognized_keys", keys: ["角色", "数值"] }),
      ]) },
    });
    const fields = requestedSchema(1).anyOf[0].properties.fields;
    expect(fields.required).toEqual(["xAxis", "yAxis"]);
    expect(fields.properties.xAxis.type).toBe("string");
    expect(fields.properties.yAxis.type).toBe("string");
    expect(fields.additionalProperties).toBe(false);
    expect(loggedOutput()).toMatchObject({ stage: "dashboard.reference-fields.system", rawOutput: raw });
  });

  it("declares optional roles and array roles without making them interchangeable", async () => {
    model.run.mockResolvedValueOnce('{"fields":{"name":"category","value":"amount"}}')
      .mockResolvedValueOnce('{"fields":{"xAxis":"category","barSeries":["amount"],"lineSeries":"amount"}}');
    await expect(mapMetricFields("pie", "Composition", output)).resolves.toMatchObject({ fields: { name: "category", value: "amount" } });
    const pieFields = requestedSchema().anyOf[0].properties.fields;
    expect(pieFields.required).toEqual(["name", "value"]);
    expect(pieFields.properties.share.type).toBe("string");
    await expect(mapMetricFields("bar-line", "Comparison", output)).resolves.toMatchObject({ fields: { barSeries: ["amount"] } });
    const barLineFields = requestedSchema(1).anyOf[0].properties.fields;
    expect(barLineFields.required).toEqual(["xAxis", "barSeries", "lineSeries"]);
    expect(barLineFields.properties.barSeries).toMatchObject({ type: "array", minItems: 1, items: { type: "string" } });
    expect(barLineFields.properties.lineSeries.type).toBe("string");
    expect(barLineFields.additionalProperties).toBe(false);
  });

  it.each([
    ["bar-line", { xAxis: "category", barSeries: "amount", lineSeries: "amount" }, "barSeries"],
    ["bar", { xAxis: ["category"], yAxis: "amount" }, "xAxis"],
  ])("rejects incorrect role cardinality for %s", async (chartType, fields, role) => {
    model.run.mockResolvedValueOnce(JSON.stringify({ fields }));
    await expect(mapMetricFields(chartType, "Counts", output)).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", details: { issues: expect.arrayContaining([
        expect.objectContaining({ path: ["fields", role], code: "invalid_type" }),
      ]) },
    });
  });

  it("reports a missing output column in a new mapping as a planning error with its role path", async () => {
    const raw = '{"fields":{"xAxis":"category","yAxis":"missing"}}';
    model.run.mockResolvedValueOnce(raw);
    await expect(mapMetricFields("bar", "Counts", output)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("fields.yAxis: Missing output column: missing"),
    });
    expect(loggedOutput().rawOutput).toBe(raw);
  });

  it("checks numeric and scalar results at the planning boundary", async () => {
    model.run.mockResolvedValueOnce('{"fields":{"xAxis":"category","yAxis":"amount"}}')
      .mockResolvedValueOnce('{"fields":{"value":"amount"}}');
    await expect(mapMetricFields("bar", "Counts", { ...output, rows: [{ category: "One", amount: "not numeric" }] })).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("fields.yAxis: Output column must be numeric: amount"),
    });
    await expect(mapMetricFields("metric", "Total", output)).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("fields.value: This card requires a single metric result row"),
    });
  });

  it("keeps output mismatch errors for saved cards when their referenced columns disappear", () => {
    const saved = {
      id: "saved-card", name: "Counts", chartType: "bar",
      query: { kind: "metric" as const, metricId: "metric-1", parameters: {} },
      fields: { xAxis: "category", yAxis: "missing" },
    };
    expect(() => requireMatchingOutput(saved, output)).toThrow(expect.objectContaining({
      status: 422, code: "CARD_OUTPUT_MISMATCH", message: expect.stringContaining("fields.yAxis"),
      details: expect.objectContaining({ cardId: "saved-card", fields: ["missing"] }),
    }));
  });
});
