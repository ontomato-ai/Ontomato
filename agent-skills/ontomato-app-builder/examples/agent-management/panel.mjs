import { computed, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelNarrow } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const selected = computed(() => instance.state.values.value.selected);
    const creating = computed(() => Boolean(instance.state.values.value.creating));
    const hasDetail = computed(() => Boolean(selected.value || creating.value));
    watch(instance.draft, draft => {
      if (draft && !selected.value && !creating.value) instance.state.set("creating", true);
    }, { immediate: true });
    function stopCreating() {
      if (creating.value) instance.state.set("creating", false);
    }
    function closeDetail() {
      instance.state.setState({ selected: null, creating: false });
    }
    const { back } = usePanelBack(() => narrow.value && hasDetail.value, closeDetail);
    return { rootRef, narrow, selected, creating, hasDetail, stopCreating, back };
  },
});
