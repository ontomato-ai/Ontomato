import { beforeEach, expect, it, vi } from "vitest";
const stages = vi.hoisted(() => ({ sessions: vi.fn(), dashboards: vi.fn(), state: vi.fn(), ppt: vi.fn() }));
vi.mock("../../assistant/cleanup", () => ({ deleteUserAssistantSessions: stages.sessions }));
vi.mock("../../assistant/user-state", () => ({ deleteUserState: stages.state }));
vi.mock("../../dashboard/store", () => ({ deleteUserDashboards: stages.dashboards }));
vi.mock("../../analysis-agent/delivery/ppt-artifacts", () => ({ pptArtifactStore: () => ({ deleteByUser: stages.ppt }) }));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
import { cleanupDeletedUsers } from "../user-resource-cleanup";
import { withScheduledUserActivity } from "../../assistant/scheduled-activity";
beforeEach(() => { for (const fn of Object.values(stages)) fn.mockReset().mockResolvedValue(undefined); });

it("reports the failed stage and can repeat earlier successful stages", async () => {
  stages.sessions.mockRejectedValueOnce(new Error("runtime unavailable"));
  await expect(cleanupDeletedUsers(["alice"])).rejects.toThrow("runtime unavailable");
  expect(stages.dashboards).not.toHaveBeenCalled();
  await cleanupDeletedUsers(["alice"]);
  expect(stages.sessions).toHaveBeenCalledTimes(2);
  expect(stages.ppt).toHaveBeenCalledWith("alice");
});

it("waits for already-admitted task creation and holds later admission until cleanup finishes", async () => {
  let release!: () => void;
  const active = withScheduledUserActivity("alice", () => new Promise<void>((resolve) => { release = resolve; }));
  await Promise.resolve();
  const deletion = cleanupDeletedUsers(["alice"]);
  const later = vi.fn(async () => { expect(stages.ppt).toHaveBeenCalled(); });
  const admission = withScheduledUserActivity("alice", later);
  expect(stages.sessions).not.toHaveBeenCalled();
  release();
  await Promise.all([active, deletion, admission]);
  expect(later).toHaveBeenCalledOnce();
});
