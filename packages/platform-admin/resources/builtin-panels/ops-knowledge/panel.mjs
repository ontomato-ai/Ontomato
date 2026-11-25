import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in operations knowledge panel: two rounded cards with a fixed 320px knowledge tree
 * (including header title and compact refresh icon) and a 980px-constrained Markdown reader.
 */
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

    return {
      t,
      filePath,
      refresh,
    };
  },
});
