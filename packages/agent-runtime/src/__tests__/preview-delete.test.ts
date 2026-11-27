import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../runtime";
import { RuntimeStore, sessionClosing } from "../store";

/**
 * Deleting a workspace with its conversations: the runtime's own session locks (`locked`), and a stand-in for the
 * database row lock of the workspace that a run's start takes while it holds its session's lock.
 */
const scope = { hostId: "host", domainId: "domain" };

/** A mutual-exclusion lock, as the database holds the workspace row for one transaction at a time. */
function rowLock() {
  let tail = Promise.resolve();
  let held = false;
  return {
    get held() { return held; },
    async hold<T>(operation: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      held = true;
      try { return await operation(); } finally { held = false; release(); }
    },
  };
}

function runtimeFor(lanes: Record<string, ("live" | "preview")[]>, options: { busy?: string[]; closedElsewhere?: string[]; gone?: string[]; failOn?: string } = {}) {
  const workspaceRow = rowLock();
  const closing = new Set<string>(options.closedElsewhere ?? []);
  const sessions = new Set(Object.keys(lanes).filter(id => !options.gone?.includes(id)));
  const events: string[] = [];
  const runtime = Object.create(AgentRuntime.prototype) as AgentRuntime & Record<string, unknown>;
  Object.assign(runtime, {
    locks: new Map(),
    files: { withLock: (operation: () => Promise<unknown>) => operation() },
    workspaces: {
      beginDeletion: vi.fn(async () => workspaceRow.hold(async () => { events.push("begin"); return Object.keys(lanes); })),
      endDeletion: vi.fn(async () => { events.push("end"); }),
      completeDeletion: vi.fn(async () => workspaceRow.hold(async () => { events.push("complete"); })),
    },
    store: Object.assign(Object.create(RuntimeStore.prototype), {
      acquireClosing: vi.fn(async (_scope: unknown, id: string) => {
        if (!sessions.has(id)) return false;
        if (closing.has(id)) throw sessionClosing();
        closing.add(id);
        events.push(`close ${id}`);
        return true;
      }),
      releaseClosing: vi.fn(async (_scope: unknown, id: string) => { closing.delete(id); events.push(`reopen ${id}`); }),
      requireIdle: vi.fn(async (_scope: unknown, id: string) => {
        expect([...closing].sort()).toEqual([...sessions].sort());
        if (options.busy?.includes(id)) throw Object.assign(new Error("busy"), { status: 409, code: "SESSION_BUSY" });
      }),
      sessionRunLanes: vi.fn(async (_scope: unknown, id: string) => lanes[id]!.map((lane, index) => ({ runId: `${id}-${index}`, lane }))),
    }),
    removeSession: vi.fn(async (_scope: unknown, id: string) => {
      if (id === options.failOn) throw new Error(`could not remove ${id}`);
      sessions.delete(id);
      closing.delete(id);
      events.push(`delete ${id}`);
    }),
  });
  return { runtime, workspaceRow, closing, sessions, events };
}

