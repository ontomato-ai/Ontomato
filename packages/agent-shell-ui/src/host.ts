import { readSseData } from "@ontomato/contracts/sse";
import { agentHostSessionHistorySchema } from "@ontomato/contracts/agent-host";
import type { SessionHistoryQuery } from "@ontomato/contracts/session-history";
import { randomId } from "@ontomato/contracts/random-id";
import type {
  AgentHostAgent,
  AgentHostAgentList,
  AgentHostSendResult, AgentHostSendRequest,
  AgentHostArtifactResolution,
  AgentHostCreateSessionResponse,
  AgentHostRunSnapshot,
  AgentHostSession,
  AgentHostSessionPage,
  AgentHostSessionHistory,
  AgentHostSessionLiveFrame,
  AgentHostSessionRunFrame,
  AgentHostSessionRunSnapshot,
} from "@ontomato/contracts/agent-host";
import {
  agentHostSendResultSchema,
  agentHostSessionLiveFrameSchema,
  agentHostSessionRunFrameSchema,
  agentHostSessionRunSnapshotSchema,
  agentHostStreamFrameSchema,
} from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { PresentationReceipt } from "@ontomato/contracts/agent-presentation";
import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import { pageDraftReadSchema, type PageDraft } from "@ontomato/contracts/page-draft";
import type { RuntimeCursor, RuntimeEventEnvelope, RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import { agentTasksFrameSchema, type AgentTasksFrame } from "@ontomato/contracts/agent-tasks";

/*
 * The one client of the agent-host proxy interface: every host that serves this shell exposes the
 * same routes under its own prefix, scoped by that prefix alone.
 */

export interface HostStreamHandlers {
  frame(frame: RuntimeStreamFrame): void;
  /** The transport ended without the run stopping; the shell re-reads the snapshot. */
  error(error: unknown): void;
}

export interface TaskStreamHandlers {
  frame(frame: AgentTasksFrame): void;
  /** The stream ended before a settled snapshot; the shell opens it again and reads the whole snapshot. */
  error(error: unknown): void;
}

export interface SessionRunHandlers {
  /** Awaited, so frames are handled in the stream's order and a read finishes before the next frame. */
  frame(frame: AgentHostSessionRunFrame): Promise<void>;
  /**
   * The page view that shows a conversation display (design "long connections" 5): the stream is opened for that view,
   * its `ready` names this connection, and the live frames for the view — a request to show something, an object an
   * agent changed — ride on it. They are never replayed and are not lifecycle notices.
   */
  view?: { id: string; frame(frame: AgentHostSessionLiveFrame): void };
  /** The stream ended or could not be opened; the page opens it again, unless a frame broke the contract. */
  error(error: unknown): void;
}

/**
 * The user-level lifecycle notices of this host's readable conversations, and their light state. Passive: creating a
 * client opens nothing, and only the page's one feed subscribes.
 */
export interface SessionRunPort {
  read(sessionIds: string[]): Promise<AgentHostSessionRunSnapshot>;
  subscribe(handlers: SessionRunHandlers): () => void;
  /** The one answer to a live presentation request: what the display did and what it shows now. */
  presentationResult(sessionId: string, runId: string, receipt: PresentationReceipt): Promise<void>;
}

/**
 * A frame that broke the contract: no retry can fix it, so the page reports it and stops. Every other failure of the
 * notices is a line to open again.
 */
export class SessionRunStreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionRunStreamError";
  }
}

/**
 * Work a reply delegated, for a host whose conversations delegate any: the conversation's task stream and each
 * retrieval task's own run. Other hosts leave it out and the shell shows no tasks.
 */
export interface ShellTaskPort {
  /** Complete snapshots of the conversation's tasks; the stream ends after one that is settled. */
  subscribe(sessionId: string, handlers: TaskStreamHandlers): () => void;
  readProcess(sessionId: string, taskId: string): Promise<AgentHostRunSnapshot>;
  subscribeProcess(
    sessionId: string, taskId: string, after: Pick<RuntimeCursor, "seq" | "streamId">, handlers: HostStreamHandlers,
  ): () => void;
}

/**
 * The page whose skills the composer offers: the page's own skill is what an agent must carry to be a candidate. A page
 * with a menu code names it; one that opens to every member of the domain says so instead.
 */
export type AgentPageQuery =
  | { pageKey: string; permissionCode: string }
  | { pageKey: string; access: "domain-member" };

