import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/applications/app-template-two-entry/detail";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    function openDetail({ primaryKey }) {
      return navigate(panelAddress(DETAIL_PATH, { selected: primaryKey }));
    }
    const creating = computed({
      get: () => instance.state.values.value.creating,
      set: (open) => instance.state.set("creating", open),
    });
    function onCreated(target) {
      creating.value = false;
      if (target.primaryKey !== null) return openDetail(target);
    }
    return { openDetail, creating, onCreated };
  },
});
