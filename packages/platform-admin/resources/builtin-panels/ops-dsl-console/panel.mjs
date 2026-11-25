import { onBeforeUnmount, ref, shallowRef } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in DSL execution console panel: dual-pane editor and multi-section result inspector with
 * draggable split resize (25%-70%, default 42%) and toast notifications on execution outcomes.
 */

const MIN_LEFT_PERCENT = 25;
const MAX_LEFT_PERCENT = 70;
const DEFAULT_LEFT_PERCENT = 42;

function extractRawPayload(result) {
  if (!result || typeof result !== "object") return null;
  if (result.kind === "sections" && Array.isArray(result.sections)) {
    const rawSection = result.sections.find((section) => section?.id === "raw" && section?.kind === "json");
    if (rawSection) return rawSection.value ?? null;
    const firstJson = result.sections.find((section) => section?.kind === "json");
    return firstJson?.value ?? null;
  }
  if (result.kind === "json") {
    return result.value ?? null;
  }
  return null;
}

function isBusinessErrorPayload(payload) {
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== "object" || Array.isArray(payload)) return false;
  return Boolean(payload.error) || payload.success === false;
}

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const executionResult = shallowRef(null);
    const executionError = ref("");

    // ---- Resizable split pane state ----
    const splitContainer = ref(null);
    const leftPercent = ref(DEFAULT_LEFT_PERCENT);
    const isDragging = ref(false);
    let cleanupDragListeners = null;

    function stopDragging() {
      if (cleanupDragListeners) {
        cleanupDragListeners();
        cleanupDragListeners = null;
      }
      isDragging.value = false;
    }

    function onDragStart(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      stopDragging();
      isDragging.value = true;
      const startX = event.clientX;
      const startPercent = leftPercent.value;

      function onMove(moveEvent) {
        const containerW = splitContainer.value?.clientWidth || 800;
        const delta = moveEvent.clientX - startX;
        const deltaPercent = (delta / containerW) * 100;
        leftPercent.value = Math.max(
          MIN_LEFT_PERCENT,
          Math.min(MAX_LEFT_PERCENT, startPercent + deltaPercent),
        );
      }

      function onUp() {
        stopDragging();
      }

      if (typeof document !== "undefined") {
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        if (typeof window !== "undefined") {
          window.addEventListener("blur", onUp);
        }
        cleanupDragListeners = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          if (typeof window !== "undefined") {
            window.removeEventListener("blur", onUp);
          }
        };
      }
    }

    onBeforeUnmount(() => {
      stopDragging();
    });

    // ---- Execution outcome handlers ----
    function onExecuteRead(result) {
      executionError.value = "";
      executionResult.value = result;
      const rawPayload = extractRawPayload(result);
      if (result?.defaultSectionId === "raw" || isBusinessErrorPayload(rawPayload)) {
        notify({ kind: "error", text: t("panel.executeFailed") });
      } else {
        notify({ kind: "success", text: t("panel.executeSuccess") });
      }
    }

    function onExecuteError(error) {
      executionResult.value = null;
      executionError.value = error instanceof Error && error.message
        ? error.message
        : t("panel.executeFailed");
      notify({ kind: "error", text: t("panel.executeFailed") });
    }

    async function resetDraft() {
      executionError.value = "";
      const handle = instance.forms.handle("dslForm");
      if (handle) {
        await handle.reset({ confirm: false });
      }
    }

    function clearDraft() {
      executionError.value = "";
      const handle = instance.forms.handle("dslForm");
      if (handle) {
        handle.set("/dsl", "");
      }
    }

    return {
      t,
      splitContainer,
      leftPercent,
      isDragging,
      onDragStart,
      executionResult,
      executionError,
      onExecuteRead,
      onExecuteError,
      resetDraft,
      clearDraft,
    };
  },
});
