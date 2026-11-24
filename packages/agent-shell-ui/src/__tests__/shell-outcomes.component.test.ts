import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import type { AgentHostRun, AgentHostRunSnapshot, AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeAssistantMessage } from "@ontomato/contracts/agent-runtime-messages";
import { applyEnvelope, applyHistoryPage, applyRunSnapshot, emptyConversation } from "../conversation";
import { conversationItems, type ResponseItem } from "../view";
import ShellResponse from "../components/ShellResponse.vue";
import { shellContextKey, type ShellContext } from "../context";

const sessionId = "22222222-2222-4222-8222-222222222222";
const runId = "11111111-1111-4111-8111-111111111111";
const streamId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";
const reply2Id = "66666666-6666-4666-8666-666666666666";

const labels = {
  working: "Working",
  thinking: "Thinking",
  preparing: "Preparing",
  steps: (count: number) => `${count} steps`,
  elapsed: (time: string) => time,
  worked: (time: string) => `Worked ${time}`,
  toolRead: "Read",
  toolWrite: "Write",
  toolEdit: "Edit",
  toolBash: "Run",
  toolSkill: "Skill",
  activitySchema: "Inspect ontology",
  activityValues: "Probe values",
  activityQuery: "Run query",
  activityKnowledge: "Search metrics",
  activityDataset: "Prepare dataset",
  activityCompute: "Run calculation",
  toolInput: "Input",
  toolOutput: "Output",
  toolOutcomeUnknown: "Outcome unknown",
  toolOutcomeUnknownHint: "No result was received for this tool call; its effect is unknown.",
  runDetails: {
    fileAdded: "Added file",
    fileModified: "Modified file",
    fileDeleted: "Deleted file",
    compaction: "Context compaction",
    diagnostic: "Diagnostic",
    attachment: "Attachment",
    hook: "Hook",
    model: "Model",
    moderation: "Moderation",
    review: "Review",
    patch: "Patch",
  },
  usage: {
    tokens: (count: number) => `${count.toLocaleString("en-US")} tokens`,
    input: (count: number) => `Input ${count.toLocaleString("en-US")}`,
    output: (count: number) => `Output ${count.toLocaleString("en-US")}`,
    cacheRead: (count: number) => `Cache read ${count.toLocaleString("en-US")}`,
    cacheWrite: (count: number) => `Cache write ${count.toLocaleString("en-US")}`,
    reasoning: (count: number) => `Reasoning ${count.toLocaleString("en-US")}`,
    lastCall: (count: number) => `Last call ${count.toLocaleString("en-US")}`,
  },
  stopped: "Stopped",
  truncated: "Truncated",
  failed: "Failed",
  copy: "Copy",
  copied: "Copied",
  like: "Like",
  dislike: "Dislike",
  feedbackReason: "Reason",
  submit: "Submit",
  cancel: "Cancel",
};

function envelope(seq: number, event: RuntimeEventEnvelope["event"], tsMs = seq * 1000): RuntimeEventEnvelope {
  return { sessionId, cursor: { runId, seq, streamId }, timestamp: new Date(tsMs).toISOString(), event };
}

function makeRun(overrides: Partial<AgentHostRun> = {}): AgentHostRun {
  return {
    id: runId,
    sessionId,
    status: "running",
    stopReason: null,
    errorMessage: null,
    answerMessageId: null,
    workspaceCommit: null,
    createdAt: new Date(0).toISOString(),
    finishedAt: null,
    resolvedSkills: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<AgentHostRunSnapshot> = {}): AgentHostRunSnapshot {
  return {
    run: makeRun(),
    cursor: { runId, seq: 1, streamId },
    messages: [
      { id: userId, runId, messageSeq: 0, contextSeq: 0, message: { role: "user", content: "Run check", timestamp: 1 } },
    ],
    pendingQuestions: [],
    pendingMessages: [],
    toolExecutions: [],
    artifacts: [],
    ...overrides,
  };
}

function makeHistory(
  messages: AgentHostSessionHistory["messages"],
  runs: AgentHostSessionHistory["runs"],
): AgentHostSessionHistory {
  return {
    session: { id: sessionId, agentId: "agent-1" } as unknown as AgentHostSessionHistory["session"],
    messages,
    pendingQuestions: [],
    runs,
    latestRun: null,
    page: { messageSeq: messages.length, olderCursor: null, nextCursor: null, throughCursor: "" },
  };
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mountResponse(item: ResponseItem) {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(ShellResponse, { item, sessionId }) });
  app.provide(shellContextKey, {
    labels: ref(labels),
    slots: {},
    toolRenderers: ref([]),
    questions: {
      pending: ref([]),
      sending: ref(false),
      answer: async () => {},
      view: reactive({ open: false, current: null, drafts: {}, skipped: [] }),
    },
  } as unknown as ShellContext);
  app.mount(root);
  return root;
}

