import { createAgentHostClient, type ShellFeedbackPort, type ShellFeedbackTarget, type ShellFeedbackValue } from "@ontomato/agent-shell-ui";
import { nodeApiFetch, nodeApiGet, nodeApiPut } from "../../utils/api";

const PREFIX = "/assistant";

/** The workbench's agent-host proxy: the shared shell client over this host's authenticated requests. */
export function createAssistantClient(workbenchId: string) {
  return createAgentHostClient({
    request: (path, init) =>
      nodeApiFetch(
        `${PREFIX}${path}`,
        init.method ?? "GET",
        typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        { headers: init.headers, signal: init.signal },
      ),
    scope: { workbenchId },
  });
}

interface FeedbackRecord {
  id: string;
  runId: string;
  target: { kind: "message" | "artifact"; id: string };
  rating: "like" | "dislike";
  text: string;
}

const sessionPath = (sessionId: string) => `${PREFIX}/sessions/${encodeURIComponent(sessionId)}`;

/** Answer feedback, stored by the workbench (assistant-chat), shown by the shell's rating buttons. */
export function createAssistantFeedback(): ShellFeedbackPort {
  const cache = new Map<string, Promise<FeedbackRecord[]>>();
  const records = (sessionId: string, refresh = false) => {
    if (refresh || !cache.has(sessionId)) {
      cache.set(
        sessionId,
        nodeApiGet(`${sessionPath(sessionId)}/feedback`).then((body: { feedback: FeedbackRecord[] }) => body.feedback),
      );
    }
    return cache.get(sessionId)!;
  };
  const find = (list: FeedbackRecord[], target: ShellFeedbackTarget) =>
    list.find(
      (record) =>
        record.runId === target.runId && record.target.kind === "message" && record.target.id === target.messageId,
    );
  const value = (record: FeedbackRecord): ShellFeedbackValue => ({ rating: record.rating, reason: record.text });

  return {
    async read(target) {
      const record = find(await records(target.sessionId), target);
      return record ? value(record) : null;
    },
    async submit(target, next) {
      const record: FeedbackRecord = await nodeApiPut(`${sessionPath(target.sessionId)}/feedback`, {
        runId: target.runId,
        target: { kind: "message", id: target.messageId },
        rating: next.rating,
        text: next.reason,
      });
      void records(target.sessionId, true);
      return value(record);
    },
    async remove(target) {
      const record = find(await records(target.sessionId, true), target);
      if (record)
        await nodeApiFetch(`${sessionPath(target.sessionId)}/feedback/${encodeURIComponent(record.id)}`, "DELETE");
      void records(target.sessionId, true);
    },
  };
}
