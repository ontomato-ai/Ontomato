import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, ref } from "vue";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import type { AgentArtifactTarget, AgentRunComplete } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import AgentArtifactPreview from "../components/AgentArtifactPreview.vue";
import AgentChat from "../components/AgentChat.vue";
import ArtifactLinkNode from "../components/ArtifactLinkNode.vue";
import ArtifactView from "../components/ArtifactView.vue";
import { messageContextKey, shellContextKey, type ShellContext } from "../context";
import type { AgentHostClient } from "../host";
import type { ArtifactLinkSlotScope, ArtifactSlotScope, MessageActionContext, OpenArtifact, ShellLabels } from "../types";

const LABELS = {
  placeholder: "Message",
  send: "Send",
  stop: "Stop",
  close: "Close",
  backToFile: "Back",
  download: "Download",
  artifactMissing: "Artifact unavailable",
} as unknown as ShellLabels;

function makeArtifact(overrides: Partial<RuntimeArtifact> = {}): RuntimeArtifact {
  return {
    id: overrides.id ?? "art-1",
    sessionId: overrides.sessionId ?? "sess-1",
    runId: overrides.runId ?? "run-1",
    toolCallId: null,
    path: overrides.path ?? "outputs/report.md",
    sha256: "a".repeat(64),
    size: overrides.size ?? 120,
    mediaType: overrides.mediaType ?? "text/markdown",
    createdAt: "2026-11-28T00:00:00.000Z",
    seq: overrides.seq ?? 1,
  };
}

function makeClient(overrides: Partial<AgentHostClient> = {}): AgentHostClient {
  const defaultArtifact = makeArtifact();
  return {
    listAgents: vi.fn(async () => []),
    listSessions: vi.fn(async () => ({ sessions: [], nextCursor: null })),
    createSession: vi.fn(async () => ({
      id: "sess-1",
      agentId: "agent-a",
      title: "New chat",
      createdAt: "2026-11-28T00:00:00.000Z",
      updatedAt: "2026-11-28T00:00:00.000Z",
    })),
    readHistory: vi.fn(async (id: string) => ({
      session: { id, agentId: "agent-a", title: "Session title", origin: "user" },
      page: { messageSeq: 0, olderCursor: null },
      runs: [],
      messages: [],
      pendingQuestions: [],
      notifications: [],
      latestRun: null,
    })),
    deleteSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    send: vi.fn(async () => ({
      delivery: {
        messageId: "msg-1",
        sessionRef: { providerId: "workbench", sessionId: "sess-1" },
        runId: "run-1",
        delivery: "run",
        status: "stopped",
      },
      input: {
        id: "msg-1",
        runId: "run-1",
        messageSeq: 1,
        contextSeq: 1,
        message: { role: "user", content: "Hello", timestamp: 1 },
      },
      snapshot: {
        run: {
          id: "run-1",
          status: "stopped",
          stopReason: "completed",
          errorMessage: null,
          answerMessageId: "ans-1",
          finishedAt: "2026-11-28T00:00:01.000Z",
        },
        cursor: { seq: 1, streamId: "stream" },
        messages: [{
          id: "ans-1",
          runId: "run-1",
          messageSeq: 2,
          contextSeq: 2,
          message: { role: "assistant", content: [{ type: "text", text: "See [Report](outputs/report.md)" }], timestamp: 2 },
        }],
        pendingMessages: [],
        toolExecutions: [],
        artifacts: [defaultArtifact],
        pendingQuestions: [],
        outcome: { result: "complete" },
      },
      pendingQuestions: [],
    })),
    readRun: vi.fn(async () => ({
      run: {
        id: "run-1",
        status: "stopped",
        stopReason: "completed",
        errorMessage: null,
        answerMessageId: "ans-1",
        finishedAt: "2026-11-28T00:00:01.000Z",
      },
      cursor: { seq: 1, streamId: "stream" },
      messages: [],
      pendingMessages: [],
      toolExecutions: [],
      artifacts: [defaultArtifact],
      pendingQuestions: [],
      outcome: { result: "complete" },
    })),
    subscribe: vi.fn(() => () => {}),
    answerQuestion: vi.fn(),
    cancel: vi.fn(),
    resolveArtifact: vi.fn(async (_sessionId: string, runId: string, path: string) =>
      makeArtifact({ runId, path }),
    ),
    readArtifact: vi.fn(async () => new Blob(["# Hello\n\nSee [Child](outputs/child.md)"], { type: "text/markdown" })),
    sessionRuns: {
      read: vi.fn(async () => ({ sessions: [] })),
      subscribe: vi.fn(() => () => {}),
    },
    ...overrides,
  } as unknown as AgentHostClient;
}

