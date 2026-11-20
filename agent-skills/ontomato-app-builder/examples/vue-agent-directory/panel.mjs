import { computed, ref } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const creating = ref(false);
    const selectAgent = value => {
      creating.value = false;
      instance.state.set("selected", value);
    };
    const newAgent = () => {
      creating.value = true;
      instance.state.set("selected", null);
    };
    return { selected, creating, selectAgent, newAgent };
  },
});
