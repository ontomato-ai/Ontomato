import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import {
  runtimeStreamFrameSchema,
  type RuntimeCursor,
  type RuntimeStreamFrame,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeRunStatus, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";

/*
 * The host proxy interface (agent-host): every host that serves this shell exposes the same routes
 * under its own prefix, so the shell owns one client for all of them. Messages, events and artifacts
 * keep the runtime's PI shapes.
 */

export interface HostAgent {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  enabled: boolean;
}

export interface HostRun {
  id: string;
  sessionId: string;
  status: RuntimeRunStatus;
  stopReason: RuntimeStopReason | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface HostSession {
  id: string;
  agentId: string;
  /** The first user message, verbatim; empty until the first run is accepted. */
  title: string;
  createdAt: string;
  updatedAt: string;
  latestRun: HostRun | null;
}

export type HostRunSnapshot = Pick<
  RuntimeRunSnapshot,
  "cursor" | "messages" | "pendingMessages" | "toolExecutions" | "artifacts"
> & { run: HostRun };

export interface HostSessionSnapshot {
  session: HostSession;
  messages: RuntimeRunSnapshot["messages"];
  latestRun: HostRunSnapshot | null;
}

export interface HostSessionPage {
  sessions: HostSession[];
  nextCursor: string | null;
}

export interface HostStreamHandlers {
  frame(frame: RuntimeStreamFrame): void;
  /** The transport ended without the run stopping; the shell re-reads the snapshot. */
  error(error: unknown): void;
}

export interface AgentHostClient {
  listAgents(): Promise<HostAgent[]>;
  listSessions(agentId: string, cursor: string | null): Promise<HostSessionPage>;
  createSession(agentId: string): Promise<HostSession>;
  readSession(sessionId: string): Promise<HostSessionSnapshot>;
  deleteSession(sessionId: string): Promise<void>;
  /** Every message, including the answer to a clarifying question, starts a run in the same session. */
  startRun(sessionId: string, message: string): Promise<HostRunSnapshot>;
  readRun(sessionId: string, runId: string): Promise<HostRunSnapshot>;
  subscribe(
    sessionId: string,
    runId: string,
    after: Pick<RuntimeCursor, "seq" | "streamId">,
    handlers: HostStreamHandlers,
  ): () => void;
  cancel(sessionId: string, runId: string): Promise<void>;
  /** The run's version of a path: at the run's end once stopped, the current one while running. */
  resolveArtifact(sessionId: string, runId: string, path: string): Promise<RuntimeArtifact | null>;
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
}

export interface AgentHostClientOptions {
  /**
   * Authenticated request to a path relative to the host prefix. Resolves only for 2xx responses and
   * throws the host's own error otherwise, so error display stays with the host.
   */
  request(path: string, init: RequestInit): Promise<Response>;
  /** Fixed query parameters and creation fields that scope this host (for example a workbench). */
  scope?: Record<string, string>;
}

const enc = encodeURIComponent;

export function createAgentHostClient(options: AgentHostClientOptions): AgentHostClient {
  const scope = options.scope ?? {};
  const call = (path: string, init: RequestInit = {}) => options.request(path, init);
  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> =>
    (await call(path, init)).json() as Promise<T>;
  const send = (method: string, body: unknown, idempotent = false): RequestInit => ({
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: JSON.stringify(body),
  });
  const query = (values: Record<string, string>) => new URLSearchParams({ ...scope, ...values }).toString();
  const session = (id: string) => `/sessions/${enc(id)}`;
  const run = (sessionId: string, runId: string) => `${session(sessionId)}/runs/${enc(runId)}`;

  return {
    async listAgents() {
      return (await json<{ agents: HostAgent[] }>(`/agents?${query({})}`)).agents;
    },
    listSessions(agentId, cursor) {
      return json<HostSessionPage>(`/sessions?${query({ agentId, ...(cursor ? { cursor } : {}) })}`);
    },
    async createSession(agentId) {
      return (await json<{ session: HostSession }>("/sessions", send("POST", { ...scope, agentId }, true))).session;
    },
    readSession(sessionId) {
      return json<HostSessionSnapshot>(session(sessionId));
    },
    async deleteSession(sessionId) {
      await call(session(sessionId), { method: "DELETE" });
    },
    async startRun(sessionId, message) {
      return (
        await json<{ snapshot: HostRunSnapshot }>(`${session(sessionId)}/runs`, send("POST", { message }, true))
      ).snapshot;
    },
    readRun(sessionId, runId) {
      return json<HostRunSnapshot>(run(sessionId, runId));
    },
    subscribe(sessionId, runId, after, handlers) {
      const controller = new AbortController();
      const params = new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId });
      void (async () => {
        try {
          const response = await call(`${run(sessionId, runId)}/events?${params}`, {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          const ended = await readFrames(response, handlers.frame, () => !controller.signal.aborted);
          if (!ended && !controller.signal.aborted) handlers.error(new Error("stream closed"));
        } catch (error) {
          if (!controller.signal.aborted) handlers.error(error);
        }
      })();
      return () => controller.abort();
    },
    async cancel(sessionId, runId) {
      await call(`${run(sessionId, runId)}/cancel`, send("POST", {}));
    },
    async resolveArtifact(sessionId, runId, path) {
      const params = new URLSearchParams({ path });
      return (
        await json<{ artifact: RuntimeArtifact | null }>(`${run(sessionId, runId)}/artifacts/resolve?${params}`)
      ).artifact;
    },
    async readArtifact(artifact) {
      return (await call(`${session(artifact.sessionId)}/artifacts/${enc(artifact.id)}/content`)).blob();
    },
  };
}

/**
 * Reads `data:` frames of the runtime SSE stream until the run ends or a snapshot is required.
 * Returns true when the stream ended on such a frame. Malformed frames throw.
 */
async function readFrames(
  response: Response,
  frame: (value: RuntimeStreamFrame) => void,
  current: () => boolean,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The event stream has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (current()) {
      const { done, value } = await reader.read();
      if (done) return false;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.startsWith("data:")) {
          data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
          continue;
        }
        if (line !== "" || data.length === 0) continue;
        const parsed = runtimeStreamFrameSchema.parse(JSON.parse(data.join("\n")));
        data = [];
        frame(parsed);
        if (parsed.type === "snapshot_required" || parsed.envelope.event.type === "agent_end") return true;
      }
    }
    return false;
  } finally {
    void reader.cancel().catch(() => {});
  }
}
