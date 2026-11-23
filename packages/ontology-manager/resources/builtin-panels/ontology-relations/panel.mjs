import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/relations/detail";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value),
    });

    // Format the ObjectList projection's declared filteredCount read-only output (`14 项` / `0 项`).
    const filteredCount = usePanelOutput("catalogue", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : `${filteredCount.value} 项`));

    const creating = computed(() => instance.state.values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value ? true : null);

    function detailAddress(primaryKey) {
      return panelAddress(DETAIL_PATH, { selected: primaryKey });
    }

    function open(ref) {
      if (!ref?.primaryKey) return;
      if (creating.value) setCreating(false);
      void navigate(detailAddress(ref.primaryKey)).catch(() => undefined);
    }

    function startCreate() {
      setCreating(true);
    }

    function cancelCreate() {
      setCreating(false);
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });

    function onSaved(saved) {
      setCreating(false);
      const key = saved?.primaryKey;
      if (key) void navigate(detailAddress(key)).catch(() => undefined);
    }

    function onDiscarded() {
      setCreating(false);
    }

    return {
      countText, search, creating, createDialog,
      open, startCreate, cancelCreate, onSaved, onDiscarded,
      refresh: () => instance.refreshObjects(),
    };
  },
});
