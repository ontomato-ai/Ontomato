import { computed } from "vue";
import { mountPanel, panelAddress, usePanelBack, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/applications/app-template-two-entry/detail";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const creating = computed(() => instance.state.values.value.creating === true);
    const closeCreate = () => instance.state.set("creating", false);
    const { back: cancel } = usePanelBack(creating, closeCreate, { forms: "createForm" });
    const createDialog = computed({
      get: () => creating.value,
      set: (open) => { if (!open) void cancel(); },
    });
    function openDetail(target) {
      return navigate(panelAddress(DETAIL_PATH, { selected: target.primaryKey }));
    }
    function onCreated(target) {
      closeCreate();
      if (target.primaryKey) return openDetail(target);
    }
    return {
      creating, createDialog, closeCreate, openDetail, onCreated,
      startCreate: () => instance.state.set("creating", true),
    };
  },
});
