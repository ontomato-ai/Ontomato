import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { AgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";

const remembered = "11111111-1111-4111-8111-111111111111";
const served = "22222222-2222-4222-8222-222222222222";

function port(agents: { id: string; enabled: boolean }[]): AgentHostClient {
  return {
    listAgents: async () =>
      agents.map((agent) => ({ id: agent.id, name: agent.id, description: "", icon: null, enabled: agent.enabled })),
    listSessions: async () => ({ sessions: [], nextCursor: null }),
    deleteSession: vi.fn(),
  } as unknown as AgentHostClient;
}

function nav(agents: { id: string; enabled: boolean }[], initialAgentId: string | null) {
  const agentId = ref<string | null>(initialAgentId);
  const sessionId = ref<string | null>(null);
  const onLeaveConversation = vi.fn();
  const state = useAgentNav({
    client: () => port(agents),
    agentId: () => agentId.value,
    setAgentId: (id) => (agentId.value = id),
    sessionId: () => sessionId.value,
    setSessionId: (id) => (sessionId.value = id),
    onLeaveConversation,
  });
  return { state, agentId, sessionId, onLeaveConversation };
}

describe("first agent read", () => {
  it("updates a title only after the host saves it and retains the selected conversation", async () => {
    const client = port([]);
    client.renameSession = vi.fn().mockResolvedValue(undefined);
    const selected = ref<string | null>(served);
    const state = useAgentNav({ client: () => client, agentId: () => remembered, setAgentId: () => {}, sessionId: () => selected.value, setSessionId: id => { selected.value = id; } });
    state.sessions.value = [{ id: served, agentId: remembered, title: "Before", latestRun: null, createdAt: "", updatedAt: "" }];
    await state.renameSession(served, "After");
    expect(client.renameSession).toHaveBeenCalledWith(served, "After");
    expect(state.sessions.value[0].title).toBe("After");
    expect(selected.value).toBe(served);
    vi.mocked(client.renameSession).mockRejectedValueOnce(new Error("offline"));
    await expect(state.renameSession(served, "Unsaved")).rejects.toThrow("offline");
    expect(state.sessions.value[0].title).toBe("After");
  });
  /**
   * A bookmark names a page and a conversation. The remembered agent may be gone, and the first read then selects
   * another one; clearing the conversation at that moment would drop what the address asked for.
   */
  it("does not start a new conversation when the first read replaces a remembered agent", async () => {
    const { state, agentId, sessionId, onLeaveConversation } = nav([{ id: served, enabled: true }], remembered);
    // The address asked for a conversation.
    sessionId.value = "33333333-3333-4333-8333-333333333333";

    await state.loadAgents();

    expect(agentId.value).toBe(served);
    expect(sessionId.value).not.toBeNull();
    expect(onLeaveConversation).not.toHaveBeenCalled();
  });

  it("starts a new conversation when the reader switches agents after the first read", async () => {
    const { state, agentId, sessionId, onLeaveConversation } = nav(
      [
        { id: served, enabled: true },
        { id: remembered, enabled: true },
      ],
      remembered,
    );
    await state.loadAgents();
    // The first read kept the remembered agent, so nothing was cleared on the way in.
    expect(onLeaveConversation).not.toHaveBeenCalled();

    sessionId.value = "33333333-3333-4333-8333-333333333333";
    agentId.value = served;
    await nextTick();

    expect(sessionId.value).toBeNull();
    expect(onLeaveConversation).toHaveBeenCalledTimes(1);
  });

  it("does not start a new conversation when the remembered agent is still served", async () => {
    const { state, agentId, sessionId, onLeaveConversation } = nav([{ id: remembered, enabled: true }], remembered);
    sessionId.value = "33333333-3333-4333-8333-333333333333";

    await state.loadAgents();

    expect(agentId.value).toBe(remembered);
    expect(sessionId.value).not.toBeNull();
    expect(onLeaveConversation).not.toHaveBeenCalled();
  });
});
