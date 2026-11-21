import { expect, it } from "vitest";
import { panelHumanOperations } from "../../../../../packages/apps-sdk/src/panel/human-operations";

/*
 * The application frame's own operations (B's frame contract, 2026-11-21): the host runs the frame's panel as the
 * application use with `root: "frame"`, and every request for one of its operations — the description, a read, a write
 * intent — names that root, so the coordinator looks the operation up in the frame and not in the content panel. A
 * content panel's requests name no root.
 */

function through() {
  const sent: { path: string; body?: unknown }[] = [];
  const requests = {
    request: async (path: string, init?: RequestInit) => {
      sent.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (path.startsWith("/panel-operations/descriptor")) throw new Error("described");
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    },
  };
  return { sent, requests };
}

it("names the frame as the root of every request for one of the frame's operations", async () => {
  const { sent, requests } = through();
  const operations = panelHumanOperations({ applicationId: "app-tasks", useId: "tasks", root: "frame" }, requests);
  await expect(operations.describe("entry.open")).rejects.toThrow("described");
  await operations.read("entry.count", { target: null, input: {} }).catch(() => undefined);
  await operations.prepare("entry.rename", { call: { target: null, input: {} } } as never).catch(() => undefined);
  expect(new URLSearchParams(sent[0]!.path.split("?")[1]).get("root")).toBe("frame");
  expect(sent.slice(1).map(({ path, body }) => [path, (body as { root?: string }).root])).toEqual([
    ["/panel-operations/read", "frame"],
    ["/panel-operations/intents", "frame"],
  ]);
});

it("names no root for a content panel's operations", async () => {
  const { sent, requests } = through();
  const operations = panelHumanOperations({ applicationId: "app-tasks", useId: "tasks" }, requests);
  await expect(operations.describe("feedback.list")).rejects.toThrow("described");
  await operations.read("feedback.count", { target: null, input: {} }).catch(() => undefined);
  expect(new URLSearchParams(sent[0]!.path.split("?")[1]).has("root")).toBe(false);
  expect(Object.hasOwn(sent[1]!.body as object, "root")).toBe(false);
});
