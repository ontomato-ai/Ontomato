import { describe, expect, it, vi } from "vitest";
import { Workspaces } from "../workspaces";
import { RuntimeStore } from "../store";
import { AgentRuntime } from "../runtime";
import type { WorkerPolicy } from "../worker";

/**
 * Deleting on a preview's behalf deletes nothing that holds a live run: the runtime, which admits the runs, checks every
 * run of every conversation a workspace holds before the first conversation is deleted.
 */
const scope = { hostId: "host", domainId: "domain" };
function workspaces(lanes: Record<string, ("live" | "preview")[]>) {
  const store = Object.assign(Object.create(RuntimeStore.prototype), {
    table: (name: string) => name,
    transaction: async (operation: (client: { query: (sql: string) => Promise<{ rows: object[] }> }) => Promise<unknown>) =>
      operation({ query: async (sql: string) => sql.includes("FROM workspaces") ? { rows: [{ id: "w", active_run_id: null }] }
        : sql.includes("FROM sessions") ? { rows: Object.keys(lanes).map(id => ({ id })) } : { rows: [] } }),
    sessionRunLanes: async (_scope: unknown, id: string) => lanes[id]!.map((lane, index) => ({ runId: `${id}-${index}`, lane })),
  }) as RuntimeStore;
  return new Workspaces(store, "/nonexistent", { development: true } as WorkerPolicy);
}

describe("a workspace deleted on a preview's behalf", () => {
  it("is refused before its first conversation is deleted when any of them holds a live run", async () => {
    const deleteSession = vi.fn(async () => {});
    await expect(workspaces({ first: ["preview"], second: ["preview", "live"] }).delete(scope, "owner", "w", true, deleteSession))
      .rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验" });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("deletes conversations that hold only the preview's runs, and a live owner deletes as before", async () => {
    const deleteSession = vi.fn(async () => { throw new Error("stop after the check"); });
    await expect(workspaces({ first: ["preview"] }).delete(scope, "owner", "w", true, deleteSession)).rejects.toThrow("stop after the check");
    expect(deleteSession).toHaveBeenCalledWith("first");
    deleteSession.mockClear();
    await expect(workspaces({ first: ["live"] }).delete(scope, "owner", "w", false, deleteSession)).rejects.toThrow("stop after the check");
    expect(deleteSession).toHaveBeenCalledWith("first");
  });
});

describe("a conversation deleted on a preview's behalf", () => {
  it("is refused inside its admission lock when it holds or has queued a live run", async () => {
    const store = Object.assign(Object.create(RuntimeStore.prototype), {
      sessionRunLanes: vi.fn(async () => [{ runId: "queued", lane: "live" }]),
    }) as RuntimeStore;
    await expect(store.requireOnlyPreviewRuns(scope, "s")).rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN" });
    vi.mocked(store.sessionRunLanes).mockResolvedValue([{ runId: "p", lane: "preview" }]);
    await expect(store.requireOnlyPreviewRuns(scope, "s")).resolves.toBeUndefined();
  });

  it("checks in the session's lock before anything of it is removed", async () => {
    let locked = false;
    const remove = vi.fn();
    const runtime = Object.assign(Object.create(AgentRuntime.prototype), {
      files: { withLock: (operation: () => Promise<unknown>) => operation() },
      locked: async (_scope: unknown, _id: string, operation: () => Promise<unknown>) => {
        locked = true;
        try { return await operation(); } finally { locked = false; }
      },
      store: { requireOnlyPreviewRuns: vi.fn(async () => {
        expect(locked).toBe(true);
        throw Object.assign(new Error("live run"), { status: 422 });
      }), pool: { query: vi.fn() } },
      sessionEngines: { remove },
    }) as AgentRuntime;
    await expect(runtime.deleteSession(scope, "s", true)).rejects.toMatchObject({ status: 422 });
    expect(remove).not.toHaveBeenCalled();
  });
});
