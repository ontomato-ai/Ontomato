import { expect, it } from "vitest";
import type { Request, Response } from "express";
import { requireRunAccess, RunStreamStore } from "../run-stream";

const owner = { userId: "owner", domainId: "domain-a" };

it.each([
  ["another user", { userId: "other", domainId: "domain-a" }],
  ["another domain", { userId: "owner", domainId: "domain-b" }],
])("refuses %s access or replacement without exposing events or stopping the owner's run", (_case, caller) => {
  const store = new RunStreamStore();
  const run = store.startRun({ runId: "run", key: "thread", ...owner });
  store.appendJson(run.id, { content: "private answer" });
  const denied = (action: () => unknown) => {
    let error: unknown;
    try { action(); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ status: 403 });
  };
  denied(() => requireRunAccess(run, caller));
  const writes: unknown[] = [];
  denied(() => store.subscribe(caller as unknown as Request, { write: (chunk: unknown) => writes.push(chunk) } as unknown as Response, run));
  denied(() => store.startRun({ runId: "intruder", key: "thread", ...caller }));
  expect(writes).toEqual([]);
  expect(run.controller.signal.aborted).toBe(false);
  expect(store.getActiveRunByKey("thread")).toBe(run);
  expect(() => requireRunAccess(run, owner)).not.toThrow();
});

it("rejects a different conversation key even for the same owner", () => {
  const run = new RunStreamStore().startRun({ runId: "run", key: "thread", ...owner });
  expect(() => requireRunAccess(run, owner, "another-thread")).toThrow();
});
