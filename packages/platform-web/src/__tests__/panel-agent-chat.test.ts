import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import {
  AgentChat as ShellAgentChat,
  panelChatHostKey,
  pageSessionStream,
  servePageComposerKey,
  useConversationDisplay,
  type PageComposerExpand,
  type ConversationDisplay,
  type AgentHostAgent,
  type AgentHostClient,
  type PanelChatHost,
} from "@ontomato/agent-shell-ui";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import en from "../../../workbench-ui/src/locales/en";
import ConversationEntry from "../../../apps-sdk/src/base/ConversationEntry.vue";
import AgentChat from "../../../apps-sdk/src/chat/AgentChat.vue";
import { panelContextKey, projectionKey, type PanelContext } from "../../../apps-sdk/src/panel/context";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });

const REGULAR_AGENT: AgentHostAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "General Assistant",
  description: "General",
  icon: null,
  enabled: true,
  kind: "regular",
};

const DEPT_AGENT: AgentHostAgent = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Department Helper",
  description: "Department Q&A",
  icon: null,
  enabled: true,
};

function makeClient(agents: AgentHostAgent[]): AgentHostClient {
  return {
    listAgents: vi.fn(async () => agents),
    listPageAgents: vi.fn(async () => ({ agents })),
    listSessions: vi.fn(async () => ({ sessions: [], nextCursor: null })),
    createSession: vi.fn(async (agentId: string) => ({
      id: "sess-created-1",
      agentId,
      title: "New chat",
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    })),
    readHistory: vi.fn(async (id: string) => ({
      session: { id, agentId: agents[0]?.id }, page: { messageSeq: 0, olderCursor: null },
      runs: [], messages: [], pendingQuestions: [], notifications: [], latestRun: null,
    })),
    deleteSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    send: vi.fn(async () => ({
      delivery: {
        messageId: "msg-1",
        sessionRef: { providerId: "workbench", sessionId: "sess-created-1" },
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
          answerMessageId: "answer-1",
          finishedAt: "2026-11-25T00:00:01Z",
        },
        cursor: { seq: 1, streamId: "stream" },
        messages: [{ id: "answer-1", runId: "run-1", messageSeq: 2, contextSeq: 2,
          message: { role: "assistant", content: [{ type: "text", text: "Response" }], timestamp: 2 } }],
        pendingMessages: [], toolExecutions: [], artifacts: [], pendingQuestions: [],
        outcome: { result: "complete" },
      },
      pendingQuestions: [],
    })),
    readRun: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    answerQuestion: vi.fn(),
    cancelRun: vi.fn(),
    readArtifact: vi.fn(),
    sessionRuns: {
      read: vi.fn(async () => ({ sessions: [] })),
      subscribe: vi.fn(() => () => {}),
    },
  } as unknown as AgentHostClient;
}

function makeProjection(target: PanelConversationEntry["target"]): ProductProjection {
  return {
    id: "proj-chat-1",
    domainId: "domain-1",
    ownerId: "user-1",
    name: "Department Chat",
    description: "",
    visibility: "domain",
    revision: 1,
    editable: true,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
    componentId: "@ontomato/sdk:AgentChat",
    inputs: { sessionId: { kind: "scalar", type: "string" } },
    outputs: { sessionId: { kind: "scalar", type: "string" } },
    data: {},
    config: {},
    conversationEntry: { target },
  };
}

function mountProjectionChat(options: {
  target: PanelConversationEntry["target"];
  agents: AgentHostAgent[];
  defaultAgent?: PanelChatHost["defaultAgent"];
  claimComposer?: () => () => void;
  sessionId?: string | null;
  props?: Record<string, unknown>;
  real?: boolean;
  display?: () => ConversationDisplay;
  provide?: Record<symbol, unknown>;
}) {
  const client = makeClient(options.agents);
  const outputs = new Map<string, unknown>();
  const projection = makeProjection(options.target);
  const panelContext = {
    t: (key: string) => key,
    instance: {
      setMemberOutput(_member: string, name: string, value: unknown) {
        outputs.set(name, value);
      },
    },
  } as unknown as PanelContext;
  const member = {
    key: "chat",
    scoped: false,
    projection,
    data: { get: () => ({ status: "ready", value: {} }) },
    inputs: { get: () => undefined },
    operations: {},
  } as unknown as PanelMemberContext;
  const stub = defineComponent({
    name: "AgentChat",
    props: {
      client: { type: Object, required: true },
      agentId: { type: String, required: true },
      agent: { type: Object, default: null },
      labels: { type: Object, default: undefined },
      sessionId: { type: String, default: null },
    },
    emits: ["update:sessionId", "runComplete", "error"],
    setup(props, { emit, expose }) {
      const reset = vi.fn();
      const send = vi.fn(async (text: string) => {
        const created = await (props.client as AgentHostClient).createSession(props.agentId);
        await (props.client as AgentHostClient).send(created.id, { message: text });
        emit("update:sessionId", created.id);
      });
      expose({ reset, cancel: vi.fn(), send, busy: false });
      return () => h("div", { class: "stub-shell-chat", "data-agent-id": props.agentId, "data-session-id": props.sessionId ?? "" });
    },
  });
  let expand: PageComposerExpand;
  const trigger = (request: Parameters<PageComposerExpand>[0]) => expand(request);
  const wrapper = mount(AgentChat, {
    props: { sessionId: options.sessionId ?? null, ...options.props },
    slots: {
      "composer-context": "<div data-context />",
      "message-actions": '<template #default="{ runId, outcome }"><div :data-result="runId">{{ outcome?.result }}</div></template>',
    },
    global: {
      plugins: [i18n],
      provide: {
        ...options.provide,
        [servePageComposerKey as symbol]: (handler: PageComposerExpand) => {
          expand = handler;
          return () => {};
        },
        [panelContextKey as symbol]: panelContext,
        [projectionKey as symbol]: { slot: "chat", projection },
        [panelMemberKey as symbol]: () => member,
        [panelChatHostKey as symbol]: {
          client: () => client,
          defaultAgent: options.defaultAgent,
          claimComposer: options.claimComposer,
          display: options.display,
        } satisfies PanelChatHost,
      },
      stubs: options.real ? {} : { AgentChat: stub },
    },
  });
  return { wrapper, client, outputs, trigger };
}