async function flush() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("ArtifactLinkNode #artifact-link and ArtifactView #artifact slots", () => {
  it("passes artifact metadata, open helper, and default card fallback to #artifact-link", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const opened: OpenArtifact[] = [];
    const artifact = makeArtifact({ path: "outputs/report.md" });
    const receivedScopes: ArtifactLinkSlotScope[] = [];

    const app = createApp(() =>
      h(MarkdownView, {
        content: "See [Quarterly Report](outputs/report.md) and [Deck](outputs/slides.pptx)",
        final: true,
        nodes: { link: ArtifactLinkNode },
      }),
    );
    app.provide(shellContextKey, {
      labels: ref(LABELS),
      slots: {
        artifactLink: (scope: ArtifactLinkSlotScope) => {
          receivedScopes.push(scope);
          if (scope.path.endsWith(".md")) {
            return h("button", { class: "custom-link-card", onClick: scope.open }, `Custom:${scope.title}`);
          }
          return h(scope.fallback.component, scope.fallback.props);
        },
      },
      resolveArtifact: async (_runId: string, path: string) =>
        path.endsWith(".md")
          ? artifact
          : makeArtifact({ id: "ppt-1", path, mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
      artifactRevision: ref(0),
      openArtifact: (open: OpenArtifact) => opened.push(open),
      openArtifactKey: ref(null),
      pageLink: () => null,
    } as unknown as ShellContext);
    app.provide(messageContextKey, ref({ runId: "run-1" }));
    app.mount(root);
    try {
      await vi.waitFor(() => expect(root.querySelector(".custom-link-card")).not.toBeNull());
      await vi.waitFor(() => expect(receivedScopes.some((s) => s.path === "outputs/report.md" && s.artifact?.id === "art-1")).toBe(true));
      expect(root.querySelector(".custom-link-card")?.textContent).toBe("Custom:Quarterly Report");
      await vi.waitFor(() => expect(root.querySelector(".ppt-artifact")).not.toBeNull());
      root.querySelector<HTMLButtonElement>(".custom-link-card")!.click();
      expect(opened).toHaveLength(1);
      expect(opened[0]!.artifact.path).toBe("outputs/report.md");
      expect(opened[0]!.title).toBe("Quarterly Report");
    } finally {
      app.unmount();
      root.remove();
    }
  });

  it("passes default renderer fallback to #artifact slot in ArtifactView", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const artifact = makeArtifact({ path: "outputs/note.txt", mediaType: "text/plain" });
    const captured: ArtifactSlotScope[] = [];
    const app = createApp(() =>
      h(ArtifactView, {
        runId: "run-1",
        path: "outputs/note.txt",
        title: "Note",
        presentation: "panel",
        artifact,
      }),
    );
    app.provide(shellContextKey, {
      labels: ref(LABELS),
      artifactRenderers: ref([]),
      artifactRevision: ref(0),
      slots: {
        artifact: (scope: ArtifactSlotScope) => {
          captured.push(scope);
          return h("div", { class: "custom-artifact-wrapper" }, [
            h("span", { class: "custom-title" }, scope.title),
            h(scope.fallback.component, scope.fallback.props),
          ]);
        },
      },
      resolveArtifact: async () => artifact,
      readArtifact: async () => new Blob(["hello world"], { type: "text/plain" }),
      openArtifact: vi.fn(),
      openArtifactKey: ref(null),
      pageLink: () => null,
    } as unknown as ShellContext);
    app.mount(root);
    try {
      await flush();
      expect(root.querySelector(".custom-artifact-wrapper")).not.toBeNull();
      expect(root.querySelector(".custom-title")?.textContent).toBe("Note");
      expect(captured[0]?.component).toBe(captured[0]?.fallback.component);
      expect(captured[0]?.props.artifact.id).toBe("art-1");
    } finally {
      app.unmount();
      root.remove();
    }
  });
});

