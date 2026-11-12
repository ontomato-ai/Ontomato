import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultPersonalWorkspace, personalWorkspaceSchema } from "@ontomato/contracts/personal-workspace";

const database = vi.hoisted(() => ({ values: new Map<string, unknown>(), query: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  qualifiedTable: () => "user_preferences",
  getPostgresPool: () => ({ query: database.query }),
}));
vi.mock("../../../utils/request-identity", () => ({ requireDomainId: (req: { domainId: string }) => req.domainId }));
import router from "../personal-workspace";

let server: Server;
let base: string;
beforeAll(async () => {
  database.query.mockImplementation(async (sql: string, args: string[]) => {
    const key = JSON.stringify(args.slice(0, 2));
    if (sql.includes("jsonb_build_array")) {
      const item = JSON.parse(args[2]!);
      const previous = (database.values.get(key) ?? []) as { path: string }[];
      database.values.set(key, [item, ...previous.filter(entry => entry.path !== item.path)].slice(0, 8));
    } else if (sql.includes("INSERT")) database.values.set(key, JSON.parse(args[2]!));
    return { rows: database.values.has(key) ? [{ value: database.values.get(key) }] : [] };
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: req.header("test-user") ?? "alice", domainId: req.header("test-domain") ?? "domain-a" });
    next();
  });
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("personal workspace HTTP persistence", () => {
  it("loads old preferences with side-panel defaults and preserves independent interaction choices", async () => {
    const old = { schemaVersion: 1, layout: "assistant", dashboardIds: [], applicationIds: [] };
    expect(personalWorkspaceSchema.parse(old).interactions).toEqual({ metrics: "drawer", tasks: "drawer" });
    const config = { ...defaultPersonalWorkspace(), interactions: { metrics: "dialog", tasks: "conversation" } };
    expect((await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json", "test-user": "interaction-user" }, body: JSON.stringify(config) })).status).toBe(200);
    expect(await (await fetch(base, { headers: { "test-user": "interaction-user" } })).json()).toEqual({ data: config });
  });
  it("retains bounded recent work per user and domain and moves repeat visits to the front", async () => {
    for (let index = 0; index < 10; index++) {
      expect((await fetch(`${base}/recent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: "agents", title: `Analysis ${index}`, path: `/agents/chat?sessionId=${index}` }) })).status).toBe(200);
    }
    const read = async (headers = {}) => (await (await fetch(`${base}/recent`, { headers })).json()).data;
    expect(await read()).toHaveLength(8);
    await fetch(`${base}/recent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: "agents", title: "Resumed", path: "/agents/chat?sessionId=4" }) });
    const history = await read();
    expect(history).toHaveLength(8);
    expect(history[0]).toMatchObject({ title: "Resumed", path: "/agents/chat?sessionId=4" });
    expect(await read({ "test-user": "bob" })).toEqual([]);
    expect(await read({ "test-domain": "domain-b" })).toEqual([]);
    const calls = database.query.mock.calls.length;
    expect((await fetch(`${base}/recent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: "agents", title: "Unsafe", path: "/agents/chat?apiKey=secret" }) })).status).toBe(400);
    expect(database.query.mock.calls.length).toBe(calls);
  });
  it("saves ordered resource references and isolates both users and domains", async () => {
    const config = { ...defaultPersonalWorkspace(), layout: "data", dashboardIds: ["second", "first"], applicationIds: ["app-a"] };
    const saved = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    expect(saved.status).toBe(200);
    expect(await (await fetch(base)).json()).toEqual({ data: config });
    const otherOwners: Record<string, string>[] = [{ "test-user": "bob" }, { "test-domain": "domain-b" }];
    for (const headers of otherOwners) {
      expect(await (await fetch(base, { headers })).json()).toEqual({ data: defaultPersonalWorkspace() });
    }
  });
  it.each([
    { ...defaultPersonalWorkspace(), dashboardIds: ["same", "same"] },
    { ...defaultPersonalWorkspace(), layout: "unknown" },
    { ...defaultPersonalWorkspace(), userId: "someone-else" },
    { ...defaultPersonalWorkspace(), applicationIds: Array.from({ length: 101 }, (_, i) => `app-${i}`) },
  ])("rejects invalid or caller-supplied ownership without writing", async config => {
    const calls = database.query.mock.calls.length;
    expect((await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) })).status).toBe(400);
    expect(database.query.mock.calls.length).toBe(calls);
  });
});
