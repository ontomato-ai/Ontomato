import type {
  AgentHostAgent,
  AgentHostAgentList,
  AgentHostAdmission,
  AgentHostArtifactResolution,
  AgentHostCreateSessionResponse,
  AgentHostRunSnapshot,
  AgentHostSession,
  AgentHostSessionPage,
  AgentHostSessionSnapshot,
} from "@ontomato/contracts/agent-host";
import { agentHostStreamFrameSchema } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeCursor, RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import type { RetrievalSnapshot } from "@ontomato/contracts/data-retrieval";

/*
 * The one client of the agent-host proxy interface: every host that serves this shell exposes the
 * same routes under its own prefix, scoped by that prefix alone.
 */

export interface HostStreamHandlers {
  frame(frame: RuntimeStreamFrame): void;
  /** The transport ended without the run stopping; the shell re-reads the snapshot. */
  error(error: unknown): void;
}

export interface AgentHostClient {
  listAgents(): Promise<AgentHostAgent[]>;
  listSessions(agentId: string, cursor: string | null): Promise<AgentHostSessionPage>;
  createSession(agentId: string): Promise<AgentHostSession>;
  readSession(sessionId: string): Promise<AgentHostSessionSnapshot>;
  deleteSession(sessionId: string): Promise<void>;
  /** Every message, including the answer to a clarifying question, starts a run in the same session. */
  startRun(sessionId: string, message: string): Promise<AgentHostRunSnapshot>;
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
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
  /**
   * Reads one retrieval's snapshot. The retrieval ID is stable across continuations of the same
   * retrieval, so callers use it as the poll key and fold state; runId scopes the specific run.
   */
  readRetrieval(sessionId: string, runId: string, retrievalId: string): Promise<RetrievalSnapshot>;
}

export interface AgentHostClientOptions {
  /**
   * Authenticated request to a path relative to the host prefix. Resolves only for 2xx responses and
   * throws the host's own error otherwise, so error display stays with the host.
   */
  request(path: string, init: RequestInit): Promise<Response>;
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
      ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: JSON.stringify(body),
  });
  const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
  const session = (id: string) => `/sessions/${enc(id)}`;
  const run = (sessionId: string, runId: string) => `${session(sessionId)}/runs/${enc(runId)}`;

  return {
    async listAgents() {
      return (await json<AgentHostAgentList>("/agents")).agents;
    },
    listSessions(agentId, cursor) {
      return json<AgentHostSessionPage>(`/sessions?${query({ agentId, ...(cursor ? { cursor } : {}) })}`);
    },
    async createSession(agentId) {
      return (await json<AgentHostCreateSessionResponse>("/sessions", send("POST", { agentId }, true))).session;
    },
    readSession(sessionId) {
      return json<AgentHostSessionSnapshot>(session(sessionId));
    },
    async deleteSession(sessionId) {
      await call(session(sessionId), { method: "DELETE" });
    },
    async startRun(sessionId, message) {
      return (
        await json<AgentHostAdmission>(`${session(sessionId)}/runs`, send("POST", { message }, true))
      ).snapshot;
    },
    readRun(sessionId, runId) {
      return json<AgentHostRunSnapshot>(run(sessionId, runId));
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
        await json<AgentHostArtifactResolution>(`${run(sessionId, runId)}/artifacts/resolve?${params}`)
      ).artifact;
    },
    async readArtifact(artifact) {
      return (await call(`${session(artifact.sessionId)}/artifacts/${enc(artifact.id)}/content`)).blob();
    },
    readRetrieval(sessionId, runId, retrievalId) {
      return json<RetrievalSnapshot>(
        `${run(sessionId, runId)}/retrievals/${enc(retrievalId)}`,
      );
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
        const parsed = agentHostStreamFrameSchema.parse(JSON.parse(data.join("\n")));
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
