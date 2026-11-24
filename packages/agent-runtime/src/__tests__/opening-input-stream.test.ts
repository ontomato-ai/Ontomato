import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { runtimeStartRunRequestSchema, type RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { runtimeStreamFrameSchema } from "@ontomato/contracts/agent-runtime-events";
import { createRuntimeHttp } from "../http";
import { AgentRuntime } from "../runtime";
import { canonical, RuntimeStore } from "../store";

it("writes the same image-bearing opening input that a client reads from the SSE stream", async () => {
  const scope = { hostId: "host", domainId: "domain" };
  const runId = "11111111-1111-4111-8111-111111111111", sessionId = "22222222-2222-4222-8222-222222222222";
  const request = runtimeStartRunRequestSchema.parse({
    language: "en", definition: { systemPrompt: "", modelId: null, skills: [], externalMcp: [], sandbox: { limits: {} } },
    environment: { values: {}, secrets: {} },
    input: { role: "user", timestamp: 1, content: [
      { type: "text", text: "Read the attached image" }, { type: "image", mimeType: "image/png", data: "AA==" },
    ] },
  });
  const run: RuntimeRun = {
    id: runId, sessionId, domainId: scope.domainId, correlationId: runId, language: request.language,
    definition: request.definition, status: "running", createdAt: new Date(0).toISOString(), finishedAt: null,
    stopReason: null, errorMessage: null, answerMessageId: null, workspaceCommit: null,
    resolvedSkills: [], environment: { values: {}, secretNames: [] },
  };
  const frames: { cursor: { streamId: string } }[] = [];
  const client = {
    async query(sql: string, params: unknown[]) {
      if (sql.includes("SELECT * FROM sessions")) return { rows: [{ message_seq: 0 }] };
      if (sql.startsWith("INSERT INTO events")) frames.push(params[4] as typeof frames[number]);
      return { rows: [] };
    },
  };
  const store = Object.assign(Object.create(RuntimeStore.prototype) as RuntimeStore, {
    transaction: async (operation: (c: typeof client) => Promise<unknown>) => operation(client),
    table: (table: string) => table,
    admission: async () => false,
    session: async () => ({ workspaceId: null }),
    run: async () => ({ run, seq: frames.length, streamId: frames[0].cursor.streamId }),
  });
  const accepted = await store.admit(scope, run, "fixture", request.input, "pi");
  const runtime = Object.assign(Object.create(AgentRuntime.prototype) as AgentRuntime, {
    store,
    options: { hosts: [{ id: scope.hostId, token: "test-host-token" }] },
    active: new Map([[canonical([scope.hostId, scope.domainId, runId]), { frames, lostThrough: 0, subscribers: new Set() }]]),
    locks: new Map(),
  });
  const server = createRuntimeHttp(runtime).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/runs/${runId}/events?afterSeq=0&streamId=${frames[0].cursor.streamId}`,
      { headers: { authorization: "Bearer test-host-token", "x-domain-id": scope.domainId, "x-correlation-id": "fixture" } },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receipt;
    while (!receipt) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;
      for (const part of parts) {
        const data = part.split("\n").find(line => line.startsWith("data: "));
        if (!data) continue;
        const frame = runtimeStreamFrameSchema.parse(JSON.parse(data.slice(6)));
        if (frame.type === "event" && frame.envelope.event.type === "input_received") receipt = frame.envelope.event;
      }
    }
    await reader.cancel();
    expect(receipt).toMatchObject({ messageId: accepted.inputId, message: request.input });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});
