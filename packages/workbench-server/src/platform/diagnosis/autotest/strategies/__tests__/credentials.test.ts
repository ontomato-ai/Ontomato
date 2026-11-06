import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { executeApiChat } from "../api-chat";

afterEach(() => { vi.unstubAllGlobals(); });

it.each(["apiKey", "token"] as const)("propagates the verified %s through listing, admission and cancellation", async (kind) => {
  const abort = new AbortController();
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string>; method?: string }) => {
    calls.push({ url, headers: init.headers });
    if (url.endsWith("/agents")) return new Response(JSON.stringify({ agents: [{ id: randomUUID(), name: "Assistant", description: "", icon: null, enabled: true }] }));
    if (url.endsWith("/runs") && init.method === "POST") abort.abort();
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetch);
  const result = await executeApiChat({ domainId: "d", question: "q", signal: abort.signal, ...(kind === "apiKey" ? { apiKey: "internal-test-key" } : { tk: "test-login" }) });
  expect(result.status).toBe("cancelled");
  expect(calls).toHaveLength(4);
  expect(calls.at(-1)?.url).toContain("/cancel");
  for (const call of calls) {
    expect(call.headers[kind === "apiKey" ? "X-API-Key" : "tk"]).toBe(kind === "apiKey" ? "internal-test-key" : "test-login");
    expect(call.headers[kind === "apiKey" ? "tk" : "X-API-Key"]).toBeUndefined();
  }
});
