import { computed, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelNarrow } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const selected = computed(() => instance.state.values.value.selected);
    const creating = computed(() => Boolean(instance.state.values.value.creating));
    const editing = ref(false);
    const hasDetail = computed(() => Boolean(selected.value || creating.value || editing.value));
    watch(instance.draft, draft => {
      if (!draft) return;
      if (!selected.value && !creating.value) instance.state.set("creating", true);
      else editing.value = true;
    }, { immediate: true });
    function onSelected() {
      editing.value = false;
      if (creating.value) instance.state.set("creating", false);
    }
    function closeEditor() {
      editing.value = false;
      if (creating.value) instance.state.set("creating", false);
    }
    function closeDetail() {
      editing.value = false;
      instance.state.setState({ selected: null, creating: false });
    }
    const { back } = usePanelBack(() => narrow.value && hasDetail.value, closeDetail);
    return { rootRef, narrow, selected, creating, editing, hasDetail, onSelected, closeEditor, back };
  },
});