describe("AgentChat projection member", () => {
  it("resolves a declared agent ID through the platform client, syncs sessionId, claims composer, and resets on New chat", async () => {
    const release = vi.fn();
    const claimComposer = vi.fn(() => release);
    const { wrapper, client, outputs, trigger } = mountProjectionChat({
      target: { kind: "id", id: DEPT_AGENT.id },
      agents: [REGULAR_AGENT, DEPT_AGENT],
      claimComposer,
      real: true,
    });
    await flushPromises();

    expect(claimComposer).toHaveBeenCalledTimes(1);
    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(outputs.get("status")).toBe("ready");
    expect(wrapper.find(".sdk-agent-chat-title").text()).toBe("Department Helper");
    expect(wrapper.getComponent(ShellAgentChat).props("agentId")).toBe(DEPT_AGENT.id);

    // Sending creates a session through the shared platform AgentHostClient and writes sessionId back.
    expect(wrapper.vm).not.toHaveProperty("send");
    expect(wrapper.vm).not.toHaveProperty("reset");
    const buttonProjection = { ...makeProjection({ kind: "id", id: DEPT_AGENT.id }),
      conversationEntry: { target: { kind: "id" as const, id: DEPT_AGENT.id }, submit: true, newSession: true },
    };
    const button = mount(ConversationEntry, {
      props: { prefill: "Hello" },
      global: {
        plugins: [i18n],
        provide: {
          [panelContextKey as symbol]: { expandPageComposer: trigger },
          [projectionKey as symbol]: { slot: "start", projection: buttonProjection },
        },
      },
    });
    await button.get("button").trigger("click");
    await flushPromises();
    expect(client.createSession).toHaveBeenCalledWith(DEPT_AGENT.id);
    expect(client.send).toHaveBeenCalledWith("sess-created-1", { message: "Hello" });
    expect(wrapper.emitted("update:sessionId")?.[0]).toEqual(["sess-created-1"]);
    expect(outputs.get("sessionId")).toBe("sess-created-1");
    expect(wrapper.emitted("entryTriggered")?.[0]).toEqual([
      { slot: "start", submit: true, newSession: true, sessionId: "sess-created-1" },
    ]);
    button.unmount();

    // Clicking New chat resets the session back to null.
    await wrapper.find(".sdk-agent-chat-btn").trigger("click");
    expect(wrapper.emitted("update:sessionId")?.at(-1)).toEqual([null]);
    expect(outputs.get("sessionId")).toBeNull();

    // Unmounting releases the bottom PageComposer claim.
    wrapper.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses unauthorized or disabled agents without falling back to another agent", async () => {
    const { wrapper, outputs } = mountProjectionChat({
      target: { kind: "id", id: DEPT_AGENT.id },
      agents: [REGULAR_AGENT, { ...DEPT_AGENT, enabled: false }],
    });
    await flushPromises();

    expect(outputs.get("status")).toBe("forbidden");
    expect(wrapper.find(".stub-shell-chat").exists()).toBe(false);
    expect(wrapper.text()).toContain(en.assistant.agentUnavailable);
  });

  it("resolves preset and page-default targets using the entry's defaultAgent", async () => {
    const presetRun = mountProjectionChat({
      target: { kind: "preset", agentKind: "regular" },
      agents: [DEPT_AGENT, REGULAR_AGENT],
    });
    await flushPromises();
    expect(presetRun.outputs.get("status")).toBe("ready");
    expect(presetRun.wrapper.find(".stub-shell-chat").attributes("data-agent-id")).toBe(REGULAR_AGENT.id);
    presetRun.wrapper.unmount();

    const defaultRun = mountProjectionChat({
      target: { kind: "page-default" },
      defaultAgent: { kind: "id", id: DEPT_AGENT.id },
      agents: [REGULAR_AGENT, DEPT_AGENT],
    });
    await flushPromises();
    expect(defaultRun.outputs.get("status")).toBe("ready");
    expect(defaultRun.wrapper.find(".stub-shell-chat").attributes("data-agent-id")).toBe(DEPT_AGENT.id);
    defaultRun.wrapper.unmount();
  });

  it("forwards opaque session context and outcome, and keeps the conversation through collapse", async () => {
    const { wrapper, client, trigger } = mountProjectionChat({
      target: { kind: "id", id: DEPT_AGENT.id },
      agents: [DEPT_AGENT],
      real: true,
      props: { greeting: "Welcome", description: "Details", sessionContext: { token: ["a", 2] } },
    });
    await flushPromises();
    expect(wrapper.get(".greeting").text()).toBe("Welcome");
    expect(wrapper.get(".agent-description").text()).toBe("Details");
    expect(wrapper.find("[data-context]").exists()).toBe(true);
    const chat = wrapper.getComponent(ShellAgentChat).element;
    await wrapper.setProps({ collapsed: true });
    await wrapper.get("textarea").trigger("click");
    expect(wrapper.emitted("expand")).toHaveLength(1);
    await trigger({ slot: "start", target: { kind: "id", id: DEPT_AGENT.id }, prefill: "Hello", submit: true, newSession: true });
    await flushPromises();
    expect(wrapper.emitted("expand")).toHaveLength(2);
    expect(client.createSession).toHaveBeenCalledWith({ agentId: DEPT_AGENT.id, context: { token: ["a", 2] } });
    expect(wrapper.emitted("runComplete")?.[0]).toEqual([
      { sessionId: "sess-created-1", runId: "run-1", ok: true, outcome: { result: "complete" } },
    ]);
    await wrapper.setProps({ collapsed: false });
    expect(wrapper.getComponent(ShellAgentChat).element).toBe(chat);
    expect(wrapper.get('[data-result="run-1"]').text()).toBe("complete");
    expect(client.readHistory).not.toHaveBeenCalled();
    await trigger({ target: { kind: "id", id: DEPT_AGENT.id }, prefill: "Draft", newSession: true });
    await flushPromises();
    expect(wrapper.get("textarea").element.value).toBe("Draft");
    expect(wrapper.emitted("update:sessionId")?.at(-1)).toEqual([null]);
    expect(client.send).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("uses the enclosing view binding and refuses outside presentation on that view", async () => {
    const display = useConversationDisplay({
      features: () => [],
      embedded: true,
      initial: { page: { featureId: "panel", instance: "/current", address: "/current" }, view: "full" },
      admit: async () => ({ ok: false, reason: "outside_embedded_host" }),
      context: (page) => ({ url: page.address, label: "Panel", selection: [] }),
      leave: { leaves: () => false, confirm: async () => true },
    });
    display.registerPageController("/current", { applyState: vi.fn() });
    const attach = vi.fn((_shell: Parameters<import("../../../agent-shell-ui/src/session-run-notices").PageSessionStream["attach"]>[0]) => vi.fn());
    const { wrapper, client, trigger } = mountProjectionChat({
      target: { kind: "id", id: DEPT_AGENT.id }, agents: [DEPT_AGENT], real: true,
      display: () => display,
      provide: { [pageSessionStream as symbol]: { binding: { viewId: "current-view" }, attach } },
    });
    await flushPromises();
    await trigger({ target: { kind: "id", id: DEPT_AGENT.id }, prefill: "Hello", submit: true });
    expect(client.send).toHaveBeenCalledWith("sess-created-1", expect.objectContaining({
      presentationBinding: { viewId: "current-view", initialPage: expect.objectContaining({ url: "/current" }) },
    }));
    const shell = attach.mock.calls[0]![0];
    const result = await shell.present({
      type: "presentation", sessionId: "sess-created-1", runId: "run-1", toolCallId: "call-1",
      target: { kind: "page", address: "/elsewhere" },
    });
    expect(result).toMatchObject({ status: "not_opened", reason: "outside_embedded_host", current: { target: { url: "/current" } } });
    wrapper.unmount();
  });

  it("preserves standalone mode when explicit client, agentId, agent and labels are passed", async () => {
    const client = makeClient([DEPT_AGENT]);
    const wrapper = mount(AgentChat, {
      props: {
        client,
        agentId: DEPT_AGENT.id,
        agent: DEPT_AGENT,
      },
      global: {
        plugins: [i18n],
        stubs: {
          AgentChat: defineComponent({
            name: "AgentChat",
            props: { agentId: { type: String, required: true } },
            setup(props) {
              return () => h("div", { class: "standalone-chat", "data-agent-id": props.agentId });
            },
          }),
        },
      },
    });
    await flushPromises();
    expect(client.listAgents).not.toHaveBeenCalled();
    expect(wrapper.find(".standalone-chat").attributes("data-agent-id")).toBe(DEPT_AGENT.id);
    wrapper.unmount();
  });
});
