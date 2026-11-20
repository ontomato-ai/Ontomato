import { computed, ref } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const creating = ref(false);
    function newRecord() {
      creating.value = true;
      instance.state.set("selected", null);
    }
    function stopCreating() {
      creating.value = false;
    }
    return { selected, creating, newRecord, stopCreating };
  },
});
