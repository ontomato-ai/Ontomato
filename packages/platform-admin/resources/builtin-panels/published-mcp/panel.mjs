import { ref } from "vue";
import {
  mountPanel,
  usePanelContext,
} from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { refreshing, refreshObjects, t } = usePanelContext();
    const expandedCards = ref({});

    function onToolsToggle(key, event) {
      const open = Boolean(event?.currentTarget?.open);
      expandedCards.value = {
        ...expandedCards.value,
        [key]: open,
      };
    }

    function refresh() {
      void refreshObjects();
    }

    return {
      t,
      refreshing,
      expandedCards,
      onToolsToggle,
      refresh,
    };
  },
});