describe("a workspace deleted with its conversations", () => {
  it("closes every conversation before judging, and a preview's refusal reopens them all and deletes none", async () => {
    const { runtime, closing, events } = runtimeFor({ first: ["preview"], second: ["preview", "live"] });
    await expect(runtime.deleteWorkspace(scope, "owner", "w", true))
      .rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验" });
    expect(events).toEqual(["begin", "close first", "close second", "reopen first", "reopen second", "end"]);
    expect(closing.size).toBe(0);
  });

  it("deletes none when any conversation is busy, whoever deletes", async () => {
    const { runtime, events } = runtimeFor({ first: ["live"], second: ["live"] }, { busy: ["second"] });
    await expect(runtime.deleteWorkspace(scope, "owner", "w", false)).rejects.toMatchObject({ status: 409, code: "SESSION_BUSY" });
    expect(events.filter(event => event.startsWith("delete"))).toEqual([]);
    expect(events.at(-1)).toBe("end");
  });

  it("is refused when another deletion is closing one of the conversations, reopening only what it closed itself", async () => {
    const { runtime, closing, events } = runtimeFor({ first: ["live"], second: ["live"] }, { closedElsewhere: ["second"] });
    await expect(runtime.deleteWorkspace(scope, "owner", "w", false)).rejects.toMatchObject({ status: 409, code: "SESSION_CLOSING" });
    expect(events).toEqual(["begin", "close first", "reopen first", "end"]);
    expect([...closing]).toEqual(["second"]);
  });

  it("restores what it closed and has not deleted when a deletion fails part way", async () => {
    const { runtime, closing, sessions, events } = runtimeFor({ first: ["live"], second: ["live"], third: ["live"] }, { failOn: "second" });
    await expect(runtime.deleteWorkspace(scope, "owner", "w", false)).rejects.toThrow("could not remove second");
    expect(events).toEqual(["begin", "close first", "close second", "close third", "delete first", "reopen second", "reopen third", "end"]);
    expect([...sessions].sort()).toEqual(["second", "third"]);
    expect(closing.size).toBe(0);
  });

  it("skips a conversation already deleted on its own and reports the ones it deleted", async () => {
    const { runtime, events } = runtimeFor({ first: ["preview"], second: ["preview"] }, { gone: ["first"] });
    await expect(runtime.deleteWorkspace(scope, "owner", "w", true)).resolves.toEqual({ sessionIds: ["second"] });
    expect(events).toEqual(["begin", "close second", "delete second", "complete"]);
  });

  it("never holds the workspace row while waiting for a conversation, so a run starting in it cannot lock it out", async () => {
    const { runtime, workspaceRow, events } = runtimeFor({ first: ["preview"] });
    const locked = runtime.locked.bind(runtime);
    vi.spyOn(runtime, "locked").mockImplementation(async (lockScope, session, operation) => {
      // Waiting for a conversation's lock with the workspace row held is the order a run's start would deadlock with.
      expect(workspaceRow.held).toBe(false);
      return locked(lockScope, session, operation);
    });
    // A run starts in the conversation: it holds the conversation's lock and then waits for the workspace row.
    let admit!: () => void;
    const admitted = new Promise<void>(resolve => { admit = resolve; });
    const start = locked(scope, "first", async () => {
      await admitted;
      await workspaceRow.hold(async () => { events.push("run claims the workspace"); });
    });
    const deletion = runtime.deleteWorkspace(scope, "owner", "w", true);
    await vi.waitFor(() => expect(events).toContain("begin"));
    admit();
    const finished = await Promise.race([
      Promise.allSettled([start, deletion]).then(() => "finished"),
      new Promise(resolve => setTimeout(() => resolve("deadlocked"), 2000)),
    ]);
    expect(finished).toBe("finished");
    await expect(start).resolves.toBeUndefined();
    await expect(deletion).resolves.toEqual({ sessionIds: ["first"] });
    // The run claimed the workspace before the deletion took the conversation's lock to close it.
    expect(events.indexOf("run claims the workspace")).toBeLessThan(events.indexOf("close first"));
  });
});

describe("a conversation deleted on its own", () => {
  it("takes the right to close it inside its lock, is refused while a workspace deletion holds it, and gives it back on failure", async () => {
    let locked = false;
    const store = {
      acquireClosing: vi.fn(async () => { expect(locked).toBe(true); return true; }),
      releaseClosing: vi.fn(async () => { expect(locked).toBe(true); }),
      requireOnlyPreviewRuns: vi.fn(async () => { throw Object.assign(new Error("live run"), { status: 422 }); }),
    };
    const removeSession = vi.fn();
    const runtime = Object.assign(Object.create(AgentRuntime.prototype), {
      locks: new Map(),
      files: { withLock: (operation: () => Promise<unknown>) => operation() },
      store,
      removeSession,
    }) as AgentRuntime;
    const real = runtime.locked.bind(runtime);
    vi.spyOn(runtime, "locked").mockImplementation(async (lockScope, id, operation) =>
      real(lockScope, id, async () => { locked = true; try { return await operation(); } finally { locked = false; } }));
    await expect(runtime.deleteSession(scope, "s", true)).rejects.toMatchObject({ status: 422 });
    expect(removeSession).not.toHaveBeenCalled();
    expect(store.releaseClosing).toHaveBeenCalledWith(scope, "s");
    // A workspace deletion holds the right: this deletion is refused and gives nothing back.
    store.acquireClosing.mockRejectedValue(sessionClosing());
    store.releaseClosing.mockClear();
    await expect(runtime.deleteSession(scope, "s", false)).rejects.toMatchObject({ status: 409, code: "SESSION_CLOSING" });
    expect(store.releaseClosing).not.toHaveBeenCalled();
  });

  it("refuses inside its lock when it holds or has queued a live run", async () => {
    const store = Object.assign(Object.create(RuntimeStore.prototype), {
      sessionRunLanes: vi.fn(async () => [{ runId: "queued", lane: "live" }]),
    }) as RuntimeStore;
    await expect(store.requireOnlyPreviewRuns(scope, "s")).rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN" });
    vi.mocked(store.sessionRunLanes).mockResolvedValue([{ runId: "p", lane: "preview" }]);
    await expect(store.requireOnlyPreviewRuns(scope, "s")).resolves.toBeUndefined();
  });
});
