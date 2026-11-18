import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { AgentShell, displayLink, type AgentHostAgent, type ConversationDisplay } from "@ontomato/agent-shell-ui";
import en from "../../../locales/en";

/*
 * The agent platform's real shell around a page under test. The host behind it lists no agent and no conversation, so
 * what a test drives is what sits beside the conversation: the shell's own controls and the address.
 */

const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * The assistant host as the agent platform's shell reads it: the agents it lists (none by default), no conversations, a
 * page's draft, and a conversation each first message creates, whose messages land in `sent` and whose run is admitted
 * and stopped at once.
 */
export function assistantHostDouble(options: { agents?: AgentHostAgent[]; readPageDraft?: (...args: unknown[]) => unknown; sent?: string[] } = {}) {
  const session = (agentId: string) => ({ id: SESSION, agentId, title: "", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null });
  return {
    listAgents: async () => options.agents ?? [],
    listPageAgents: async () => ({ agents: options.agents ?? [], defaultAgentId: options.agents?.[0]?.id ?? null }),
    listSessions: async () => ({ sessions: [], nextCursor: null }),
    readPageDraft: options.readPageDraft ?? (async () => null),
    createSession: async (agentId: string) => session(agentId),
    subscribe: () => () => {},
    async send(_sessionId: string, input: { message: string }) {
      options.sent?.push(input.message);
      return {
        delivery: { messageId: RUN, sessionRef: { providerId: "workbench", sessionId: SESSION }, runId: RUN, delivery: "run", status: "stopped" },
        input: { id: RUN, runId: RUN, messageSeq: 1, contextSeq: 1, message: { role: "user", content: input.message, timestamp: 1 } },
        snapshot: {
          pendingQuestions: [],
          run: {
            id: RUN, sessionId: SESSION, status: "stopped", stopReason: "stop", errorMessage: null, answerMessageId: null,
            workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [],
          },
          cursor: { runId: RUN, seq: 1, streamId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
          messages: [], pendingMessages: [], toolExecutions: [], artifacts: [],
        },
        pendingQuestions: [],
        replayed: false,
      };
    },
  };
}

/** What the shell shows beside the conversation. */
export const displayOf = (wrapper: VueWrapper) => wrapper.findComponent(AgentShell).props("display") as ConversationDisplay;

/** How the shell opens an in-app link in an answer; null when it leaves the link as text. */
export const linkOf = (wrapper: VueWrapper, href: string) =>
  displayLink(displayOf(wrapper), wrapper.findComponent(AgentShell).props("pageLinks") as ((href: string) => (() => void) | null) | undefined)(href);

/** Follows an in-app link in an answer, as the reader clicking it in the shell. */
export async function openLink(wrapper: VueWrapper, href: string) {
  linkOf(wrapper, href)!();
  await flushPromises();
}

/** One of the page pane's own controls. */
export function paneButton(wrapper: VueWrapper, control: "close" | "expand" | "collapse") {
  return wrapper.find<HTMLButtonElement>(`.page-pane .pane-header button[aria-label="${en.assistant[control]}"]`);
}
