import { expect, it, vi } from "vitest";
import { AgentRuntime } from "../runtime";
import { RuntimeStore } from "../store";

const scope = { hostId: "host", domainId: "domain" };

it("writes an unknown outcome for an unfinished dispatched call before closing the run", async () => {
  const messages: Array<{ message: unknown }> = [{ message: { role: "assistant", stopReason: "toolUse", content: [
    { type: "toolCall", id: "dispatched", name: "wait", arguments: {} },
  ] } }];
  const append = vi.fn(async (_scope, _id, event) => {
    if (event.type === "message_end") messages.push({ message: event.message });
    return { event };
  });
  const fakeStore = { pool: {}, run: async () => ({ run: { sessionId: "session", workspaceCommit: null } }),
    messages: async () => messages,
    toolEvents: async () => [{ event: { type: "tool_execution_start", toolCallId: "dispatched", toolName: "wait", args: {} } }],
    append };
  await RuntimeStore.prototype.finish.call(fakeStore as unknown as RuntimeStore, scope, "run", "aborted", "Run cancelled");
  const events = append.mock.calls.map(call => call[2]);
  expect(events.at(-1)!.type).toBe("agent_end");
  expect(events.find(event => event.type === "agent_end")).toMatchObject({ stopReason: "aborted", answerMessageId: null });
  expect(events).toContainEqual(expect.objectContaining({ type: "tool_execution_end", toolCallId: "dispatched", outcome: "unknown" }));
  expect(messages[1].message).toMatchObject({ role: "toolResult", toolCallId: "dispatched", isError: true, outcome: "unknown" });
  expect(messages.at(-1)!.message).toMatchObject({ role: "assistant", stopReason: "aborted" });
});

it("reports unknown in both live snapshot and history messages for a cancelled tool call", async () => {
  const messages: Array<{ id: string; runId: string; messageSeq: number; contextSeq: number | null; message: unknown }> = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      messageSeq: 1,
      contextSeq: 1,
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "dispatched", name: "wait", arguments: { seconds: 30 } },
          { type: "toolCall", id: "ended-unknown", name: "deploy", arguments: {} },
        ],
        api: null,
        provider: null,
        model: null,
        usage: null,
        timestamp: 1000,
      },
    },
  ];
  const toolEvents = [
    { event: { type: "tool_execution_start", toolCallId: "dispatched", toolName: "wait", args: { seconds: 30 } } },
    { event: { type: "tool_execution_start", toolCallId: "ended-unknown", toolName: "deploy", args: {} } },
    {
      event: {
        type: "tool_execution_end",
        toolCallId: "ended-unknown",
        toolName: "deploy",
        result: { content: [], details: { artifactIds: [] } },
        isError: true,
        outcome: "unknown",
      },
    },
  ];
  const runRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    sessionId: "33333333-3333-4333-8333-333333333333",
    status: "stopped" as const,
    stopReason: "aborted" as const,
    workspaceCommit: null,
  };
  let seq = 1;
  const append = vi.fn(async (_scope, _id, event) => {
    if (event.type === "message_end") {
      messages.push({
        id: event.messageId,
        runId: runRecord.id,
        messageSeq: ++seq,
        contextSeq: event.contextSeq,
        message: event.message,
      });
    }
    return { event };
  });
  const fakeStore = {
    pool: {},
    run: async () => ({ run: runRecord, seq, streamId: "44444444-4444-4444-8444-444444444444" }),
    messages: async () => messages,
    consumedInputs: async () => [],
    runPresentation: async () => new Map(),
    toolEvents: async () => toolEvents,
    artifacts: async () => [],
    append,
  };
  await RuntimeStore.prototype.finish.call(fakeStore as unknown as RuntimeStore, scope, runRecord.id, "aborted", "Run cancelled");

  const fakeRuntime = {
    store: fakeStore,
    active: new Map(),
    channel: { facts: { pendingQuestions: async () => [] } },
  };
  const snapshot = await (
    AgentRuntime.prototype as unknown as {
      snapshotUnlocked(scope: unknown, runId: string, includeHistory?: boolean): Promise<{
        toolExecutions: Array<{ toolCallId: string; status: string }>;
        messages: Array<{ message: { role: string; toolCallId?: string; isError?: boolean; outcome?: string } }>;
      }>;
    }
  ).snapshotUnlocked.call(fakeRuntime, scope, runRecord.id, true);

  expect(snapshot.toolExecutions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ toolCallId: "dispatched", status: "unknown" }),
      expect.objectContaining({ toolCallId: "ended-unknown", status: "unknown" }),
    ]),
  );
  const settledResult = snapshot.messages.find(
    (entry) => entry.message.role === "toolResult" && entry.message.toolCallId === "dispatched",
  );
  expect(settledResult?.message).toMatchObject({ isError: true, outcome: "unknown" });
});
