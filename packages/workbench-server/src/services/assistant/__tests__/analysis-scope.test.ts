import { afterEach, expect, it, vi } from "vitest";
import { adjustAnalysisScope } from "../analysis-scope";
import { assistantService } from "../service";
vi.mock("../service", () => ({ assistantService: { dataset: vi.fn(), artifact: vi.fn(), start: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); });
const owner = { domainId: "domain", userId: "user" };

it("requeries from accepted source filters, preserving the unchanged scope and requested run ID", async () => {
  vi.mocked(assistantService.dataset).mockResolvedValue({ payload: { question: "Active staff aged 60+", assumptions: ["Current staff"], truncation: null, sourceAnalysis: { filters: [{ id: "age", label: "Age ≥ 60", expression: "age >= 60" }, { id: "status", label: "Active", expression: "status = active" }] } } } as never);
  vi.mocked(assistantService.artifact).mockResolvedValue({ runId: "source-run", path: "outputs/staff.dataset.json" } as never);
  await adjustAnalysisScope("session", "artifact", owner, {}, { filterId: "age", replacement: "Age ≥ 55" }, "new-run");
  expect(assistantService.start).toHaveBeenCalledWith("session", "new-run", expect.stringContaining('"expression":"status = active"'), owner, {});
  expect(assistantService.start).toHaveBeenCalledWith("session", "new-run", expect.stringContaining("Age ≥ 55"), owner, {});
});

it("rejects a fabricated source filter without starting another run", async () => {
  vi.mocked(assistantService.dataset).mockResolvedValue({ payload: { question: "Staff", assumptions: [], truncation: null, sourceAnalysis: { filters: [] } } } as never);
  await expect(adjustAnalysisScope("session", "artifact", owner, {}, { filterId: "made-up", replacement: "All" })).rejects.toMatchObject({ code: "INVALID_SCOPE_CHANGE" });
  expect(assistantService.start).not.toHaveBeenCalled();
});
