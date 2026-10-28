import type {
  AgentShellPort,
  ShellAgent,
  ShellFeedbackTarget,
  ShellFeedbackValue,
  ShellRunSnapshot,
  ShellSession,
  ShellSessionPage,
  ShellSessionSnapshot,
} from "@ontomato/contracts/agent-shell";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { runtimeStreamFrameSchema } from "@ontomato/contracts/agent-runtime-events";
import { readSseData } from "../../utils/agent-chat-stream";
import { nodeApiFetch, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";

interface FeedbackRecord {
  id: string;
  runId: string;
  target: { kind: "message" | "artifact"; id: string };
  rating: "like" | "dislike";
  text: string;
}

const base = "/assistant";
const sessionPath = (sessionId: string) => `${base}/sessions/${encodeURIComponent(sessionId)}`;
const runPath = (sessionId: string, runId: string) =>
  `${sessionPath(sessionId)}/runs/${encodeURIComponent(runId)}`;

/**
 * Connects the agent shell to the workbench assistant HTTP API. A transport adapter only:
 * shapes pass through unchanged and every state decision stays with the runtime and the shell.
 */
export function createAssistantPort(workbenchId: string): AgentShellPort {
  const feedbackCache = new Map<string, Promise<FeedbackRecord[]>>();

  function feedbackFor(sessionId: string, refresh = false) {
    if (refresh || !feedbackCache.has(sessionId)) {
      feedbackCache.set(
        sessionId,
        nodeApiGet(`${sessionPath(sessionId)}/feedback`).then(
          (body: { feedback: FeedbackRecord[] }) => body.feedback,
        ),
      );
    }
    return feedbackCache.get(sessionId)!;
  }

  const findFeedback = (records: FeedbackRecord[], target: ShellFeedbackTarget) =>
    records.find(
      (record) =>
        record.runId === target.runId &&
        record.target.kind === "message" &&
        record.target.id === target.messageId,
    );

  const value = (record: FeedbackRecord): ShellFeedbackValue => ({
    rating: record.rating,
    reason: record.text,
  });

  return {
    async listAgents() {
      const body: { agents: ShellAgent[] } = await nodeApiGet(
        `${base}/agents?${new URLSearchParams({ workbenchId })}`,
      );
      return body.agents;
    },

    async listSessions(agentId, cursor) {
      const query = new URLSearchParams({ workbenchId, agentId });
      if (cursor) query.set("cursor", cursor);
      const page: ShellSessionPage = await nodeApiGet(`${base}/sessions?${query}`);
      return page;
    },

    readSession(sessionId): Promise<ShellSessionSnapshot> {
      return nodeApiGet(sessionPath(sessionId));
    },

    async deleteSession(sessionId) {
      await nodeApiFetch(sessionPath(sessionId), "DELETE");
      feedbackCache.delete(sessionId);
    },

    async send({ agentId, sessionId, text }) {
      let createdSession: ShellSession | null = null;
      if (!sessionId) {
        const created: { session: ShellSession } = await nodeApiPost(
          `${base}/sessions`,
          { workbenchId, agentId },
          { headers: { "Idempotency-Key": crypto.randomUUID() } },
        );
        createdSession = { ...created.session, title: created.session.title || text };
      }
      const target = sessionId ?? createdSession!.id;
      const admission: { snapshot: ShellRunSnapshot } = await nodeApiPost(
        `${sessionPath(target)}/runs`,
        { message: text },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      return { createdSession, snapshot: admission.snapshot };
    },

    readRun(sessionId, runId): Promise<ShellRunSnapshot> {
      return nodeApiGet(runPath(sessionId, runId));
    },

    subscribe(sessionId, runId, after, handlers) {
      const controller = new AbortController();
      const query = new URLSearchParams({ afterSeq: String(after.seq), streamId: after.streamId });
      const current = () => !controller.signal.aborted;
      void (async () => {
        try {
          const response = await nodeApiFetch(`${runPath(sessionId, runId)}/events?${query}`, "GET", undefined, {
            signal: controller.signal,
            headers: { Accept: "text/event-stream" },
          });
          let ended = false;
          await readSseData(
            response,
            (data) => {
              const frame = runtimeStreamFrameSchema.parse(data);
              handlers.frame(frame);
              ended =
                frame.type === "snapshot_required" ||
                frame.envelope.event.type === "agent_end";
              return ended;
            },
            current,
          );
          if (!ended && current()) handlers.error(new Error("stream closed"));
        } catch (error) {
          if (current()) handlers.error(error);
        }
      })();
      return () => controller.abort();
    },

    async cancel(sessionId, runId) {
      await nodeApiPost(`${runPath(sessionId, runId)}/cancel`, {});
    },

    async resolveArtifact({ sessionId, runId, path }) {
      const body: { artifact: RuntimeArtifact | null } = await nodeApiGet(
        `${runPath(sessionId, runId)}/artifacts/resolve?${new URLSearchParams({ path })}`,
      );
      return body.artifact;
    },

    async readArtifact(artifact) {
      const response = await nodeApiFetch(
        `${sessionPath(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.id)}/content`,
        "GET",
      );
      return response.blob();
    },

    feedback: {
      async read(target) {
        const record = findFeedback(await feedbackFor(target.sessionId), target);
        return record ? value(record) : null;
      },
      async submit(target, next) {
        const record: FeedbackRecord = await nodeApiPut(`${sessionPath(target.sessionId)}/feedback`, {
          runId: target.runId,
          target: { kind: "message", id: target.messageId },
          rating: next.rating,
          text: next.reason,
        });
        void feedbackFor(target.sessionId, true);
        return value(record);
      },
      async remove(target) {
        const record = findFeedback(await feedbackFor(target.sessionId, true), target);
        if (record)
          await nodeApiFetch(
            `${sessionPath(target.sessionId)}/feedback/${encodeURIComponent(record.id)}`,
            "DELETE",
          );
        void feedbackFor(target.sessionId, true);
      },
    },
  };
}
