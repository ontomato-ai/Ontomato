import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), closeRun: vi.fn() }));
vi.mock("../store", () => ({ governanceStore: store }));
vi.mock("../skill", () => ({ governanceSkillRef: {} }));
vi.mock("../../../core/prompts/loader", () => ({ renderPrompt: vi.fn() }));
vi.mock("../../../config/model-resolver", () => ({ getRoleNotConfiguredMessage: () => "Model is not configured" }));
import { RuntimeClient } from "../../agent-runtime/client";
import { GovernanceRuntime } from "../runtime";

const owner = { domainId: "fixture-domain", userId: "fixture-user" };
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it("lists 100 sessions with one status batch, no full snapshots, and closes terminal gates before returning", async () => {
  const records = Array.from({ length: 100 }, () => ({
    id: randomUUID(), runtimeSessionId: randomUUID(),
    createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z",
  }));
  const states = [null, "running", "completed", "failed", "cancelled", "interrupted"] as const;
  const statuses = records.map((record, i) => {
    const status = states[i % states.length];
    const runId = status ? randomUUID() : null;
    return {
      session: { id: record.runtimeSessionId, domainId: owner.domainId,
        activeRunId: status === "running" ? runId : null, latestRunId: runId,
        createdAt: record.createdAt, updatedAt: record.updatedAt },
      latestRun: status ? { id: runId!, status, error: status === "failed" ? { code: "MODEL_NOT_CONFIGURED" } : null } : null,
    };
  });
  store.list.mockResolvedValue(records);
  const pending: Array<() => void> = [];
  store.closeRun.mockImplementation(() => new Promise<void>(resolve => pending.push(resolve)));
  store.get.mockImplementation(async id => ({ ...records.find(r => r.id === id), updatedAt: "2026-10-28T00:01:00.000Z" }));
  const batch = vi.spyOn(RuntimeClient.prototype, "sessionStatuses").mockResolvedValue([...statuses].reverse());
  const snapshot = vi.spyOn(RuntimeClient.prototype, "session").mockRejectedValue(new Error("Full snapshot must not be read by the list"));
  const runtime = new GovernanceRuntime();
  const fullGet = vi.spyOn(runtime, "get");
  let returned = false;
  const result = runtime.list(owner).then(view => { returned = true; return view; });
  await vi.waitFor(() => expect(pending.length).toBe(66));
  expect(returned).toBe(false);
  for (const release of pending) release();
  const view = await result;
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch).toHaveBeenCalledWith(records.map(record => record.runtimeSessionId));
  expect(snapshot).not.toHaveBeenCalled();
  expect(fullGet).not.toHaveBeenCalled();
  expect(view.map(item => item.status)).toEqual(records.map((_, i) => ["idle", "running", "idle", "failed", "stopped", "stopped"][i % states.length]));
  expect(view[3]).toEqual({ id: records[3]!.id, createdAt: records[3]!.createdAt,
    updatedAt: "2026-10-28T00:01:00.000Z", status: "failed" });
  expect(store.closeRun).toHaveBeenCalledWith(records[3]!.id, owner, statuses[3]!.latestRun!.id, "Model is not configured");
});

it("does not call the runtime when the owner has no governance sessions", async () => {
  store.list.mockResolvedValue([]);
  const batch = vi.spyOn(RuntimeClient.prototype, "sessionStatuses");
  expect(await new GovernanceRuntime().list(owner)).toEqual([]);
  expect(batch).not.toHaveBeenCalled();
});
