import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Agent settings. The declaration says what the instance keeps and composes; reading the agents, drawing the owner's
 * form, carrying a draft, saving and selecting the agent a create made are the SDK's.
 *
 * What this module adds is the instance's mode, kept in step with the selection: choosing an agent edits it, letting go
 * of it returns to the list, and the panel's `newAgent` operation (a state change) clears the selection and creates.
 * Once a create is saved the SDK selects the new agent, which is editing it.
 */
const AgentSettings = {
  setup() {
    const { instance } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selectedAgent);
    watch(selected, (agent) => {
      if (agent) state.set("mode", "edit");
      else if (state.values.value.mode === "edit") state.set("mode", "list");
    }, { immediate: true });
    const mode = computed(() => state.values.value.mode ?? "list");
    return { mode };
  },
};

await mountPanel(AgentSettings);
