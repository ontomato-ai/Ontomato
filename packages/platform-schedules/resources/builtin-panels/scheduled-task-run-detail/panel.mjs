import { watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const headerResultPath = usePanelOutput("header", "resultPath");
    const headerRunning = usePanelOutput("header", "isRunning");
    const summaryStatus = usePanelOutput("summary", "status");

    watch(
      summaryStatus,
      (next) => {
        const value = typeof next === "string" ? next : "";
        if ((instance.state.values.value.loadStatus ?? "") !== value) {
          instance.state.set("loadStatus", value);
        }
      },
      { immediate: true },
    );

    watch(
      headerResultPath,
      (next) => {
        const value = typeof next === "string" ? next : "";
        if ((instance.state.values.value.resultPath ?? "") !== value) {
          instance.state.set("resultPath", value);
        }
      },
      { immediate: true },
    );

    watch(
      headerRunning,
      (next) => {
        const value = next === true;
        if (Boolean(instance.state.values.value.isRunning) !== value) {
          instance.state.set("isRunning", value);
        }
      },
      { immediate: true },
    );

    function refreshRun() {
      instance.refreshObjects();
    }

    return {
      t,
      refreshRun,
    };
  },
});
