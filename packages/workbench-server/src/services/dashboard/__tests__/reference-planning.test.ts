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
// The rejected reply is logged as JSON so it can be inspected later; the wording around it is free.
function loggedOutput() {
  const message = model.warn.mock.calls[0][0] as string;
  return JSON.parse(message.slice(message.indexOf("{")));
}
beforeEach(() => { vi.resetAllMocks(); });

describe("metric reference planning output boundary", () => {
  it("reports the omitted metrics path from the recorded reply shape", async () => {
    // Production returned charts but omitted the empty metrics array; identifiers and labels are anonymized.
    const raw = JSON.stringify({ name: "Overview", groups: [{ title: "Categories", charts }] });
    model.run.mockResolvedValueOnce(raw);
    const api = client();
    await expect(planReferenceDashboard([dataset], api as unknown as DashboardMetricClient)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID",
      details: { stage: "dashboard.reference-planner.system", issues: [expect.objectContaining({ path: ["groups", 0, "metrics"] })] },
    });
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

  it("excludes numeric cards and single-value charts for a multi-row published metric before settlement", async () => {
    const api = client();
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{
      title: "Counts", charts: [charts[0]], metrics: [{ datasetKey: "source-1", name: "First amount" }],
    }] }));
    await expect(planReferenceDashboard([dataset], api as unknown as DashboardMetricClient)).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("groups.0.metrics"),
    });
    const input = JSON.parse(model.run.mock.calls[0][0].message);
    expect(input.datasets[0].cardCapabilities).toMatchObject({ metric: false, canCalculate: false });
    expect(input.datasets[0].cardCapabilities.charts).not.toContain("gauge");
    expect(input.datasets[0].cardCapabilities.charts).not.toContain("liquid-fill");
    expect(api.settle).not.toHaveBeenCalled();
  });

  it.each([
    { ...charts[0], chartType: "gauge" },
    { ...charts[0], calculation: "Sum the returned rows" },
  ])("rejects a forbidden published-metric chart at the planning boundary", async chart => {
    const api = client();
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{ title: "Counts", charts: [chart], metrics: [] }] }));
    await expect(planReferenceDashboard([dataset], api as unknown as DashboardMetricClient)).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("groups.0.charts.0"),
    });
    expect(api.settle).not.toHaveBeenCalled();
  });

  it("restricts numeric cards to the eligible dataset even when another dataset has one row", async () => {
    const api = client();
    const single = { ...dataset, datasetKey: "single", data: [dataset.data[0]] };
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{
      title: "Counts", charts: [], metrics: [{ datasetKey: "source-1", name: "Wrong source" }],
    }] }));
    await expect(planReferenceDashboard([dataset, single], api as unknown as DashboardMetricClient)).rejects.toMatchObject({
      code: "DASHBOARD_PLAN_INVALID", message: expect.stringContaining("groups.0.metrics.0.datasetKey"),
    });
    expect(api.settle).not.toHaveBeenCalled();
  });

  it("keeps single-row published metrics available to numeric cards without adding a calculation", async () => {
    const single = { ...dataset, data: [dataset.data[0]] };
    const api = client();
    api.execute.mockResolvedValue({ ...output, rows: single.data });
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{
      title: "Counts", charts: [], metrics: [{ datasetKey: "source-1", name: "Amount" }],
    }] })).mockResolvedValueOnce('{"fields":{"value":"amount"}}');
    const result = await planReferenceDashboard([single], api as unknown as DashboardMetricClient);
    expect(result.groups[0].metrics).toHaveLength(1);
    expect(api.settle.mock.calls[0][0]).toMatchObject({ outputShape: { cardKind: "metric", chartType: "metric" } });
    expect(api.settle.mock.calls[0][0]).not.toHaveProperty("calculation");
  });

  it("allows a package to generate a separate single-row summary and declares chart purpose to settlement", async () => {
    const mutable: DashboardDatasetInput = { ...dataset, recipe: {
      kind: "package", parameters: {}, columnLabels: { category: "Category", amount: "Amount" },
      package: { manifest: {
        schema: "ontomato.query-package.v1", entry: { kind: "dsl", query: "main" }, queries: { main: "query.json" },
        modules: [], parameterDefs: [], parameterBindings: [], computation: null,
      }, files: [{ path: "query.json", content: "{}" }] },
    } };
    const api = client();
    api.execute.mockResolvedValueOnce(output).mockResolvedValueOnce({ ...output, rows: [{ category: "Total", amount: 7 }] });
    model.run.mockResolvedValueOnce(JSON.stringify({ name: "Overview", groups: [{
      title: "Counts", charts: [charts[0]], metrics: [{ datasetKey: "source-1", name: "Total", calculation: "Sum amount" }],
    }] })).mockResolvedValueOnce('{"fields":{"xAxis":"category","yAxis":"amount"}}')
      .mockResolvedValueOnce('{"fields":{"value":"amount"}}');
    const result = await planReferenceDashboard([mutable], api as unknown as DashboardMetricClient);
    expect(result.groups[0].charts).toHaveLength(1);
    expect(result.groups[0].metrics).toHaveLength(1);
    expect(api.settle.mock.calls[0][0]).toMatchObject({ outputShape: { cardKind: "chart", chartType: "bar" } });
    expect(api.settle.mock.calls[1][0]).toMatchObject({ calculation: "Sum amount", outputShape: { cardKind: "metric" } });
  });

  it("keeps mapping output strict and reports the required fields path", async () => {
    const raw = '{"formats":{},"unexpected":"not accepted"}';
    model.run.mockResolvedValueOnce(raw);
    await expect(mapMetricFields("bar", "Counts", output)).rejects.toMatchObject({
      status: 502, code: "DASHBOARD_PLAN_INVALID",
      details: { stage: "dashboard.reference-fields.system", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["fields"] }), expect.objectContaining({ code: "unrecognized_keys", keys: ["unexpected"] }),
      ]) },
    });
    expect(loggedOutput()).toMatchObject({ stage: "dashboard.reference-fields.system", rawOutput: raw });
  });

  it("identifies the JSON parsing failure", async () => {
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
      status: 502, code: "DASHBOARD_PLAN_INVALID",
      details: { stage: "dashboard.reference-fields.system", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["fields", "xAxis"] }),
        expect.objectContaining({ path: ["fields", "yAxis"] }),
        expect.objectContaining({ path: ["fields"], code: "unrecognized_keys", keys: ["角色", "数值"] }),
      ]) },
    });
    expect(loggedOutput()).toMatchObject({ stage: "dashboard.reference-fields.system", rawOutput: raw });
  });

  it("accepts optional roles and array roles without making them interchangeable", async () => {
    model.run.mockResolvedValueOnce('{"fields":{"name":"category","value":"amount"}}')
      .mockResolvedValueOnce('{"fields":{"xAxis":"category","barSeries":["amount"],"lineSeries":"amount"}}');
    await expect(mapMetricFields("pie", "Composition", output)).resolves.toMatchObject({ fields: { name: "category", value: "amount" } });
    await expect(mapMetricFields("bar-line", "Comparison", output)).resolves.toMatchObject({ fields: { barSeries: ["amount"] } });
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
