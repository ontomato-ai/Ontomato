import { describe, expect, it, vi } from "vitest";
import { createSchedulesApi } from "../api";
import { task, run } from "./fixtures";

/** A host whose one request records its calls and answers what the test needs. */
function fakeHost(answer: (path: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { path: string; init: RequestInit }[] = [];
  const request = vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    const { status = 200, body } = answer(path, init);
    return {
      status,
      ok: status < 400,
      json: async () => body,
    } as Response;
  });
  return { host: { request, agents: async () => [], functions: async () => [] }, calls, request };
}

const base = "/api/data-query/platform/scheduled-tasks";

describe("schedules api", () => {
  it("lists everything when nothing is narrowed, and one agent's tasks when asked", async () => {
    const { host, calls } = fakeHost(() => ({ body: { tasks: [], timeZone: "Asia/Shanghai" } }));
    const api = createSchedulesApi(host);

    await expect(api.list()).resolves.toEqual({ tasks: [], timeZone: "Asia/Shanghai" });
    await api.list({ agentId: "agent-1" });
    await api.list({ appId: "ontology", agentId: "agent-1" });

    expect(calls.map((call) => call.path)).toEqual([
      base,
      `${base}?agentId=agent-1`,
      `${base}?appId=ontology&agentId=agent-1`,
    ]);
    expect(calls[0]!.init.method).toBeUndefined();
  });

  it("renews the credential with a write request, and creates switched off when asked", async () => {
    const { host, calls } = fakeHost((path) =>
      path.endsWith("/credential/renew")
        ? { status: 204 }
        : { status: 201, body: task({ name: "Nightly" }) },
    );
    const api = createSchedulesApi(host);

    await expect(api.renewCredential()).resolves.toBeUndefined();
    const created = await api.create(
      { name: "Nightly", description: null, target: { kind: "function", functionId: "f-1" }, frequency: { kind: "daily", time: "09:00" }, timeZone: "Asia/Shanghai", notifyEmail: null },
      false,
    );

    expect(created.name).toBe("Nightly");
    expect(calls[0]!.path).toBe(`${base}/credential/renew`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[1]!.path).toBe(`${base}?enabled=false`);
    // The service replays a repeated create by this key, so it is the browser's own UUID.
    expect((calls[1]!.init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("toggles, runs now and pages the history on the task's own paths", async () => {
    const { host, calls } = fakeHost((path, init) => {
      // A manual run is the POST; the bare history path arrives twice, once with the next page's cursor.
      if (init.method === "POST") return { status: 202, body: run() };
      // A read carries no method of its own; only the manual run and the writes do.
      if (!init.method && path.includes("/runs")) return { body: { runs: [], nextCursor: null } };
      return { body: task({ enabled: true }) };
    });
    const api = createSchedulesApi(host);

    await api.setEnabled("task-1", false);
    await api.runNow("task-1");
    await api.runs("task-1", null);
    await api.runs("task-1", "cursor-2");
    await api.remove("task-1");

    expect(calls.map((call) => [call.init.method ?? "GET", call.path])).toEqual([
      ["PUT", `${base}/task-1/enabled`],
      ["POST", `${base}/task-1/runs`],
      ["GET", `${base}/task-1/runs`],
      ["GET", `${base}/task-1/runs?cursor=cursor-2`],
      ["DELETE", `${base}/task-1`],
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ enabled: false });
    expect((calls[1]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
  });

  it("refuses a response the contract does not describe instead of half-rendering it", async () => {
    const { host } = fakeHost(() => ({ body: { tasks: [{ id: "not-a-uuid" }], timeZone: "UTC" } }));
    await expect(createSchedulesApi(host).list()).rejects.toThrow();
  });

  it("reads the host's error code from a nested error body", () => {
    const { host } = fakeHost(() => ({}));
    const api = createSchedulesApi(host);
    expect(api.errorCode({ body: { error: { code: "SCHEDULED_TASK_BUSY" } } })).toBe("SCHEDULED_TASK_BUSY");
    expect(api.errorCode({ body: { code: "NOT_FOUND" } })).toBe("NOT_FOUND");
    expect(api.errorCode(new Error("plain"))).toBeNull();
  });
});
