import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const mode = ref("view");
    watch(instance.draft, draft => {
      if (draft) mode.value = "edit";
    }, { immediate: true });
    const newAgent = () => {
      instance.state.set("selected", null);
      mode.value = "edit";
    };
    return { selected, mode, newAgent };
  },
});
