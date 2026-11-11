import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardDatasetInput } from "../types";
import type { DashboardMetricClient } from "../metric-client";
import { mapMetricFields, planReferenceDashboard } from "../reference-planning";

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
function requestedSchema() {
  const prompt = model.run.mock.calls[0][0].systemPrompt as string;
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
});
