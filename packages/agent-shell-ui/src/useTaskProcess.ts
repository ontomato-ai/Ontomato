import { computed, onBeforeUnmount, reactive } from "vue";
import type { ShellTaskPort } from "./host";
import { applyEnvelope, applyRunSnapshot, emptyConversation } from "./conversation";
import { createRunSubscription } from "./run-subscription";
import { conversationItems, type ResponseItem } from "./view";

/**
 * A retrieval task's own run, followed like a conversation's run with the same reducer but in its own state: its
 * messages never join the reply that delegated it.
 */
export function useTaskProcess(port: ShellTaskPort, sessionId: string, taskId: string, runId: string) {
  const conversation = reactive(emptyConversation());
  const stream = createRunSubscription();
  void stream.load({
    runId,
    current: () => conversation.runs[runId],
    read: () => port.readProcess(sessionId, taskId),
    snapshot: (snapshot) => applyRunSnapshot(conversation, snapshot),
    event: (envelope) => { applyEnvelope(conversation, envelope); },
    subscribe: (after, handlers) => port.subscribeProcess(sessionId, taskId, after, handlers),
  });
  onBeforeUnmount(stream.stop);
  /** The run's own response; the request the retriever was given is not shown. */
  const response = computed(() =>
    conversationItems(conversation).find((item): item is ResponseItem => item.kind === "response") ?? null);
  return { response };
}