describe("tool outcome tri-state", () => {
  it("projects outcome=unknown distinctly from failure in live stream, snapshot, and history", () => {
    const assistantTools: RuntimeAssistantMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-ok", name: "read", arguments: { path: "a.txt" } },
        { type: "toolCall", id: "call-fail", name: "bash", arguments: { command: "false" } },
        { type: "toolCall", id: "call-unknown", name: "bash", arguments: { command: "deploy.sh" } },
        { type: "toolCall", id: "call-legacy", name: "bash", arguments: { command: "legacy" } },
      ],
      api: null,
      provider: null,
      model: null,
      usage: null,
      stopReason: "toolUse",
      timestamp: 2000,
    };

    // 1. Live stream: outcome=unknown wins even when isError=true; omitted outcome falls back to isError.
    const live = emptyConversation(sessionId);
    applyRunSnapshot(live, makeSnapshot());
    applyEnvelope(live, envelope(2, { type: "message_end", messageId: replyId, messageSeq: 1, contextSeq: 1, message: assistantTools }));
    applyEnvelope(live, envelope(3, { type: "tool_execution_start", toolCallId: "call-ok", toolName: "read", args: { path: "a.txt" } }));
    applyEnvelope(live, envelope(4, {
      type: "tool_execution_end", toolCallId: "call-ok", toolName: "read",
      result: { content: [{ type: "text", text: "ok" }], details: { artifactIds: [] } },
      isError: false, outcome: "success",
    }));
    applyEnvelope(live, envelope(5, { type: "tool_execution_start", toolCallId: "call-fail", toolName: "bash", args: { command: "false" } }));
    applyEnvelope(live, envelope(6, {
      type: "tool_execution_end", toolCallId: "call-fail", toolName: "bash",
      result: { content: [{ type: "text", text: "exit 1" }], details: { artifactIds: [] } },
      isError: true, outcome: "failure",
    }));
    applyEnvelope(live, envelope(7, { type: "tool_execution_start", toolCallId: "call-unknown", toolName: "bash", args: { command: "deploy.sh" } }));
    applyEnvelope(live, envelope(8, {
      type: "tool_execution_end", toolCallId: "call-unknown", toolName: "bash",
      result: { content: [], details: { artifactIds: [] } },
      isError: true, outcome: "unknown",
    }));
    applyEnvelope(live, envelope(9, { type: "tool_execution_start", toolCallId: "call-legacy", toolName: "bash", args: { command: "legacy" } }));
    applyEnvelope(live, envelope(10, {
      type: "tool_execution_end", toolCallId: "call-legacy", toolName: "bash",
      result: { content: [{ type: "text", text: "boom" }], details: { artifactIds: [] } },
      isError: true,
    }));
    applyEnvelope(live, envelope(11, {
      type: "agent_end", messages: [], status: "stopped", stopReason: "aborted",
      errorMessage: null, answerMessageId: null, workspaceCommit: null,
    }));

    const liveResponse = conversationItems(live).find((item): item is ResponseItem => item.kind === "response")!;
    const liveSteps = liveResponse.process.find((block) => block.kind === "steps")!;
    expect(liveSteps.kind === "steps" && liveSteps.steps.map((s) => s.status)).toEqual([
      "completed",
      "failed",
      "unknown",
      "failed",
    ]);

    // 2. Snapshot projection matches live statuses.
    const snap = emptyConversation(sessionId);
    applyRunSnapshot(snap, makeSnapshot({
      run: makeRun({ status: "stopped", stopReason: "aborted", finishedAt: new Date(11000).toISOString() }),
      messages: [
        { id: userId, runId, messageSeq: 0, contextSeq: 0, message: { role: "user", content: "Run check", timestamp: 1 } },
        { id: replyId, runId, messageSeq: 1, contextSeq: 1, message: assistantTools },
      ],
      toolExecutions: [
        { toolCallId: "call-ok", toolName: "read", args: { path: "a.txt" }, status: "completed", result: { content: [{ type: "text", text: "ok" }], details: { artifactIds: [] } } },
        { toolCallId: "call-fail", toolName: "bash", args: { command: "false" }, status: "failed", result: { content: [{ type: "text", text: "exit 1" }], details: { artifactIds: [] } } },
        { toolCallId: "call-unknown", toolName: "bash", args: { command: "deploy.sh" }, status: "unknown", result: null },
        { toolCallId: "call-legacy", toolName: "bash", args: { command: "legacy" }, status: "failed", result: { content: [{ type: "text", text: "boom" }], details: { artifactIds: [] } } },
      ],
    }));
    const snapResponse = conversationItems(snap).find((item): item is ResponseItem => item.kind === "response")!;
    const snapSteps = snapResponse.process.find((block) => block.kind === "steps")!;
    expect(snapSteps.kind === "steps" && snapSteps.steps.map((s) => s.status)).toEqual([
      "completed",
      "failed",
      "unknown",
      "failed",
    ]);

    // 3. History replay (settled messages without a toolResult for the unsettled call) matches live statuses.
    const hist = emptyConversation(sessionId);
    applyHistoryPage(hist, makeHistory([
      { id: userId, runId, messageSeq: 0, contextSeq: 0, message: { role: "user", content: "Run check", timestamp: 1 } },
      { id: replyId, runId, messageSeq: 1, contextSeq: 1, message: assistantTools },
      { id: "77777777-7777-4777-8777-777777777771", runId, messageSeq: 2, contextSeq: 2, message: { role: "toolResult", toolCallId: "call-ok", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 4000 } },
      { id: "77777777-7777-4777-8777-777777777772", runId, messageSeq: 3, contextSeq: 3, message: { role: "toolResult", toolCallId: "call-fail", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true, timestamp: 6000 } },
      { id: "77777777-7777-4777-8777-777777777773", runId, messageSeq: 4, contextSeq: 4, message: { role: "toolResult", toolCallId: "call-legacy", toolName: "bash", content: [{ type: "text", text: "boom" }], isError: true, timestamp: 10000 } },
    ], [makeRun({ status: "stopped", stopReason: "aborted", finishedAt: new Date(11000).toISOString() })]));
    const histResponse = conversationItems(hist).find((item): item is ResponseItem => item.kind === "response")!;
    const histSteps = histResponse.process.find((block) => block.kind === "steps")!;
    expect(histSteps.kind === "steps" && histSteps.steps.map((s) => s.status)).toEqual([
      "completed",
      "failed",
      "unknown",
      "failed",
    ]);
  });

  it("renders unknown outcome visually distinct from failed and completed in ShellResponse", async () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, makeSnapshot({
      run: makeRun({ status: "stopped", stopReason: "aborted", finishedAt: new Date(5000).toISOString() }),
      messages: [
        { id: userId, runId, messageSeq: 0, contextSeq: 0, message: { role: "user", content: "Deploy", timestamp: 1 } },
        {
          id: replyId, runId, messageSeq: 1, contextSeq: 1,
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "c1", name: "bash", arguments: { command: "false" } },
              { type: "toolCall", id: "c2", name: "bash", arguments: { command: "deploy.sh" } },
            ],
            api: null, provider: null, model: null, usage: null, stopReason: "toolUse", timestamp: 2000,
          },
        },
      ],
      toolExecutions: [
        { toolCallId: "c1", toolName: "bash", args: { command: "false" }, status: "failed", result: { content: [{ type: "text", text: "err" }], details: { artifactIds: [] } } },
        { toolCallId: "c2", toolName: "bash", args: { command: "deploy.sh" }, status: "unknown", result: null },
      ],
    }));

    const item = conversationItems(state).find((entry): entry is ResponseItem => entry.kind === "response")!;
    const root = mountResponse(item);
    await nextTick();

    // Stopped response surfaces the unknown indicator right on the process line; clicking reveals the process.
    const unknownButton = root.querySelector<HTMLButtonElement>(".process-unknown");
    expect(unknownButton?.textContent).toContain("Outcome unknown");
    unknownButton!.click();
    await nextTick();

    // Folded steps line also shows the unknown badge.
    expect(root.querySelector(".summary-unknown")?.textContent).toContain("Outcome unknown");

    // Expand steps to inspect individual tool rows.
    root.querySelector<HTMLButtonElement>(".process-summary")!.click();
    await nextTick();

    const failedRow = root.querySelector<HTMLButtonElement>('[data-tool-status="failed"]')!;
    const unknownRow = root.querySelector<HTMLButtonElement>('[data-tool-status="unknown"]')!;
    expect(failedRow.querySelector(".status.failed")).not.toBeNull();
    expect(failedRow.querySelector(".status-badge.unknown")).toBeNull();
    expect(unknownRow.querySelector(".status-badge.unknown")?.textContent).toContain("Outcome unknown");
    expect(unknownRow.querySelector(".status.failed")).toBeNull();
    expect(unknownRow.querySelector(".status.done")).toBeNull();

    // Expanding the unknown tool row displays the explanatory hint.
    unknownRow.click();
    await nextTick();
    expect(root.querySelector(".unknown-note")?.textContent).toContain("No result was received");
  });
});

