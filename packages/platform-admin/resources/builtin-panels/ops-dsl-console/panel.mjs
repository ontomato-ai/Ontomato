import { ref, shallowRef } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const executionResult = shallowRef(null);
    const executionError = ref("");

    function onExecuteRead(result) {
      executionError.value = "";
      executionResult.value = result;
    }

    function onExecuteError(error) {
      executionResult.value = null;
      executionError.value = error instanceof Error && error.message
        ? error.message
        : t("panel.executeFailed");
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
      executionResult,
      executionError,
      onExecuteRead,
      onExecuteError,
      resetDraft,
      clearDraft,
    };
  },
});