export interface AgentHostClient {
  listAgents(): Promise<AgentHostAgent[]>;
  /**
   * The agents that may take a message on this page, with the page's default agent when it registered one. A page the
   * reader holds no skill mapping for is refused, and so is a registered default that is no longer available: the page
   * shows the configuration error rather than choosing another agent.
   */
  listPageAgents(page: AgentPageQuery): Promise<{ agents: AgentHostAgent[]; defaultAgentId?: string }>;
  /** The agent's conversations, or those of the client's workspace when it has one. */
  listSessions(agentId: string, cursor: string | null): Promise<AgentHostSessionPage>;
  /** A new conversation with the agent, inside the client's workspace when it has one. */
  createSession(agentId: string): Promise<AgentHostSession>;
  readHistory(sessionId: string, query?: SessionHistoryQuery): Promise<AgentHostSessionHistory>;
  deleteSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  /** The host decides whether input steers the current execution or starts its next run. */
  send(sessionId: string, input: AgentHostSendRequest): Promise<AgentHostSendResult>;
  readRun(sessionId: string, runId: string): Promise<AgentHostRunSnapshot>;
  subscribe(
    sessionId: string,
    runId: string,
    after: Pick<RuntimeCursor, "seq" | "streamId">,
    handlers: HostStreamHandlers,
  ): () => void;
  cancel(sessionId: string, runId: string): Promise<void>;
  /** The run's version of a path: at the run's end once stopped, the current one while running. */
  resolveArtifact(sessionId: string, runId: string, path: string): Promise<RuntimeArtifact | null>;
  /** The page draft a run wrote, at the path its page link named; the host serves its drafts directory alone. */
  readPageDraft(sessionId: string, runId: string, path: string): Promise<PageDraft<Record<string, unknown>>>;
  /** Records the object a create draft's first save created, so the draft addresses it from then on. */
  recordPageDraftCreated(sessionId: string, runId: string, path: string, id: string): Promise<void>;
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
  tasks?: ShellTaskPort;
  /** The list's own state source: notices plus a light read, never the conversation being open. */
  readonly sessionRuns: SessionRunPort;
}

/**
 * The workspace a client's conversations belong to: they are created inside it and listed from the workspace's own
 * conversation list, which is a read of the workspace interface rather than of this host's, so the host makes it.
 */
export interface AgentHostWorkspaceScope {
  id: string;
  listSessions(cursor: string | null): Promise<AgentHostSessionPage>;
}

export interface AgentHostClientOptions {
  /**
   * Authenticated request to a path relative to the host prefix. Resolves only for 2xx responses and
   * throws the host's own error otherwise, so error display stays with the host.
   */
  request(path: string, init: RequestInit): Promise<Response>;
  /** Filters or renames the agents this host serves; the shell shows the result verbatim. */
  agents?(agents: AgentHostAgent[]): AgentHostAgent[];
  /** Called for every applied run frame, so a host page can refresh its own view of the run. */
  onEvent?(sessionId: string, envelope: RuntimeEventEnvelope): void;
  /** Binds every conversation of this client to one workspace. */
  workspace?: AgentHostWorkspaceScope;
  /** The host serves the task routes under each conversation (`/sessions/:id/tasks...`). */
  tasks?: boolean;
}

const enc = encodeURIComponent;

