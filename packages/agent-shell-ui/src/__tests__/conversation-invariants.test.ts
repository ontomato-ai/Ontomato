import { describe, expect, it, vi } from "vitest";
import type { RuntimeEventEnvelope, RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import type { AgentHostRun, AgentHostRunSnapshot, AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { applyEnvelope, applyHistoryPage, applyRunSnapshot, emptyConversation } from "../conversation";
import { createRunSubscription, type RunSubscription } from "../run-subscription";
import { conversationItems } from "../view";

const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const streamId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";
const partialId = "66666666-6666-4666-8666-666666666666";
const timestamp = new Date(0).toISOString();

const partial = {
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "Half" }],
  api: null,
  provider: null,
  model: null,
  usage: null,
  stopReason: "pending" as const,
  timestamp: 2,
};
const user = { id: userId, runId, messageSeq: 0, message: { role: "user" as const, content: "hello", timestamp: 1 } };

function envelope(seq: number, event: RuntimeEventEnvelope["event"]): RuntimeEventEnvelope {
  return { sessionId, cursor: { runId, seq, streamId }, timestamp, event };
}

const frame = (value: RuntimeEventEnvelope): RuntimeStreamFrame => ({ type: "event", envelope: value });

function run(overrides: Partial<AgentHostRun> = {}): AgentHostRun {
  return {
    id: runId, sessionId, status: "running", stopReason: null, errorMessage: null,
    createdAt: timestamp, finishedAt: null, resolvedSkills: [], retrievals: [], ...overrides,
  };
}

function snapshot(overrides: Partial<AgentHostRunSnapshot> = {}): AgentHostRunSnapshot {
  return {
    run: run(),
    cursor: { runId, seq: 3, streamId },
    messages: [user],
    pendingMessages: [],
    toolExecutions: [],
    artifacts: [],
    ...overrides,
  };
}

function history(
  messages: AgentHostSessionHistory["messages"],
  runs: AgentHostSessionHistory["runs"] = [],
): AgentHostSessionHistory {
  return {
    // Only the fields the projection reads; the page itself is contract-checked where it is parsed.
    session: { id: sessionId } as unknown as AgentHostSessionHistory["session"],
    page: { messageSeq: 0, olderCursor: null, nextCursor: null, throughCursor: "" },
    latestRun: null,
    runs,
    messages,
  };
}

describe("live cut over partials", () => {
  it("replaces a pending message with its settled version instead of keeping both", () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, snapshot({ pendingMessages: [{ id: partialId, message: partial }] }));
    expect(Object.keys(state.messages)).toEqual([userId, partialId]);

    applyRunSnapshot(state, snapshot({
      messages: [
        user,
        { id: partialId, runId, messageSeq: 1, message: { ...partial, content: [{ type: "text", text: "Finished" }], stopReason: "stop" as const } },
      ],
    }));

    expect(Object.keys(state.messages)).toEqual([userId, partialId]);
    const responses = conversationItems(state).filter((item) => item.kind === "response");
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ answerMessageId: partialId, answerText: "Finished" });
  });
});

describe("backward paging", () => {
  it("keeps the newer run state when an older page arrives", () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, snapshot());
    applyEnvelope(state, envelope(4, { type: "agent_end", messages: [], status: "stopped", stopReason: "aborted", errorMessage: null }));

    applyHistoryPage(state, history([], [run({ status: "running" })]), true);

    expect(state.runs[runId]).toMatchObject({ status: "stopped", stopReason: "aborted" });
  });

  it("settles a run's live tools when a forward page shows it stopped", () => {
    const state = emptyConversation(sessionId);
    applyEnvelope(state, envelope(4, {
      type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" },
    }));

    applyHistoryPage(state, history([], [run({ status: "stopped", stopReason: "stop", finishedAt: timestamp })]));

    expect(state.runs[runId].tools["call-1"].status).toBe("unknown");
  });
});

describe("cursor replay", () => {
  it("applies a replayed event once and leaves the projection untouched", () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, snapshot());
    const started = envelope(4, { type: "message_start", messageId: replyId, message: { ...partial, content: [] } });
    expect(applyEnvelope(state, started)).toBe(true);
    const applied = JSON.stringify(state);

    const replayed = envelope(4, { type: "message_start", messageId: partialId, message: partial });

    expect(applyEnvelope(state, replayed)).toBe(false);
    expect(JSON.stringify(state)).toBe(applied);
  });
});

/** Stands in for animation frames: the callback runs on the next microtask, like a real frame. */
function stubFrames() {
  const frames: (() => void)[] = [];
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    queueMicrotask(callback);
    return ++next;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return frames;
}

describe("event stream recovery", () => {
  it("re-reads the snapshot after the queue overflowed and resumes from it", async () => {
    stubFrames();
    try {
      const stream = subscription(async () => [snapshot({ cursor: { runId, seq: 9, streamId } })]);
      createRunSubscription<AgentHostRunSnapshot[]>().start(stream);

      for (let seq = 4; seq <= 2004; seq++) stream.emit(frame(envelope(seq, { type: "agent_start" })));

      await vi.waitFor(() => expect(stream.cursors.length).toBe(2));
      expect(stream.cursors[1]).toMatchObject({ seq: 9, streamId });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("applies the frames queued behind agent_end before stopping", async () => {
    const frames = stubFrames();
    try {
      const stream = subscription(async () => [snapshot()]);
      const applied: string[] = [];
      stream.event = (value) => applied.push(value.event.type);
      createRunSubscription<AgentHostRunSnapshot[]>().start(stream);

      stream.emit(frame(envelope(4, { type: "agent_end", messages: [], status: "stopped", stopReason: "stop", errorMessage: null })));
      stream.emit(frame(envelope(5, {
        type: "artifact_registered",
        artifact: { id: replyId, path: "outputs/a.csv", size: 1 } as RuntimeArtifact,
      })));
      frames.forEach((frame) => frame());

      expect(applied).toEqual(["agent_end", "artifact_registered"]);
      expect(stream.detached()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

type FakeSubscription = RunSubscription<AgentHostRunSnapshot[]> & {
  cursors: { seq: number; streamId: string }[];
  emit(value: RuntimeStreamFrame): void;
  detached(): boolean;
};

/** A run subscription whose applied snapshot becomes its cursor, as the shell's own does. */
function subscription(read: () => Promise<AgentHostRunSnapshot[]>): FakeSubscription {
  const cursors: { seq: number; streamId: string }[] = [];
  let cursor = { seq: 3, streamId };
  let handlers: { frame(value: RuntimeStreamFrame): void; error(error: unknown): void } | null = null;
  return {
    runId,
    cursors,
    read: vi.fn(read),
    current: () => ({
      id: runId, status: "running", stopReason: null, errorMessage: null, createdAt: timestamp,
      finishedAt: null, cursor, artifacts: [], tools: {}, retrievals: [],
    }),
    snapshot(pages) {
      cursor = pages[pages.length - 1]!.cursor;
    },
    event: () => {},
    subscribe(after, next) {
      cursors.push({ ...after });
      handlers = next;
      return () => {
        if (handlers === next) handlers = null;
      };
    },
    emit(value) {
      handlers?.frame(value);
    },
    detached: () => handlers === null,
  };
}
