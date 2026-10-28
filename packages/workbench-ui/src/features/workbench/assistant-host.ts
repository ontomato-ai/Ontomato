import {
  createAgentHostClient,
  type ShellFeedbackPort,
  type ShellFeedbackTarget,
  type ShellFeedbackValue,
} from "@ontomato/agent-shell-ui";
import {
  assistantDatasetSourceSchema,
  assistantFeedbackListSchema,
  assistantFeedbackSchema,
  type AssistantDatasetSource,
  type AssistantFeedback,
  type AssistantFeedbackWrite,
} from "@ontomato/contracts/assistant-chat";
import { ApiRequestError, nodeApiFetch, nodeApiGet, nodeApiPut } from "../../utils/api";

/** The workbench mounts the agent-host proxy and its own assistant actions here. */
const PREFIX = "/assistant";
const sessionPath = (sessionId: string) => `${PREFIX}/sessions/${encodeURIComponent(sessionId)}`;

/** The shared shell client over this host's authenticated requests. */
export function createAssistantClient() {
  return createAgentHostClient({
    request: (path, init) =>
      nodeApiFetch(
        `${PREFIX}${path}`,
        init.method ?? "GET",
        typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        { headers: init.headers, signal: init.signal },
      ),
  });
}

/** Answer feedback, stored by the workbench, shown by the shell's rating buttons. */
export function createAssistantFeedback(): ShellFeedbackPort {
  const cache = new Map<string, Promise<AssistantFeedback[]>>();
  const records = (sessionId: string, refresh = false) => {
    if (refresh || !cache.has(sessionId)) {
      cache.set(
        sessionId,
        nodeApiGet(`${sessionPath(sessionId)}/feedback`).then(
          (body) => assistantFeedbackListSchema.parse(body).feedback,
        ),
      );
    }
    return cache.get(sessionId)!;
  };
  const find = (list: AssistantFeedback[], target: ShellFeedbackTarget) =>
    list.find(
      (record) =>
        record.runId === target.runId && record.target.kind === "message" && record.target.id === target.messageId,
    );
  const value = (record: AssistantFeedback): ShellFeedbackValue => ({ rating: record.rating, reason: record.text });

  return {
    async read(target) {
      const record = find(await records(target.sessionId), target);
      return record ? value(record) : null;
    },
    async submit(target, next) {
      const write: AssistantFeedbackWrite = {
        runId: target.runId,
        target: { kind: "message", id: target.messageId },
        rating: next.rating,
        text: next.reason,
      };
      const record = assistantFeedbackSchema.parse(await nodeApiPut(`${sessionPath(target.sessionId)}/feedback`, write));
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

/** The verified retrieval behind a dataset file; null for any other file. */
export async function readDatasetSource(sessionId: string, artifactId: string): Promise<AssistantDatasetSource | null> {
  try {
    return assistantDatasetSourceSchema.parse(
      await nodeApiGet(`${sessionPath(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/dataset-source`),
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

/** The conversation as a PPTX built by the host from runtime history and accepted datasets. */
export async function exportConversationPpt(sessionId: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await nodeApiFetch(`${sessionPath(sessionId)}/export/ppt`, "POST", {});
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match ? decodeURIComponent(match[1] ?? match[2]!) : "conversation.pptx";
  return { blob: await response.blob(), fileName };
}
