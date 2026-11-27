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
function workspaces(lanes: Record<string, ("live" | "preview")[]>, busy: string[] = []) {
  const closed = new Set<string>();
  const store = Object.assign(Object.create(RuntimeStore.prototype), {
    table: (name: string) => name,
    transaction: async (operation: (client: { query: (sql: string) => Promise<{ rows: object[] }> }) => Promise<unknown>) =>
      operation({ query: async (sql: string) => sql.includes("FROM workspaces") ? { rows: [{ id: "w", active_run_id: null }] }
        : sql.includes("FROM sessions") ? { rows: Object.keys(lanes).map(id => ({ id })) } : { rows: [] } }),
    requireIdle: async (_scope: unknown, id: string) => {
      if (busy.includes(id)) throw Object.assign(new Error("busy"), { status: 409, code: "SESSION_BUSY" });
    },
    // What a conversation holds when it is judged; admission to all of them is already closed by then.
    sessionRunLanes: async (_scope: unknown, id: string) => {
      expect([...closed].sort()).toEqual(Object.keys(lanes).sort());
      return lanes[id]!.map((lane, index) => ({ runId: `${id}-${index}`, lane }));
    },
  }) as RuntimeStore;
  const conversations = {
    setClosing: vi.fn(async (ids: readonly string[], closing: boolean) => { for (const id of ids) { if (closing) closed.add(id); else closed.delete(id); } }),
    delete: vi.fn(async (_id: string) => {}),
  };
  return { workspaces: new Workspaces(store, "/nonexistent", { development: true } as WorkerPolicy), conversations, closed };
}

describe("a workspace deleted with its conversations", () => {
  it("closes admission to every conversation, then refuses a preview's deletion before deleting any, and reopens them", async () => {
    const { workspaces: target, conversations, closed } = workspaces({ first: ["preview"], second: ["preview", "live"] });
    await expect(target.delete(scope, "owner", "w", true, conversations))
      .rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验" });
    expect(conversations.setClosing.mock.calls).toEqual([[["first", "second"], true], [["first", "second"], false]]);
    expect(conversations.delete).not.toHaveBeenCalled();
    expect(closed.size).toBe(0);
  });

  it("deletes none when any conversation is busy, whoever deletes", async () => {
    const { workspaces: target, conversations } = workspaces({ first: ["live"], second: ["live"] }, ["second"]);
    await expect(target.delete(scope, "owner", "w", false, conversations)).rejects.toMatchObject({ status: 409, code: "SESSION_BUSY" });
    expect(conversations.delete).not.toHaveBeenCalled();
  });

  it("deletes every conversation of preview runs for a preview, and every conversation for a live owner", async () => {
    for (const [lane, preview] of [["preview", true], ["live", false]] as const) {
      const { workspaces: target, conversations } = workspaces({ first: [lane], second: [lane] });
      await expect(target.delete(scope, "owner", "w", preview, conversations)).rejects.toThrow();  // the fixture has no git directory
      expect(conversations.delete.mock.calls).toEqual([["first"], ["second"]]);
      expect(conversations.setClosing).toHaveBeenCalledTimes(1);
    }
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
