import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Panel P: the list, the summary, the form and the run-now button its declaration composes. Reading, saving and running
 * are the SDK's; what this module adds is whether a task is chosen, which the template shows the form and the button for.
 */
const Trial = {
  setup() {
    const { instance } = usePanelContext();
    const chosen = computed(() => instance.state.values.value.selectedTask != null);
    return { chosen };
  },
};

await mountPanel(Trial);
