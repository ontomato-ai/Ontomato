import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/applications/app-template-two-entry/detail";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const creating = computed(() => instance.state.values.value.creating === true);
    const createDialog = computed({
      get: () => creating.value,
      set: value => {
        if (!value && creating.value) cancelCreate();
      },
    });
    function detailAddress(primaryKey) {
      return panelAddress(DETAIL_PATH, { selected: primaryKey });
    }
    function startCreate() {
      instance.state.set("creating", true);
    }
    function cancelCreate() {
      instance.state.set("creating", false);
    }
    function openDetail(item) {
      if (!item?.primaryKey) return;
      instance.state.set("creating", false);
      void navigate(detailAddress(item.primaryKey)).catch(() => undefined);
    }
    function onCreated(saved) {
      instance.state.set("creating", false);
      if (saved?.primaryKey) {
        void navigate(detailAddress(saved.primaryKey)).catch(() => undefined);
      }
    }
    return { creating, createDialog, startCreate, cancelCreate, openDetail, onCreated };
  },
});
