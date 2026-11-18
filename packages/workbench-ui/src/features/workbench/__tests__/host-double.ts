import type { AgentHostAgent, SessionRunHandlers, SessionRunPort } from "@ontomato/agent-shell-ui";
import type { AgentHostSendRequest } from "@ontomato/contracts/agent-host";
import type { PresentationReceipt } from "@ontomato/contracts/agent-presentation";

/*
 * The hosts behind the agent platform's real shell in a test: the assistant host and its notice stream. They need no
 * mounting library, so a test that mounts the platform its own way uses them too.
 */

/** The conversation a first message creates, and the one the host reopens by its address. */
export const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * The assistant host as the agent platform's shell reads it: the agents it lists (none by default), no conversations in
 * its list, a page's draft, and one conversation — created by a first message or reopened empty by its address — whose
 * messages land in `sent` and whose run is admitted and stopped at once.
 */
export function assistantHostDouble(
  options: {
    agents?: AgentHostAgent[];
    readPageDraft?: (...args: unknown[]) => unknown;
    sent?: string[];
    /** Every send's whole input, binding included. */
    inputs?: AgentHostSendRequest[];
    /** The page's notice stream, when a test drives it. */
    sessionRuns?: SessionRunPort;
  } = {},
) {
  const session = (agentId: string) => ({ id: SESSION, agentId, title: "", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null });
  return {
    listAgents: async () => options.agents ?? [],
    listPageAgents: async () => ({ agents: options.agents ?? [], defaultAgentId: options.agents?.[0]?.id ?? null }),
    listSessions: async () => ({ sessions: [], nextCursor: null }),
    readPageDraft: options.readPageDraft ?? (async () => null),
    ...(options.sessionRuns ? { sessionRuns: options.sessionRuns } : {}),
    createSession: async (agentId: string) => session(agentId),
    readHistory: async () => ({
      pendingQuestions: [], session: session(options.agents?.[0]?.id ?? "agent"), messages: [], runs: [], latestRun: null,
      page: { messageSeq: 0, olderCursor: null },
    }),
    subscribe: () => () => {},
    async send(_sessionId: string, input: AgentHostSendRequest) {
      options.sent?.push(input.message);
      options.inputs?.push(input);
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

/**
 * The page's notice stream as the host serves it, driven by the test: what the feed subscribed with, the answers it gave
 * to presentation requests, and the frames the host sends.
 */
export function noticeStreamDouble() {
  const opened: SessionRunHandlers[] = [];
  const receipts: { sessionId: string; runId: string; receipt: PresentationReceipt }[] = [];
  const port: SessionRunPort = {
    read: async () => ({ sessions: [] }),
    subscribe(handlers) {
      opened.push(handlers);
      return () => {};
    },
    async presentationResult(sessionId, runId, receipt) {
      receipts.push({ sessionId, runId, receipt });
    },
  };
  return { port, opened, receipts, current: () => opened.at(-1)! };
}
