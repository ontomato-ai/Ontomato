import { computed, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const AGENT = "platform:AgentDefinition";
const CAPABILITY_MAP = "/ontology/assets/capability-map";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selected);
    const mode = computed(() => state.values.value.mode ?? "list");
    const rows = usePanelData("list", "rows");

    watch(selected, (agent) => {
      if (agent) state.set("mode", "edit");
      else if (state.values.value.mode === "edit") state.set("mode", "list");
    }, { immediate: true });

    watch(rows, (result) => {
      if (result.status !== "ready") return;
      const agents = result.value ?? [];
      const current = state.values.value.selected;
      if (!current) {
        if (state.values.value.mode == null && agents.length) {
          state.set("selected", { className: AGENT, primaryKey: agents[0].primaryKey });
        }
        return;
      }
      if (!agents.some((row) => row.primaryKey === current.primaryKey)) {
        const first = agents[0];
        state.set("selected", first ? { className: AGENT, primaryKey: first.primaryKey } : null);
      }
    });

    function viewType() {
      const address = panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: AGENT });
      void navigate(address);
    }

    function startCreate() {
      state.setState({ selected: null, mode: "create" });
    }

    return { mode, rows, viewType, startCreate };
  },
});
