import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { DatasetPayload } from "@ontomato/contracts/data-retrieval";
import { drilldownGroups, readDrilldown, startDrilldown } from "../drilldown";
import { assistantService } from "../service";

vi.mock("../service", () => ({ assistantService: { dataset: vi.fn(), artifact: vi.fn(), start: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); });
const examples = JSON.parse(readFileSync(new URL("../../../../../contracts/examples/query-subgraphs.json", import.meta.url), "utf8"));
const owner = { domainId: "domain", userId: "user" };
function payload(value: unknown = "Information") {
  return { question: "Active employee payroll by department", sourceAnalysis: examples.singleDsl,
    rows: [{ department: value, totalSalary: 2300 }], assumptions: ["Current staff"], decisionIds: ["decision"],
    truncation: { truncated: true }, execution: { receiptId: "receipt" } } as unknown as DatasetPayload;
}
function source(value: unknown = "Information") {
  vi.mocked(assistantService.dataset).mockResolvedValue({ payload: payload(value), source: { retrievalId: "retrieval" } } as never);
  vi.mocked(assistantService.artifact).mockResolvedValue({ runId: "source-run", path: "outputs/payroll.dataset.json" } as never);
}

it("maps execution-owned group outputs to ontology fields and excludes aggregate values", () => {
  expect(drilldownGroups(payload())).toEqual([{ key: "department", label: "Department", className: "/Department", attrName: "name" }]);
  expect(() => drilldownGroups({ ...payload(), sourceAnalysis: examples.pythonMerge })).toThrow();
  const graph = structuredClone(examples.singleDsl);
  graph.nodes = graph.nodes.filter((node: { id: string }) => node.id !== "out-department");
  expect(() => drilldownGroups({ ...payload(), sourceAnalysis: graph })).toThrow();
  expect(() => drilldownGroups({ ...payload(), sourceAnalysis: undefined })).toThrow();
  const multiple = structuredClone(examples.singleDsl);
  multiple.nodes.push({ ...multiple.nodes.find((node: { id: string }) => node.id === "salary-sum"), id: "other-measure" });
  expect(() => drilldownGroups({ ...payload(), sourceAnalysis: multiple })).toThrow();
});

it.each([0, false, null, "001"])("preserves the exact group value %s in a fresh detail query", async (value) => {
  source(value);
  const preview = await readDrilldown("session", "artifact", owner, 0);
  expect(preview.groups[0]!.value).toBe(value);
  expect(preview.filters).toEqual(["Active employees only"]);
  expect(preview.truncated).toBe(true);
  await startDrilldown("session", "artifact", owner, {}, 0, "retry-run");
  expect(assistantService.start).toHaveBeenCalledWith("session", "retry-run", expect.stringContaining('"attrName":"name","value":' + JSON.stringify(value)), owner, {});
  const message = vi.mocked(assistantService.start).mock.calls[0]![2];
  expect(message).toContain('"decisionIds":["decision"]');
  expect(message).toContain("e.status = 'active'");
  expect(message).toContain("not write authorization");
  expect(message).toContain("fresh read, not a historical snapshot");
});

it("resolves row values server-side and refuses an unavailable row before admitting a query", async () => {
  source();
  await expect(startDrilldown("session", "artifact", owner, {}, 1, "run")).rejects.toMatchObject({ code: "INVALID_DRILLDOWN_ROW" });
  expect(assistantService.start).not.toHaveBeenCalled();
  vi.mocked(assistantService.dataset).mockRejectedValue(new Error("Not authorized"));
  await expect(readDrilldown("session", "artifact", owner, 0)).rejects.toThrow("Not authorized");
});
