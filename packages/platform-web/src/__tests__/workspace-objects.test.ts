import { beforeEach, expect, it, vi } from "vitest";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@ontomato/workbench-ui", () => ({ nodeApiRequest: api.request }));
import { createWorkspaceObjectHost } from "../workspace-objects";
beforeEach(() => api.request.mockReset());
it("pins and removes an object while preserving other workspace preferences", async () => {
  let config = { ...defaultPersonalWorkspace(), dashboardIds: ["board"] };
  api.request.mockImplementation(async (_path, init) => {
    if (init?.method === "PUT") config = JSON.parse(init.body);
    return Response.json({ data: config });
  });
  const host = createWorkspaceObjectHost();
  const object = { className: "Person", primaryKey: "1", title: "Person one" };
  expect(await host.isPinned(object)).toBe(false);
  expect(await host.toggle(object)).toBe(true);
  expect(config.dashboardIds).toEqual(["board"]);
  expect(await host.isPinned(object)).toBe(true);
  expect(await host.toggle(object)).toBe(false);
});
it("does not report success when persistence is rejected", async () => {
  api.request.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }));
  await expect(createWorkspaceObjectHost().toggle({ className: "Person", primaryKey: "1", title: "One" })).rejects.toThrow("Forbidden");
});