describe("AgentChat Pack A enhancements", () => {
  it("emits artifact v-model target without rendering preview inside chat, and attaches readRun artifacts to runComplete", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const report = makeArtifact({ path: "outputs/report.md" });
    const client = makeClient({ resolveArtifact: vi.fn(async () => report) });
    const chatRef = ref<InstanceType<typeof AgentChat> | null>(null);
    const artifact = ref<AgentArtifactTarget | null>(null);
    const runCompletes: AgentRunComplete[] = [];
    const artifactUpdates: Array<AgentArtifactTarget | null> = [];

    const app = createApp(defineComponent(() => () =>
      h(AgentChat, {
        ref: chatRef,
        client,
        agentId: "agent-a",
        agent: null,
        labels: LABELS,
        artifact: artifact.value,
        "onUpdate:artifact": (next: AgentArtifactTarget | null) => {
          artifactUpdates.push(next);
          artifact.value = next;
        },
        onRunComplete: (payload: AgentRunComplete) => runCompletes.push(payload),
      }),
    ));
    app.mount(root);
    try {
      await flush();
      await chatRef.value!.send("Generate report");
      await vi.waitFor(() => expect(runCompletes).toHaveLength(1));

      expect(client.readRun).toHaveBeenCalledWith("sess-1", "run-1");
      expect(runCompletes[0]).toEqual({
        sessionId: "sess-1",
        runId: "run-1",
        ok: true,
        outcome: { result: "complete" },
        artifacts: [report],
      });

      await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".artifact-card")?.disabled).toBe(false));
      root.querySelector<HTMLButtonElement>(".artifact-card")!.click();
      await flush();

      expect(artifactUpdates[0]).toEqual({
        sessionId: "sess-1",
        runId: "run-1",
        path: "outputs/report.md",
        title: "Report",
      });
      expect(root.querySelector(".side-panel")).toBeNull();
      expect(root.querySelector(".artifact-card")?.classList.contains("active")).toBe(true);
    } finally {
      app.unmount();
      root.remove();
    }
  });

  it("reports readRun failure via error emit and still emits runComplete without artifacts", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const client = makeClient({
      readRun: vi.fn(async () => {
        throw new Error("readRun network error");
      }),
    });
    const chatRef = ref<InstanceType<typeof AgentChat> | null>(null);
    const runCompletes: AgentRunComplete[] = [];
    const errors: string[] = [];

    const app = createApp(() =>
      h(AgentChat, {
        ref: chatRef,
        client,
        agentId: "agent-a",
        agent: null,
        labels: LABELS,
        onError: (msg: string) => errors.push(msg),
        onRunComplete: (payload: AgentRunComplete) => runCompletes.push(payload),
      }),
    );
    app.mount(root);
    try {
      await flush();
      await chatRef.value!.send("Run failing snapshot read");
      await vi.waitFor(() => expect(runCompletes).toHaveLength(1));

      expect(errors).toContain("readRun network error");
      expect(runCompletes[0]).toEqual({
        sessionId: "sess-1",
        runId: "run-1",
        ok: true,
        outcome: { result: "complete" },
      });
      expect("artifacts" in runCompletes[0]!).toBe(false);
    } finally {
      app.unmount();
      root.remove();
    }
  });

  it("emits update:agentId when opening a historical session owned by another agent and exposes session metadata + initialInstruction", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const client = makeClient({
      readHistory: vi.fn(async (id: string) => ({
        session: {
          id,
          agentId: "agent-b",
          title: "Cross-agent analysis",
          origin: "user" as const,
          createdAt: "2026-11-28T00:00:00.000Z",
          updatedAt: "2026-11-28T00:00:00.000Z",
          latestRun: null,
        },
        page: { messageSeq: 1, olderCursor: null, nextCursor: null, throughCursor: "cursor-1" },
        runs: [],
        messages: [{
          id: "m1",
          runId: "r1",
          messageSeq: 1,
          contextSeq: 1,
          message: { role: "user" as const, content: "First question", timestamp: 1 },
        }],
        pendingQuestions: [],
        notifications: [],
        latestRun: null,
      })),
    });
    const chatRef = ref<InstanceType<typeof AgentChat> | null>(null);
    const agentUpdates: string[] = [];

    const app = createApp(() =>
      h(AgentChat, {
        ref: chatRef,
        client,
        agentId: "agent-a",
        agent: null,
        sessionId: "sess-cross",
        labels: LABELS,
        "onUpdate:agentId": (next: string) => agentUpdates.push(next),
      }),
    );
    app.mount(root);
    try {
      await vi.waitFor(() => expect(agentUpdates).toEqual(["agent-b"]));
      expect(chatRef.value!.session).toMatchObject({
        id: "sess-cross",
        agentId: "agent-b",
        title: "Cross-agent analysis",
        origin: "user",
      });
      expect(chatRef.value!.hasInitialInstruction).toBe(true);
      expect(await chatRef.value!.initialInstruction()).toBe("First question");
    } finally {
      app.unmount();
      root.remove();
    }
  });

  it("supports #conversation-empty, #welcome, inlineArtifactAlreadyShown, and customInput + #input", async () => {
    const client = makeClient();

    // 1. #conversation-empty replaces entire empty view without composer when unstarted && !collapsed.
    const emptyRoot = document.createElement("div");
    document.body.append(emptyRoot);
    const emptyApp = createApp(() =>
      h(AgentChat, { client, agentId: "agent-a", agent: null, labels: LABELS }, {
        "conversation-empty": () => h("div", { class: "custom-empty-page" }, "Start from template"),
      }),
    );
    emptyApp.mount(emptyRoot);
    try {
      await flush();
      expect(emptyRoot.querySelector(".custom-empty-page")?.textContent).toBe("Start from template");
      expect(emptyRoot.querySelector("textarea")).toBeNull();
    } finally {
      emptyApp.unmount();
      emptyRoot.remove();
    }

    // 2. #welcome keeps composer; inlineArtifactAlreadyShown suppresses duplicate card; customInput renders #input.
    const richRoot = document.createElement("div");
    document.body.append(richRoot);
    const chatRef = ref<InstanceType<typeof AgentChat> | null>(null);
    const richApp = createApp(() =>
      h(AgentChat, {
        ref: chatRef,
        client,
        agentId: "agent-a",
        agent: null,
        labels: LABELS,
        inlineArtifactAlreadyShown: (_runId: string, path: string) => path === "outputs/report.md",
        customInput: (text: string) => text.startsWith("CUSTOM:"),
      }, {
        welcome: () => h("div", { class: "custom-welcome" }, "Welcome panel"),
        input: ({ text }: { text: string }) => h("div", { class: "custom-user-input" }, `Rendered:${text}`),
      }),
    );
    richApp.mount(richRoot);
    try {
      await flush();
      expect(richRoot.querySelector(".custom-welcome")?.textContent).toBe("Welcome panel");
      expect(richRoot.querySelector("textarea")).not.toBeNull();

      (client.send as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
        delivery: {
          messageId: "msg-custom",
          sessionRef: { providerId: "workbench", sessionId: "sess-1" },
          runId: "run-1",
          delivery: "run",
          status: "stopped",
        },
        input: {
          id: "msg-custom",
          runId: "run-1",
          messageSeq: 1,
          contextSeq: 1,
          message: { role: "user", content: "CUSTOM:payload", timestamp: 1 },
        },
        snapshot: {
          run: { id: "run-1", status: "stopped", stopReason: "completed", errorMessage: null, answerMessageId: "ans-1", finishedAt: "2026-11-28T00:00:01.000Z" },
          cursor: { seq: 1, streamId: "stream" },
          messages: [{
            id: "ans-1",
            runId: "run-1",
            messageSeq: 2,
            contextSeq: 2,
            message: { role: "assistant", content: [{ type: "text", text: "See [Report](outputs/report.md)" }], timestamp: 2 },
          }],
          pendingMessages: [],
          toolExecutions: [],
          artifacts: [],
          pendingQuestions: [],
        },
        pendingQuestions: [],
      }));

      await chatRef.value!.send("CUSTOM:payload");
      await vi.waitFor(() => expect(richRoot.querySelector(".custom-user-input")?.textContent).toBe("Rendered:CUSTOM:payload"));
      expect(richRoot.querySelector(".artifact-card")).toBeNull();
      expect(richRoot.textContent).toContain("Report");
    } finally {
      richApp.unmount();
      richRoot.remove();
    }
  });

  it("renders #message-actions in ShellResponse footer actions with the unified shell scope including optional outcome", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const commitSha = "a".repeat(40);
    const client = makeClient({
      readHistory: vi.fn(async (id: string) => ({
        session: {
          id,
          agentId: "agent-a",
          title: "Commit chat",
          workspaceId: "ws-1",
          createdAt: "2026-11-28T00:00:00.000Z",
          updatedAt: "2026-11-28T00:00:00.000Z",
          latestRun: null,
        },
        page: { messageSeq: 2, olderCursor: null, nextCursor: null, throughCursor: "cursor-1" },
        runs: [{
          id: "run-commit",
          sessionId: id,
          status: "stopped" as const,
          stopReason: "stop" as const,
          errorMessage: null,
          answerMessageId: "ans-commit",
          workspaceCommit: commitSha,
          createdAt: "2026-11-28T00:00:00.000Z",
          finishedAt: "2026-11-28T00:00:01.000Z",
          resolvedSkills: [],
          executionUserId: null,
          outcome: { commit: commitSha },
        }],
        messages: [
          { id: "m1", runId: "run-commit", messageSeq: 1, contextSeq: 1, message: { role: "user" as const, content: "Update panel", timestamp: 1 } },
          {
            id: "ans-commit",
            runId: "run-commit",
            messageSeq: 2,
            contextSeq: 2,
            message: {
              role: "assistant" as const,
              content: [{ type: "text" as const, text: "Panel updated." }],
              provider: "test",
              model: "test",
              api: "test",
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "stop" as const,
              timestamp: 2,
            },
          },
        ],
        pendingQuestions: [],
        notifications: [],
        latestRun: null,
      })),
    });

    const received: MessageActionContext[] = [];
    const app = createApp(() =>
      h(
        AgentChat,
        {
          client,
          agentId: "agent-a",
          agent: null,
          sessionId: "sess-commit",
          labels: { ...LABELS, copy: "Copy", elapsed: (time: string) => time },
        },
        {
          "message-actions": (scope: MessageActionContext) => {
            received.push(scope);
            return h("button", { type: "button", class: "host-message-action" }, scope.runId);
          },
        },
      ),
    );
    app.mount(root);
    try {
      await vi.waitFor(() => expect(root.querySelector(".response-footer .actions .host-message-action")).not.toBeNull());
      expect(root.querySelectorAll(".host-message-action")).toHaveLength(1);
      expect(root.querySelector('.response-footer .actions button[aria-label="Copy"]')).not.toBeNull();
      expect(received.at(-1)).toEqual({
        sessionId: "sess-commit",
        runId: "run-commit",
        messageId: "ans-commit",
        text: "Panel updated.",
        workspaceCommit: commitSha,
        workspaceId: "ws-1",
        outcome: { commit: commitSha },
      });
      expect("item" in (received.at(-1) as unknown as Record<string, unknown>)).toBe(false);
    } finally {
      app.unmount();
      root.remove();
    }
  });
});