describe("generic process entries (run_detail)", () => {
  it("replaces details by key in place, accumulates distinct keys, and renders patches and diagnostics", async () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, makeSnapshot());
    applyEnvelope(state, envelope(2, {
      type: "run_detail",
      detail: {
        key: "compaction:1",
        category: "compaction",
        scope: "run",
        ref: null,
        status: "started",
        text: "Compacting context (threshold)",
      },
    }, 1000));
    applyEnvelope(state, envelope(3, {
      type: "run_detail",
      detail: {
        key: "compaction:1",
        category: "compaction",
        scope: "run",
        ref: null,
        status: "completed",
        text: "Context compacted",
      },
    }, 2000));
    applyEnvelope(state, envelope(4, {
      type: "run_detail",
      detail: {
        key: "file:src/app.ts",
        category: "file_change",
        scope: "run",
        ref: null,
        path: "src/app.ts",
        operation: "modified",
        patch: "@@ -1 +1 @@\n-old\n+new",
        text: "Updated app entry",
      },
    }, 3000));
    applyEnvelope(state, envelope(5, {
      type: "run_detail",
      detail: {
        key: "diag:1",
        category: "diagnostic",
        scope: "run",
        ref: null,
        level: "warning",
        action: "Check the workspace permissions.",
        text: "Skipped unwritable cache file",
      },
    }, 4000));
    applyEnvelope(state, envelope(6, {
      type: "message_end",
      messageId: replyId,
      messageSeq: 1,
      contextSeq: 1,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
        api: null, provider: null, model: null, usage: null, stopReason: "stop", timestamp: 5000,
      },
    }, 5000));
    applyEnvelope(state, envelope(7, {
      type: "agent_end", messages: [], status: "stopped", stopReason: "stop",
      errorMessage: null, answerMessageId: replyId, workspaceCommit: null,
    }, 6000));

    const item = conversationItems(state).find((entry): entry is ResponseItem => entry.kind === "response")!;
    const detailBlocks = item.process.filter((block) => block.kind === "detail");
    expect(detailBlocks).toHaveLength(3);
    expect(detailBlocks.map((b) => b.kind === "detail" ? b.detail.text : "")).toEqual([
      "Context compacted",
      "Updated app entry",
      "Skipped unwritable cache file",
    ]);

    const root = mountResponse(item);
    await nextTick();
    root.querySelector<HTMLButtonElement>("button.process-toggle")!.click();
    await nextTick();

    expect(root.querySelector('[data-detail-category="compaction"]')?.textContent).toContain("Context compacted");
    expect(root.querySelector('[data-detail-category="diagnostic"]')?.textContent).toContain("Check the workspace permissions.");

    const fileRow = root.querySelector<HTMLButtonElement>('[data-detail-category="file_change"] button.detail-row')!;
    expect(fileRow.textContent).toContain("src/app.ts");
    expect(root.querySelector('[data-detail-category="file_change"] pre')).toBeNull();
    fileRow.click();
    await nextTick();
    expect(root.querySelector('[data-detail-category="file_change"] pre')?.textContent).toContain("+new");
  });
});

