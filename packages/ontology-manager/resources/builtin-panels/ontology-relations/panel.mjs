import { computed, ref } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelNarrow, usePanelOutput } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/relations/detail";

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const dialogWidth = computed(() => (narrow.value ? "94%" : "540px"));

    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value),
    });

    // Format the ObjectList projection's declared filteredCount read-only output in the viewer's language.
    const filteredCount = usePanelOutput("catalogue", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : t("rel.count", { count: filteredCount.value })));

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
      rootRef, dialogWidth,
      countText, search, creating, createDialog,
      open, startCreate, cancelCreate, onSaved, onDiscarded,
    };
  },
});
