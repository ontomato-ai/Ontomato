import { computed, watch, type Ref } from "vue";
import type { Message } from "../../../types/chat";
import { authHost } from "../../../utils/auth";
import { chatApi } from "../api";

const QUALITY_CHECK_READ_INTERVAL_MS = 2_000;

export function watchQualityChecks(messages: Ref<Message[]>, threadId: Ref<string>): () => void {
  const pending = computed(() =>
    messages.value.flatMap(({ snapshot }) => {
      const state = snapshot?.execution?.qcState;
      return snapshot?.status === "completed" && typeof snapshot.requestSeq === "number" &&
        state?.status === "running" && state.deadlineAt !== undefined
        ? [snapshot.requestSeq]
        : [];
    }).join(",")
  );

  const getCredential = () => authHost().getToken() || authHost().getApiKey();
  let cancelRead: (() => void) | undefined;

  watch([threadId, pending], ([watchedThread, requests], _previous, onCleanup) => {
    if (!requests) return;
    const requestSeqs = requests.split(",").map(Number);
    const controller = new AbortController();
    const credential = getCredential();
    let timer: ReturnType<typeof setTimeout>;
    const isCurrent = () =>
      !controller.signal.aborted && threadId.value === watchedThread && credential === getCredential();

    cancelRead = () => {
      controller.abort();
      clearTimeout(timer);
    };
    onCleanup(cancelRead);

    const read = async () => {
      try {
        const checks = new Map(await Promise.all(requestSeqs.map(async (requestSeq) => [
          requestSeq,
          await chatApi.getQualityCheck(watchedThread, requestSeq, controller.signal),
        ] as const)));
        if (!isCurrent()) return;
        for (const { snapshot } of messages.value) {
          if (snapshot?.requestSeq === undefined ||
              snapshot.execution?.qcState?.status !== "running") continue;
          const check = checks.get(snapshot.requestSeq);
          if (check && check.qcState.status !== "running") {
            snapshot.execution = { ...snapshot.execution, ...check };
          }
        }
        if (isCurrent() && pending.value === requests) {
          timer = setTimeout(read, QUALITY_CHECK_READ_INTERVAL_MS);
        }
      } catch (error) {
        if (isCurrent()) console.warn("Unable to read quality-check updates", error);
      }
    };

    void read();
  });

  return () => cancelRead?.();
}