describe("token usage display", () => {
  it("replaces standalone usage_updated reports without summing them with assistant.usage", async () => {
    const state = emptyConversation(sessionId);
    applyRunSnapshot(state, makeSnapshot());
    applyEnvelope(state, envelope(2, {
      type: "usage_updated",
      usage: {
        last: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        total: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
        turn: "t1",
        messageId: null,
      },
    }));
    applyEnvelope(state, envelope(3, {
      type: "usage_updated",
      usage: {
        last: { input: 200, output: 80, cacheRead: 20, cacheWrite: 0, reasoning: 10, totalTokens: 310 },
        total: { input: 300, output: 130, cacheRead: 20, cacheWrite: 0, reasoning: 10, totalTokens: 460 },
        turn: "t1",
        messageId: replyId,
      },
    }));
    applyEnvelope(state, envelope(4, {
      type: "message_end",
      messageId: replyId,
      messageSeq: 1,
      contextSeq: 1,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
        api: null, provider: null, model: null,
        usage: { input: 999, output: 999, cacheRead: 0, cacheWrite: 0, totalTokens: 1998, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 5000,
      },
    }));
    applyEnvelope(state, envelope(5, {
      type: "agent_end", messages: [], status: "stopped", stopReason: "stop",
      errorMessage: null, answerMessageId: replyId, workspaceCommit: null,
    }));

    const item = conversationItems(state).find((entry): entry is ResponseItem => entry.kind === "response")!;
    expect(item.usage).toEqual({
      counts: { input: 300, output: 130, cacheRead: 20, cacheWrite: 0, reasoning: 10, totalTokens: 460 },
      last: { input: 200, output: 80, cacheRead: 20, cacheWrite: 0, reasoning: 10, totalTokens: 310 },
    });

    const root = mountResponse(item);
    await nextTick();
    const toggle = root.querySelector<HTMLButtonElement>(".usage-entry")!;
    expect(toggle.textContent).toContain("460 tokens");
    expect(root.querySelector(".usage-breakdown")).toBeNull();

    toggle.click();
    await nextTick();
    const breakdown = root.querySelector(".usage-breakdown")?.textContent ?? "";
    expect(breakdown).toContain("Input 300");
    expect(breakdown).toContain("Output 130");
    expect(breakdown).toContain("Cache read 20");
    expect(breakdown).toContain("Reasoning 10");
    expect(breakdown).toContain("Last call 310");
  });

  it("sums settled assistant.usage across steps of a run in history replay", () => {
    const state = emptyConversation(sessionId);
    const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    applyHistoryPage(state, makeHistory([
      { id: userId, runId, messageSeq: 0, contextSeq: 0, message: { role: "user", content: "Hi", timestamp: 1 } },
      {
        id: replyId, runId, messageSeq: 1, contextSeq: 1,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.txt" } }],
          api: null, provider: null, model: null,
          usage: { input: 400, output: 50, cacheRead: 100, cacheWrite: 0, totalTokens: 550, cost: zeroCost },
          stopReason: "toolUse", timestamp: 2000,
        },
      },
      { id: "77777777-7777-4777-8777-777777777774", runId, messageSeq: 2, contextSeq: 2, message: { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3000 } },
      {
        id: reply2Id, runId, messageSeq: 3, contextSeq: 3,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final answer" }],
          api: null, provider: null, model: null,
          usage: { input: 500, output: 120, cacheRead: 200, cacheWrite: 30, totalTokens: 850, cost: zeroCost },
          stopReason: "stop", timestamp: 4000,
        },
      },
    ], [makeRun({ status: "stopped", stopReason: "stop", answerMessageId: reply2Id, finishedAt: new Date(5000).toISOString() })]));

    const item = conversationItems(state).find((entry): entry is ResponseItem => entry.kind === "response")!;
    expect(item.usage).toEqual({
      counts: { input: 900, output: 170, cacheRead: 300, cacheWrite: 30, totalTokens: 1400 },
    });
  });
});
