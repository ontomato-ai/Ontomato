import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { executeApiChat } from "../api-chat";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

it("uses the settled chain's final reply and its finish time", async () => {
  vi.useFakeTimers();
  const started = new Date("2026-11-28T02:00:00.000Z");
  vi.setSystemTime(started);
  const agentId = randomUUID(), finalRunId = randomUUID(), answerId = randomUUID();
  const finishedAt = new Date(started.getTime() + 135).toISOString();
  let rootRunId = "";
  let firstRead = true;

  vi.stubGlobal("fetch", async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const segments = new URL(url).pathname.split("/");
    if (url.endsWith("/agents")) {
      return Response.json({ agents: [{ id: agentId, name: "Assistant", description: "", icon: null, enabled: true }] });
    }
    if (url.endsWith("/runs") && init.method === "POST") {
      rootRunId = init.headers["Idempotency-Key"];
    }
    if (url.endsWith("/chain")) {
      expect(segments.at(-2)).toBe(rootRunId);
      if (firstRead) {
        firstRead = false;
        return Response.json({ settled: false, latestRunId: rootRunId });
      }
      return Response.json({ settled: true, latestRunId: finalRunId });
    }
    if (init.method === "GET") {
      expect(segments.at(-1)).toBe(finalRunId);
      return Response.json({
        run: {
          id: finalRunId, sessionId: segments.at(-3), status: "stopped", stopReason: "stop",
          errorMessage: null, answerMessageId: answerId, workspaceCommit: null,
          createdAt: started.toISOString(), finishedAt, resolvedSkills: [],
        },
        cursor: { runId: finalRunId, streamId: randomUUID(), seq: 1 },
        messages: [{
          id: answerId, runId: finalRunId, messageSeq: 1, contextSeq: 1,
          message: {
            role: "assistant", content: [{ type: "text", text: "Revised answer" }],
            api: null, provider: null, model: null, usage: null, stopReason: "stop",
            timestamp: Date.parse(finishedAt),
          },
        }],
        pendingQuestions: [], pendingMessages: [], toolExecutions: [], artifacts: [],
      });
    }
    return Response.json({});
  });

  const result = executeApiChat({ domainId: "d", question: "q" });
  await vi.advanceTimersByTimeAsync(250);
  await expect(result).resolves.toMatchObject({ status: "success", finalAnswer: "Revised answer", durationMs: 135 });
});
