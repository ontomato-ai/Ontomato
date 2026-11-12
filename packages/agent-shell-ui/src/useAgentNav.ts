import { computed, nextTick, ref, watch } from "vue";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "./host";

export interface AgentNavOptions {
  /** The host port; read lazily so the nav follows a replaced client. */
  client: () => AgentHostClient;
  /** The agent the navigation is showing; the host owns it, the nav lists that agent's conversations. */
  agentId: () => string | null;
  setAgentId(agentId: string | null): void;
  sessionId: () => string | null;
  setSessionId(sessionId: string | null): void;
  /** Called when the selection moves away from a conversation (new conversation, another agent). */
  onLeaveConversation?(): void;
}

/**
 * The navigation state of the conversation shell: the agents the host serves, the conversations of the chosen agent,
 * and the actions that move the selection. `AgentShell` owns it for its own sidebar; under the platform shell the
 * application panel owns it, so both show the same list from the same code.
 *
 * Session titles are kept here too: hosts hand them back after sending, so the list stays in step with the open
 * conversation without a second read. Run state is not: it comes from the page's notice feed.
 */
/** The navigation state and actions one host owns; `AgentShell` and a platform panel share one instance. */
export type AgentNav = ReturnType<typeof useAgentNav>;

export function useAgentNav(options: AgentNavOptions) {
  const agents = ref<AgentHostAgent[]>([]);
  const sessions = ref<AgentHostSession[]>([]);
  const sessionsState = ref<"loading" | "ready" | "error">("loading");
  const nextCursor = ref<string | null>(null);
  let sessionsLoad = 0;
  /**
   * False until the first agent read has settled. The read may replace a remembered agent that no longer exists, and
   * that replacement is not the reader switching agents: it must not clear the page and conversation an address asked
   * for (a bookmark to a feature or a session).
   */
  let initialAgentLoaded = false;

  const currentAgent = computed(() => agents.value.find((agent) => agent.id === options.agentId()) ?? null);
  const currentSession = computed(() => sessions.value.find((session) => session.id === options.sessionId()));

  async function loadAgents() {
    agents.value = await options.client().listAgents();
    const selected = options.agentId();
    if (!agents.value.some((agent) => agent.id === selected))
      options.setAgentId((agents.value.find((agent) => agent.enabled) ?? agents.value[0])?.id ?? null);
    // Let the selection watcher run once with the flag still down, then treat later changes as the reader's.
    await nextTick();
    initialAgentLoaded = true;
  }

  async function loadSessions(more = false) {
    const agent = options.agentId();
    if (!agent) return;
    const load = ++sessionsLoad;
    sessionsState.value = "loading";
    try {
      const page = await options.client().listSessions(agent, more ? nextCursor.value : null);
      if (load !== sessionsLoad) return;
      sessions.value = more ? [...sessions.value, ...page.sessions] : page.sessions;
      nextCursor.value = page.nextCursor;
      sessionsState.value = "ready";
    } catch {
      if (load === sessionsLoad) sessionsState.value = "error";
    }
  }

  function startNew() {
    options.setSessionId(null);
    options.onLeaveConversation?.();
  }

  function selectSession(id: string) {
    if (id === options.sessionId()) return;
    options.setSessionId(id);
    options.onLeaveConversation?.();
  }

  async function removeSession(id: string) {
    await options.client().deleteSession(id);
    sessions.value = sessions.value.filter((session) => session.id !== id);
    if (id === options.sessionId()) startNew();
  }
  async function renameSession(id: string, title: string) {
    await options.client().renameSession(id, title);
    sessions.value = sessions.value.map(session => session.id === id ? { ...session, title } : session);
  }

  /**
   * Places a conversation at the top of the list, or moves the row it already has there, filling an empty title with the
   * message that started it. An existing row keeps the run state the notice feed gave it.
   */
  function promoteSession(session: AgentHostSession, title: string) {
    const entry = sessions.value.find((row) => row.id === session.id);
    const row = entry ? { ...entry, title: entry.title || title } : { ...session, title: session.title || title };
    sessions.value = [row, ...sessions.value.filter((item) => item.id !== row.id)];
  }

  // Switching agents drops the previous agent's conversations and starts from a clean conversation.
  const stopAgentWatch = watch(
    () => options.agentId(),
    (_, previous) => {
      sessions.value = [];
      nextCursor.value = null;
      // Initial selection can replace a removed remembered agent while opening a bookmarked feature.
      if (previous !== null && initialAgentLoaded) startNew();
      void loadSessions();
    },
  );

  return {
    agents,
    sessions,
    sessionsState,
    nextCursor,
    currentAgent,
    currentSession,
    loadAgents,
    loadSessions,
    startNew,
    selectSession,
    removeSession,
    renameSession,
    promoteSession,
    stopAgentWatch,
  };
}