describe("AgentArtifactPreview standalone component", () => {
  it("resolves target, navigates nested artifact links via shared trail, steps back, closes, and preserves .pptx download suppression", async () => {
    const parentArtifact = makeArtifact({ id: "art-parent", path: "outputs/parent.md" });
    const childArtifact = makeArtifact({ id: "art-child", path: "outputs/child.md" });
    const pptArtifact = makeArtifact({
      id: "art-ppt",
      path: "outputs/deck.pptx",
      mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const client = makeClient({
      resolveArtifact: vi.fn(async (_sessionId: string, _runId: string, path: string) => {
        if (path === "outputs/parent.md") return parentArtifact;
        if (path === "outputs/child.md") return childArtifact;
        if (path === "outputs/deck.pptx") return pptArtifact;
        return null;
      }),
      readArtifact: vi.fn(async (artifact: RuntimeArtifact) => {
        if (artifact.path === "outputs/parent.md") {
          return new Blob(["Parent body\n\nSee [Child Report](outputs/child.md)"], { type: "text/markdown" });
        }
        return new Blob(["Child body"], { type: "text/markdown" });
      }),
    });

    const parentTarget: AgentArtifactTarget = {
      sessionId: "sess-1",
      runId: "run-1",
      path: "outputs/parent.md",
      title: "Parent Report",
    };

    const state = reactive<{ artifact: AgentArtifactTarget | null }>({ artifact: parentTarget });
    const updates: Array<AgentArtifactTarget | null> = [];
    const root = document.createElement("div");
    document.body.append(root);

    const app = createApp(() =>
      h(AgentArtifactPreview, {
        client,
        labels: LABELS,
        artifact: state.artifact,
        inline: true,
        "onUpdate:artifact": (next: AgentArtifactTarget | null) => {
          updates.push(next);
          state.artifact = next;
        },
      }, {
        "artifact-actions": ({ title }: { title: string }) => h("span", { class: "header-custom-action" }, `Act:${title}`),
      }),
    );
    app.mount(root);
    try {
      await vi.waitFor(() => expect(root.querySelector(".panel-title")?.textContent).toBe("Parent Report"));
      expect(root.querySelector(".header-custom-action")?.textContent).toBe("Act:Parent Report");
      expect(root.querySelector(".panel-download-button")).not.toBeNull();

      // Click nested artifact card inside parent Markdown.
      await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".artifact-card")?.disabled).toBe(false));
      root.querySelector<HTMLButtonElement>(".artifact-card")!.click();
      await vi.waitFor(() => expect(updates.at(-1)).toEqual({
        sessionId: "sess-1",
        runId: "run-1",
        path: "outputs/child.md",
        title: "Child Report",
      }));

      // Click Back to return to parent artifact.
      await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('button[aria-label="Back"]')).not.toBeNull());
      root.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click();
      await vi.waitFor(() => expect(updates.at(-1)).toEqual(parentTarget));

      // Click Close on root item to emit null.
      await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('button[aria-label="Close"]')).not.toBeNull());
      root.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await vi.waitFor(() => expect(updates.at(-1)).toBeNull());

      // Open .pptx artifact and verify download button stays suppressed.
      state.artifact = { sessionId: "sess-1", runId: "run-1", path: "outputs/deck.pptx", title: "Deck" };
      await vi.waitFor(() => expect(root.querySelector(".panel-title")?.textContent).toBe("Deck"));
      expect(root.querySelector(".panel-download-button")).toBeNull();
    } finally {
      app.unmount();
      root.remove();
    }
  });
});
