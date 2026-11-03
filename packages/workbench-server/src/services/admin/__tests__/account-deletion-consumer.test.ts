import { describe, expect, it, vi } from "vitest";
import type { AccountDeletionPage } from "@ontomato/contracts/platform-identity";
import { consumeAccountDeletions, startAccountDeletionConsumer } from "../account-deletion-consumer";

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
const event = (sequence: string) => ({ sequence, type: "account.deleted" as const, userId: `user-${sequence}`, occurredAt: "2026-11-03T00:00:00Z" });

describe("account deletion delivery", () => {
  it("stops at failure and replays only unacknowledged events after restart", async () => {
    let cursor = "0";
    const clean = vi.fn(async (users: readonly string[]) => {
      if (users[0] === "user-2") throw new Error("runtime unavailable");
    });
    const deps = {
      readCursor: async () => cursor,
      saveCursor: async (value: string) => { cursor = value; },
      readEvents: async (after: string): Promise<AccountDeletionPage> => ({
        events: [event("1"), event("2"), event("3")].filter((e) => BigInt(e.sequence) > BigInt(after)),
        nextCursor: "3", hasMore: false,
      }),
      cleanup: clean,
    };
    await expect(consumeAccountDeletions(deps)).rejects.toThrow("runtime unavailable");
    expect(cursor).toBe("1");
    expect(clean.mock.calls).toEqual([[ ["user-1"] ], [ ["user-2"] ]]);
    clean.mockImplementation(async () => {});
    await consumeAccountDeletions(deps);
    expect(cursor).toBe("3");
    expect(clean.mock.calls.slice(2)).toEqual([[ ["user-2"] ], [ ["user-3"] ]]);
  });

  it("repeats completed cleanup if cursor persistence failed", async () => {
    const cleanup = vi.fn(async () => {});
    const saveCursor = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(undefined);
    const deps = { readCursor: async () => "0", saveCursor, cleanup,
      readEvents: async () => ({ events: [event("9007199254740993")], nextCursor: "9007199254740993", hasMore: false }) };
    await expect(consumeAccountDeletions(deps)).rejects.toThrow("database unavailable");
    await consumeAccountDeletions(deps);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(saveCursor).toHaveBeenLastCalledWith("9007199254740993");
  });

  it("drains pages immediately and rejects a page that could skip an event", async () => {
    const readEvents = vi.fn().mockResolvedValueOnce({ events: [event("2")], nextCursor: "2", hasMore: true })
      .mockResolvedValueOnce({ events: [event("4")], nextCursor: "4", hasMore: false });
    const saveCursor = vi.fn(); const cleanup = vi.fn();
    const deps = { readCursor: async () => "0", readEvents, saveCursor, cleanup };
    await consumeAccountDeletions(deps);
    expect(readEvents.mock.calls).toEqual([["0"], ["2"]]);
    readEvents.mockResolvedValue({ events: [event("2")], nextCursor: "9", hasMore: false });
    cleanup.mockClear();
    await expect(consumeAccountDeletions(deps)).rejects.toThrow("cursor");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("does not overlap polls and resumes after fetch failure", async () => {
    vi.useFakeTimers();
    let release!: (page: AccountDeletionPage) => void;
    const readEvents = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise<AccountDeletionPage>((resolve) => { release = resolve; }));
    const stop = startAccountDeletionConsumer({ readCursor: async () => "0", saveCursor: vi.fn(), cleanup: vi.fn(), readEvents });
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(readEvents).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(readEvents).toHaveBeenCalledTimes(2);
      release({ events: [], nextCursor: "0", hasMore: false });
      await stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(readEvents).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
