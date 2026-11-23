import { computed, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const AGENT = "platform:AgentDefinition";
const CAPABILITY_MAP = "/ontology/assets/capability-map";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selected);
    const mode = computed(() => state.values.value.mode ?? "list");
    const listedAgents = computed(() => state.values.value.listedAgents);
    const listStatus = usePanelOutput("list", "status");
    const listVisible = computed(
      () => listStatus.value !== null && listStatus.value !== "loading" && listStatus.value !== "forbidden",
    );
    let fallbackAfterRemoval = false;

    watch(selected, (agent, prev) => {
      if (agent) {
        fallbackAfterRemoval = false;
        state.set("mode", "edit");
      } else if (state.values.value.mode === "edit") {
        // When the host clears `selected` after `agents.delete` (`affected.removed`),
        // remember to select the first remaining agent once the refreshed list arrives.
        if (prev) fallbackAfterRemoval = true;
        state.set("mode", "list");
      }
    }, { immediate: true });

    watch([listStatus, listedAgents], ([status, listed]) => {
      if (status !== "ready" && status !== "empty") return;
      const agents = status === "empty" ? [] : listed;
      if (!Array.isArray(agents)) return;
      const current = state.values.value.selected;
      if (!current) {
        const shouldSelectFirst = state.values.value.mode == null
          || (fallbackAfterRemoval && state.values.value.mode === "list");
        fallbackAfterRemoval = false;
        if (shouldSelectFirst && agents.length) {
          state.set("selected", { className: AGENT, primaryKey: agents[0].primaryKey });
        }
        return;
      }
      if (!agents.some((row) => row.primaryKey === current.primaryKey)) {
        const first = agents[0];
        if (first) {
          state.set("selected", { className: AGENT, primaryKey: first.primaryKey });
        } else {
          state.setState({ selected: null, mode: "list" });
        }
      }
    }, { immediate: true });

    function viewType() {
      const address = panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: AGENT });
      void navigate(address);
    }

    function startCreate() {
      fallbackAfterRemoval = false;
      state.setState({ selected: null, mode: "create" });
    }

    return { mode, listStatus, listVisible, viewType, startCreate };
  },
});
