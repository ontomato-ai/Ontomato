import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ session: vi.fn(), dataset: vi.fn(), plan: vi.fn(), create: vi.fn(), describe: vi.fn() }));
vi.mock("../../assistant/store", () => ({ assistantStore: { session: mocks.session } }));
vi.mock("../../assistant/service", () => ({ assistantService: { dataset: mocks.dataset } }));
vi.mock("../reference-planning", () => ({ planReferenceDashboard: mocks.plan }));
vi.mock("../store", () => ({ createDashboard: mocks.create }));
vi.mock("../metric-client", () => ({ DashboardMetricClient: class { describe = mocks.describe; } }));
import { createDashboardFromAnalysis } from "../create-from-analysis";

const groups = [{ id: "group", title: "Group", charts: [], metrics: [{ id: "card", name: "Count", query: { kind: "metric", metricId: "candidate", parameters: { year: 2026 } }, valueField: "count" }] }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.dataset.mockResolvedValue({ payload: { question: "Count", recipe: { kind: "metric", metricId: "candidate", revision: "r", parameters: { year: 2026 } }, rows: [{ count: 1 }], columns: [{ key: "count" }] } });
  mocks.plan.mockResolvedValue({ name: "Counts", groups });
  mocks.describe.mockResolvedValue({ status: "PENDING_REVIEW", parameterDefs: [{ name: "year" }] });
  mocks.create.mockImplementation(async input => ({ ...input, id: "board" }));
});
const source = { sessionId: "session", datasetArtifactIds: ["dataset"] };
it("creates a personal dashboard after admitting its creator's executable candidate", async () => {
  await expect(createDashboardFromAnalysis("alice", "domain", source, { token: "alice" })).resolves.toEqual({ id: "board", name: "Counts" });
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ ownerId: "alice", domainId: "domain", groups });
});
it.each(["unavailable", "parameter"])("never stores a dashboard when %s admission fails", async reason => {
  if (reason === "unavailable") mocks.describe.mockRejectedValue(new HttpError(404, "Not executable", "METRIC_UNAVAILABLE"));
  else mocks.describe.mockResolvedValue({ status: "PENDING_REVIEW", parameterDefs: [] });
  await expect(createDashboardFromAnalysis("alice", "domain", source, { token: "alice" })).rejects.toMatchObject({ code: reason === "unavailable" ? "METRIC_UNAVAILABLE" : "INVALID_PRODUCT_PARAMETER" });
  expect(mocks.create).not.toHaveBeenCalled();
});
