import { afterEach, expect, it, vi } from "vitest";
import { adjustAnalysisScope, scopeChangeSchema } from "../analysis-scope";
import { assistantService } from "../service";
vi.mock("../service", () => ({ assistantService: { dataset: vi.fn(), artifact: vi.fn(), start: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); });
const owner = { domainId: "domain", userId: "user" };

it("starts one new query for multiple changes with the full accepted query and output requirements", async () => {
  const payload = { question: "Active staff aged 60+", assumptions: ["Current staff"], truncation: null,
    sourceAnalysis: { filters: [{ id: "age", label: "Age ≥ 60", expression: "age >= 60" }, { id: "status", label: "Active", expression: "status = active" }] },
    columns: [{ key: "name", label: "Name" }], recipe: { kind: "package", parameters: {} }, selfCheck: { grain: "One employee per row" } };
  vi.mocked(assistantService.dataset).mockResolvedValue({ payload } as never);
  vi.mocked(assistantService.artifact).mockResolvedValue({ runId: "source-run", path: "outputs/staff.dataset.json" } as never);
  const adjustment = "Change age to 55+, include retired staff, add department = Science and remove the type restriction";
  await adjustAnalysisScope("session", "artifact", owner, {}, { adjustment }, "new-run");
  expect(assistantService.start).toHaveBeenCalledTimes(1);
  const call = vi.mocked(assistantService.start).mock.calls[0]!;
  expect([call[0], call[1], call[3], call[4]]).toEqual(["session", "new-run", owner, {}]);
  const message = call[2];
  const context = JSON.parse(message.split("\n<agent-context>\n")[1]!.split("\n")[1]!);
  expect(context.originalScope).toEqual(payload);
  expect(context.adjustment).toBe(adjustment);
  expect(context.sourcePath).toBe("outputs/staff.dataset.json");
  expect(message).toContain("Preserve every condition not mentioned");
  expect(message).toContain("clarify before querying");
});

it("accepts adding scope conditions when no source filters were recorded", async () => {
  vi.mocked(assistantService.dataset).mockResolvedValue({ payload: { question: "Staff", assumptions: [], sourceAnalysis: { filters: [] } } } as never);
  vi.mocked(assistantService.artifact).mockResolvedValue({ runId: "source-run", path: "staff.dataset.json" } as never);
  await adjustAnalysisScope("session", "artifact", owner, {}, { adjustment: "Only Science department" });
  expect(assistantService.start).toHaveBeenCalledTimes(1);
});

it("rejects blank, oversized and client-supplied source conditions", () => {
  expect(scopeChangeSchema.parse({ adjustment: "  Age ≥ 55  " })).toEqual({ adjustment: "Age ≥ 55" });
  for (const input of [{ adjustment: " " }, { adjustment: "a".repeat(2001) }, { adjustment: "All", originalScope: {} }, { filterId: "age", replacement: "55" }]) {
    expect(scopeChangeSchema.safeParse(input).success).toBe(false);
  }
});
