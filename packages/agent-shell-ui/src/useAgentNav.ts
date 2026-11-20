import { computed, nextTick, ref, shallowRef, watch } from "vue";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
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
  /** The open page's agents while a page with its own skill is open; null when it has none or none is open. */
  const pageAgents = ref<{ agents: AgentHostAgent[]; defaultAgentId?: string } | null>(null);
  /** The page whose skill the composer is choosing agents for, as the shell reports it opening and closing. */
  // A snapshot the page reported, replaced whole and never edited in place.
  const page = shallowRef<PageSkillContext | null>(null);
  /**
   * The open conversation's own agent kept while a page narrows `agents` to candidates that do not include it, so the
   * head and composer still recognise it. Cleared as soon as `agentId` changes or the agent is listed again.
   */
  const retainedAgent = ref<AgentHostAgent | null>(null);
  const sessions = ref<AgentHostSession[]>([]);
  const sessionsState = ref<"loading" | "ready" | "error">("loading");
  const nextCursor = ref<string | null>(null);
  let agentsLoad = 0;
  /**
   * Whether the agents are being read: all of them, or a page's candidates, which empty the list until they arrive. What
   * `agents` lists, and the agent chosen from it, are settled only once this is down.
   */
  const agentsLoading = ref(false);
  /** The latest read of the agents failed: there is nothing more to wait for. */
  function readFailed(load: number) {
    return (error: unknown): never => {
      if (load === agentsLoad) agentsLoading.value = false;
      throw error;
    };
  }
  let sessionsLoad = 0;
  /**
   * False until the first agent read has settled. The read may replace a remembered agent that no longer exists, and
   * that replacement is not the reader switching agents: it must not clear the page and conversation an address asked
   * for (a bookmark to a feature or a session).
   */
  let initialAgentLoaded = false;

  const currentAgent = computed(
    () =>
      agents.value.find((agent) => agent.id === options.agentId()) ??
      (retainedAgent.value?.id === options.agentId() ? retainedAgent.value : null),
  );
  const currentSession = computed(() => sessions.value.find((session) => session.id === options.sessionId()));

  async function loadAgents() {
    if (page.value) return loadPageAgents();
    const load = ++agentsLoad;
    agentsLoading.value = true;
    const list = await options.client().listAgents().catch(readFailed(load));
    if (load !== agentsLoad) return;
    agents.value = list;
    pageAgents.value = null;
    retainedAgent.value = null;
    const selected = options.agentId();
    if (!agents.value.some((agent) => agent.id === selected))
      options.setAgentId((agents.value.find((agent) => agent.enabled) ?? agents.value[0])?.id ?? null);
    // Let the selection watcher run once with the flag still down, then treat later changes as the reader's.
    await nextTick();
    initialAgentLoaded = true;
    if (load === agentsLoad) agentsLoading.value = false;
  }

  /**
   * A page with its own skill narrows the chooser to the agents that carry it. Before a conversation has started, an
   * agent outside those candidates gives way to the page's default (or its first enabled candidate) without closing the
   * page. Once a conversation is open, it stays on its own agent so it is never moved under another; the chooser still
   * lists only the page's candidates if the reader chooses to switch.
   */
  async function loadPageAgents() {
    const load = ++agentsLoad;
    const target = page.value!;
    const active = options.sessionId() !== null ? currentAgent.value : null;
    retainedAgent.value = active;
    pageAgents.value = null;
    agents.value = [];
    agentsLoading.value = true;
    const result = await options.client().listPageAgents(target).catch(readFailed(load));
    if (load !== agentsLoad) return;
    pageAgents.value = result;
    agents.value = result.agents;
    if (agents.value.some((agent) => agent.id === options.agentId())) {
      retainedAgent.value = null;
    } else if (options.sessionId() === null) {
      retainedAgent.value = null;
      const next = pageAgents.value.defaultAgentId ?? agents.value.find((agent) => agent.enabled)?.id ?? null;
      if (next !== options.agentId()) {
        adoptingAgent = true;
        options.setAgentId(next);
      }
    }
    await nextTick();
    adoptingAgent = false;
    initialAgentLoaded = true;
    if (load === agentsLoad) agentsLoading.value = false;
  }

  /** A page with its own skill opens or closes: the composer chooses among that page's agents, or among all of them. */
  async function setPage(next: PageSkillContext | null) {
    if (JSON.stringify(next) === JSON.stringify(page.value)) return;
    page.value = next;
    await loadAgents();
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

  /**
   * The conversation's own agent being taken over is not the reader switching: the open conversation runs on it, and it
   * stays open and bound to it. Only the reader's own choice starts a new conversation.
   */
  let adoptingAgent = false;

  // Switching agents drops the previous agent's conversations and starts from a clean conversation.
  const stopAgentWatch = watch(
    () => options.agentId(),
    (_, previous) => {
      retainedAgent.value = null;
      sessions.value = [];
      nextCursor.value = null;
      // Initial selection can replace a removed remembered agent while opening a bookmarked feature.
      if (previous !== null && initialAgentLoaded && !adoptingAgent) startNew();
      adoptingAgent = false;
      void loadSessions();
    },
  );

  /**
   * Shows the agent an opened conversation runs on. The conversation stays where it is: this is what the host reports
   * about it, not the reader choosing another agent, so nothing is started and nothing is rebound.
   */
  function adoptAgent(id: string) {
    if (id === options.agentId()) return;
    adoptingAgent = true;
    options.setAgentId(id);
  }

  /**
   * A new conversation with this agent, the page beside it kept: what a page's conversation entry asks for when the agent
   * it names is not the open conversation's. The conversation that was open stays as it was, on its own agent.
   */
  function beginWith(id: string) {
    options.setSessionId(null);
    if (id === options.agentId()) return;
    adoptingAgent = true;
    options.setAgentId(id);
  }

  return {
    agents,
    agentsLoading: computed(() => agentsLoading.value),
    pageAgents,
    sessions,
    sessionsState,
    nextCursor,
    currentAgent,
    currentSession,
    loadAgents,
    setPage,
    loadSessions,
    startNew,
    adoptAgent,
    beginWith,
    selectSession,
    removeSession,
    renameSession,
    promoteSession,
    stopAgentWatch,
  };
}
