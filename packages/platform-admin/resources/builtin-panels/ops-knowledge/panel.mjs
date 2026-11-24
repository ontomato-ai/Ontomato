import { mountPanel, usePanelContext, usePanelState } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const context = usePanelContext();
    const filePath = usePanelState("filePath");

    function refresh() {
      context.refresh();
    }

    function clearSelection() {
      filePath.value = null;
    }

    return {
      t: context.t,
      filePath,
      refresh,
      clearSelection,
    };
  },
});
