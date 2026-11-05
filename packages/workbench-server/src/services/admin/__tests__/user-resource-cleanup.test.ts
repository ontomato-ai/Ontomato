import { beforeEach, expect, it, vi } from "vitest";

// These doubles are the resource owners, not SQL interpreters. This suite protects
// orchestration and failure isolation; database predicates are reviewed at each owner.
const owners = vi.hoisted(() => ({
  schedules: vi.fn(), credentials: vi.fn(), tasks: vi.fn(), threads: vi.fn(), dashboards: vi.fn(),
  store: vi.fn(), governance: vi.fn(), files: vi.fn(), error: vi.fn(),
}));
vi.mock("../../../infrastructure/connection", () => ({ getStore: () => ({ deleteByUser: owners.store }) }));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error: owners.error }) }));
vi.mock("../../analysis-agent/task/schedule-rules", () => ({ getAnalysisScheduleRuleService: () => ({ deleteByUser: owners.schedules }) }));
vi.mock("../../analysis-agent/task/schedule-credentials", () => ({ deleteScheduleCredentialsOfUser: owners.credentials }));
vi.mock("../../analysis-agent/task/task-service", () => ({ getAnalysisTaskService: () => ({ deleteByUser: owners.tasks }) }));
vi.mock("../../chat/thread-service", () => ({ deleteUserThreads: owners.threads }));
vi.mock("../../dashboard/store", () => ({ deleteUserDashboards: owners.dashboards }));
vi.mock("../../knowledge-governance/store", () => ({ governanceStore: { deleteByUser: owners.governance } }));
vi.mock("../../analysis-agent/delivery/ppt-artifacts", () => ({ pptArtifactStore: () => ({ deleteByUser: owners.files }) }));
import { cleanupDeletedUsers } from "../user-resource-cleanup";

const stages = ["schedules", "credentials", "tasks", "threads", "dashboards", "store", "governance", "files"] as const;
const calls: string[] = [];
const data = new Map<string, Set<string>>();
beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  data.clear();
  for (const stage of stages) {
    data.set(stage, new Set(["alice/a", "alice/b", "bob/a"]));
    owners[stage].mockImplementation(async (userId: string) => {
      calls.push(stage);
      for (const key of data.get(stage)!) if (key.startsWith(`${userId}/`)) data.get(stage)!.delete(key);
    });
  }
});

it("dispatches only the deleted account to every private resource owner, schedules first", async () => {
  await cleanupDeletedUsers(["alice"]);
  expect(calls[0]).toBe("schedules");
  for (const stage of stages) {
    expect(owners[stage]).toHaveBeenCalledWith("alice");
    expect([...data.get(stage)!]).toEqual(["bob/a"]);
  }
  expect(owners.error).not.toHaveBeenCalled();
});

it("logs the failed account and stage, then continues independent cleanup", async () => {
  owners.tasks.mockRejectedValue(new Error("task storage failed"));
  await expect(cleanupDeletedUsers(["alice"])).resolves.toBeUndefined();
  expect(owners.error).toHaveBeenCalledWith(expect.any(String), {
    userId: "alice", stage: "analysis tasks", error: "task storage failed",
  });
  expect([...data.get("tasks")!]).toEqual(["alice/a", "alice/b", "bob/a"]);
  expect([...data.get("files")!]).toEqual(["bob/a"]);
});
