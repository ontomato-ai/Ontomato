import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { createRuntimeHttp } from "../http";
import type { AgentRuntime } from "../runtime";
import { LogQueryError } from "@ontomato/service-logging";

it("exposes service evidence only to an authenticated host and preserves unavailable storage", async () => {
  const query = vi.fn().mockRejectedValue(new LogQueryError(503, "LOG_STORE_UNAVAILABLE", "Service log store is unavailable"));
  const runtime = { options: { hosts: [{ id: "fixture-host", token: "fixture-secret" }] }, logs: { query } } as unknown as AgentRuntime;
  const server = createRuntimeHttp(runtime).listen(0, "127.0.0.1");
  await new Promise<void>(done => server.once("listening", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/logs`;
  try {
    expect((await fetch(url, { headers: { "X-Correlation-Id": "fixture" } })).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    const headers = { Authorization: "Bearer fixture-secret", "X-Correlation-Id": "fixture" };
    const unavailable = await fetch(url, { headers });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: { code: "LOG_STORE_UNAVAILABLE", message: "Service log store is unavailable" }, correlationId: "fixture" });
    const page = { service: "agent-runtime", records: [], nextCursor: null, window: { from: "2026-10-28T00:00:00.000Z", to: "2026-10-28T01:00:00.000Z" }, storage: { mode: "best-effort", retentionDays: 7 } };
    query.mockResolvedValue(page);
    const empty = await fetch(url, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual(page);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
