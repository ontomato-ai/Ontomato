import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import {
  AgentChatPanel as ShellAgentChatPanel,
  panelChatHostKey,
  type AgentHostAgent,
  type AgentHostClient,
  type PanelChatHost,
} from "@ontomato/agent-shell-ui";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import en from "../../../workbench-ui/src/locales/en";
import AgentChatPanel from "../../../apps-sdk/src/chat/AgentChatPanel.vue";
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
    readHistory: vi.fn(async () => ({ messages: [], hasOlder: false, nextCursor: null })),
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
        },
        messages: [],
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
    componentId: "@ontomato/sdk:AgentChatPanel",
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
    name: "AgentChatPanel",
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
  const wrapper = mount(AgentChatPanel, {
    props: { sessionId: options.sessionId ?? null },
    global: {
      plugins: [i18n],
      provide: {
        [panelContextKey as symbol]: panelContext,
        [projectionKey as symbol]: { slot: "chat", projection },
        [panelMemberKey as symbol]: () => member,
        [panelChatHostKey as symbol]: {
          client: () => client,
          defaultAgent: options.defaultAgent,
          claimComposer: options.claimComposer,
        } satisfies PanelChatHost,
      },
      stubs: {
        AgentChatPanel: stub,
      },
    },
  });
  return { wrapper, client, outputs, ShellAgentChatPanel };
}

describe("AgentChatPanel projection member", () => {
  it("resolves a declared agent ID through the platform client, syncs sessionId, claims composer, and resets on New chat", async () => {
    const release = vi.fn();
    const claimComposer = vi.fn(() => release);
    const { wrapper, client, outputs } = mountProjectionChat({
      target: { kind: "id", id: DEPT_AGENT.id },
      agents: [REGULAR_AGENT, DEPT_AGENT],
      claimComposer,
    });
    await flushPromises();

    expect(claimComposer).toHaveBeenCalledTimes(1);
    expect(client.listAgents).toHaveBeenCalledTimes(1);
    expect(outputs.get("status")).toBe("ready");
    expect(wrapper.find(".sdk-agent-chat-panel-title").text()).toBe("Department Helper");
    expect(wrapper.find(".stub-shell-chat").attributes("data-agent-id")).toBe(DEPT_AGENT.id);

    // Sending creates a session through the shared platform AgentHostClient and writes sessionId back.
    await (wrapper.vm as unknown as { send: (t: string) => Promise<void> }).send("Hello");
    await flushPromises();
    expect(client.createSession).toHaveBeenCalledWith(DEPT_AGENT.id);
    expect(client.send).toHaveBeenCalledWith("sess-created-1", { message: "Hello" });
    expect(wrapper.emitted("update:sessionId")?.[0]).toEqual(["sess-created-1"]);
    expect(outputs.get("sessionId")).toBe("sess-created-1");

    // Clicking New chat resets the session back to null.
    await wrapper.find(".sdk-agent-chat-panel-btn").trigger("click");
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

  it("preserves standalone mode when explicit client, agentId, agent and labels are passed", async () => {
    const client = makeClient([DEPT_AGENT]);
    const wrapper = mount(AgentChatPanel, {
      props: {
        client,
        agentId: DEPT_AGENT.id,
        agent: DEPT_AGENT,
      },
      global: {
        plugins: [i18n],
        stubs: {
          AgentChatPanel: defineComponent({
            name: "AgentChatPanel",
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
