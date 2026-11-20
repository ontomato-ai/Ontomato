import { computed, ref } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const detail = usePanelData("detail", "record");
    const creating = ref(false);
    const stopCreating = () => {
      creating.value = false;
    };
    const newAgent = () => {
      creating.value = true;
      instance.state.set("selected", null);
    };
    return { selected, detail, creating, stopCreating, newAgent };
  },
});
