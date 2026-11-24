import { computed } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const values = instance.state.values;

    const selectedKey = computed(() => values.value.selected?.primaryKey ?? "");
    const toolTotal = usePanelOutput("serviceTools", "total");

    function refresh() {
      instance.refreshObjects();
    }

    return {
      t,
      selectedKey,
      toolTotal,
      refresh,
    };
  },
});
