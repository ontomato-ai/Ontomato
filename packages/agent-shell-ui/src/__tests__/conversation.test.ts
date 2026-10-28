import { describe, expect, it } from "vitest";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import type { ShellRunSnapshot } from "@ontomato/contracts/agent-shell";
import { applyEnvelope, applyRunSnapshot, emptyConversation } from "../conversation";
import { conversationItems } from "../view";

const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const streamId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";

function envelope(seq: number, event: RuntimeEventEnvelope["event"]): RuntimeEventEnvelope {
  return { sessionId, cursor: { runId, seq, streamId }, timestamp: new Date(0).toISOString(), event };
}

const snapshot: ShellRunSnapshot = {
  run: { id: runId, status: "running", stopReason: null, errorMessage: null },
  cursor: { runId, seq: 3, streamId },
  messages: [
    { id: userId, runId, messageSeq: 0, message: { role: "user", content: "hello", timestamp: 1 } },
  ],
  pendingMessages: [],
  toolExecutions: [],
  artifacts: [],
};

/** Deltas merge by message ID and content index; replayed sequences apply once. */
describe("conversation projection", () => {
  it("applies streamed deltas once and settles on message_end", () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, snapshot);
    const partial = {
      role: "assistant" as const,
      content: [],
      api: null,
      provider: null,
      model: null,
      usage: null,
      stopReason: "pending" as const,
      timestamp: 2,
    };
    applyEnvelope(state, envelope(4, { type: "message_start", messageId: replyId, message: partial }));
    applyEnvelope(state, envelope(5, { type: "message_update", messageId: replyId, assistantMessageEvent: { type: "text_start", contentIndex: 0 } }));
    const delta = envelope(6, { type: "message_update", messageId: replyId, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi" } });
    expect(applyEnvelope(state, delta)).toBe(true);
    expect(applyEnvelope(state, delta)).toBe(false);

    let items = conversationItems(state);
    expect(items.map((item) => item.kind)).toEqual(["user", "response"]);
    expect(items[1]).toMatchObject({ running: true, blocks: [{ kind: "text", text: "Hi", final: false }] });

    applyEnvelope(state, envelope(7, {
      type: "message_end",
      messageId: replyId,
      messageSeq: 1,
      message: { ...partial, content: [{ type: "text", text: "Hi there" }], stopReason: "stop" },
    }));
    applyEnvelope(state, envelope(8, { type: "agent_end", messages: [], status: "stopped", stopReason: "stop", errorMessage: null }));
    items = conversationItems(state);
    expect(items[1]).toMatchObject({
      running: false,
      answerMessageId: replyId,
      answerText: "Hi there",
      end: { stopReason: "stop" },
      blocks: [{ kind: "text", text: "Hi there", final: true }],
    });
  });
});