export function createAgentHostClient(options: AgentHostClientOptions): AgentHostClient {
  const call = (path: string, init: RequestInit = {}) => options.request(path, init);
  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> =>
    (await call(path, init)).json() as Promise<T>;
  const send = (method: string, body: unknown, idempotent = false): RequestInit => ({
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idempotent ? { "Idempotency-Key": randomId() } : {}),
    },
    body: JSON.stringify(body),
  });
  const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
  const session = (id: string) => `/sessions/${enc(id)}`;
  const run = (sessionId: string, runId: string) => `${session(sessionId)}/runs/${enc(runId)}`;
  const task = (sessionId: string, taskId: string) => `${session(sessionId)}/tasks/${enc(taskId)}`;

  function subscribe(
    path: string,
    sessionId: string,
    after: Pick<RuntimeCursor, "seq" | "streamId">,
    handlers: HostStreamHandlers,
  ) {
    const controller = new AbortController();
    const params = new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId });
    const frame = (value: RuntimeStreamFrame) => {
      if (options.onEvent && value.type === "event") options.onEvent(sessionId, value.envelope);
      handlers.frame(value);
    };
    void (async () => {
      try {
        const response = await call(`${path}/events?${params}`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        const ended = await readSseData(response, (data) => {
          const parsed = agentHostStreamFrameSchema.parse(data);
          frame(parsed);
          return parsed.type === "snapshot_required" || parsed.envelope.event.type === "agent_end";
        }, () => !controller.signal.aborted);
        if (!ended && !controller.signal.aborted) handlers.error(new Error("stream closed"));
      } catch (error) {
        if (!controller.signal.aborted) handlers.error(error);
      }
    })();
    return () => controller.abort();
  }

  const sessionRuns: SessionRunPort = {
    async read(sessionIds) {
      return agentHostSessionRunSnapshotSchema.parse(
        await json("/sessions/status", send("POST", { sessionIds })),
      );
    },
    subscribe(handlers) {
      const controller = new AbortController();
      void (async () => {
        try {
          const response = await call(`/sessions/run-events${handlers.view ? `?${query({ viewId: handlers.view.id })}` : ""}`, {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          // The stream carries no terminal frame: it ends only when the host or the transport closes it.
          await readSseData(response, async (data) => {
            // A live frame names itself; everything else on this stream is a lifecycle notice.
            const type = (data as { type?: unknown }).type;
            const live = type === "presentation" || type === "object-changed";
            const parsed = (live ? agentHostSessionLiveFrameSchema : agentHostSessionRunFrameSchema).safeParse(data);
            if (!parsed.success) throw new SessionRunStreamError("run notice frame broke the contract", { cause: parsed.error });
            if (live) handlers.view!.frame(parsed.data as AgentHostSessionLiveFrame);
            else await handlers.frame(parsed.data as AgentHostSessionRunFrame);
            return false;
          }, () => !controller.signal.aborted);
          if (!controller.signal.aborted) handlers.error(new Error("run notice stream closed"));
        } catch (error) {
          // A failed open, a dropped line and a host error are all a line to open again; only a frame off the contract
          // above ends the notices. This route names no resource, so a failed open is never a refusal of one.
          if (!controller.signal.aborted) handlers.error(error);
        }
      })();
      return () => controller.abort();
    },
    async presentationResult(sessionId, runId, receipt) {
      await call(`${run(sessionId, runId)}/presentation-result`, send("POST", receipt));
    },
  };

  const tasks: ShellTaskPort = {
    subscribe(sessionId, handlers) {
      const controller = new AbortController();
      void (async () => {
        try {
          const response = await call(`${session(sessionId)}/tasks/events`, {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          const settled = await readSseData(response, (data) => {
            const parsed = agentTasksFrameSchema.parse(data);
            handlers.frame(parsed);
            return parsed.settled;
          }, () => !controller.signal.aborted);
          if (!settled && !controller.signal.aborted) handlers.error(new Error("stream closed"));
        } catch (error) {
          if (!controller.signal.aborted) handlers.error(error);
        }
      })();
      return () => controller.abort();
    },
    readProcess(sessionId, taskId) {
      return json<AgentHostRunSnapshot>(`${task(sessionId, taskId)}/process`);
    },
    subscribeProcess(sessionId, taskId, after, handlers) {
      return subscribe(`${task(sessionId, taskId)}/process`, sessionId, after, handlers);
    },
  };

  return {
    ...(options.tasks ? { tasks } : {}),
    sessionRuns,
    async listAgents() {
      const agents = (await json<AgentHostAgentList>("/agents")).agents;
      return options.agents ? options.agents(agents) : agents;
    },
    async listPageAgents(page) {
      return assistantAgentListSchema.parse(await json(`/agents?${query({ ...page })}`));
    },
    listSessions(agentId, cursor) {
      if (options.workspace) return options.workspace.listSessions(cursor);
      return json<AgentHostSessionPage>(`/sessions?${query({ agentId, ...(cursor ? { cursor } : {}) })}`);
    },
    async createSession(agentId) {
      const body = options.workspace ? { agentId, workspaceId: options.workspace.id } : { agentId };
      return (await json<AgentHostCreateSessionResponse>("/sessions", send("POST", body, true))).session;
    },
    async readHistory(sessionId, input = {}) {
      return agentHostSessionHistorySchema.parse(await json(`${session(sessionId)}/history?${new URLSearchParams(input)}`));
    },
    async deleteSession(sessionId) {
      await call(session(sessionId), { method: "DELETE" });
    },
    async renameSession(sessionId, title) {
      await call(session(sessionId), send("PATCH", { title }));
    },
    async send(sessionId, input) {
      return agentHostSendResultSchema.parse(await json(`${session(sessionId)}/runs`, send("POST", input, true)));
    },
    readRun(sessionId, runId) {
      return json<AgentHostRunSnapshot>(run(sessionId, runId));
    },
    subscribe(sessionId, runId, after, handlers) {
      return subscribe(run(sessionId, runId), sessionId, after, handlers);
    },
    async cancel(sessionId, runId) {
      await call(`${run(sessionId, runId)}/cancel`, send("POST", {}));
    },
    async resolveArtifact(sessionId, runId, path) {
      const params = new URLSearchParams({ path });
      return (
        await json<AgentHostArtifactResolution>(`${run(sessionId, runId)}/artifacts/resolve?${params}`)
      ).artifact;
    },
    async readPageDraft(sessionId, runId, path) {
      return pageDraftReadSchema.parse(
        await json(`${run(sessionId, runId)}/page-draft?${query({ path })}`),
      );
    },
    async recordPageDraftCreated(sessionId, runId, path, id) {
      await call(`${run(sessionId, runId)}/page-draft/created`, send("POST", { path, id }));
    },
    async readArtifact(artifact) {
      return (await call(`${session(artifact.sessionId)}/artifacts/${enc(artifact.id)}/content`)).blob();
    },
  };
}
