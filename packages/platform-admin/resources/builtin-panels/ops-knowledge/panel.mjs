import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });

    function refresh() {
      instance.refreshObjects();
    }

    function clearSelection() {
      instance.state.setState({ filePath: null });
    }

    return {
      t,
      filePath,
      refresh,
      clearSelection,
    };
  },
});
