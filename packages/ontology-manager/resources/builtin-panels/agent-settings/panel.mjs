import { computed, ref, shallowRef, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const AGENT = "platform:AgentDefinition";
const CAPABILITY_MAP = "/ontology/assets/capability-map";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selected);
    const mode = computed(() => state.values.value.mode ?? "list");
    const listStatus = usePanelOutput("list", "status");
    const summaryLabel = usePanelOutput("summary", "label");
    const listedAgents = shallowRef([]);
    const listVersion = ref(0);
    let hasListed = false;

    const listVisible = computed(
      () => listStatus.value !== null && listStatus.value !== "loading" && listStatus.value !== "forbidden",
    );
    const selectedReady = computed(() => mode.value === "edit" && Boolean(summaryLabel.value));
    const formDirty = computed(() => Boolean(instance.forms.handle("form")?.dirty.value));
    const formMounted = computed(
      () => mode.value === "create" || (mode.value === "edit" && (selectedReady.value || formDirty.value)),
    );

    let pendingLeaveCreate = false;
    let pendingLeaveEditKey = null;
    let pendingFallbackRemovedKey = null;
    let fallbackStartVersion = 0;
    let fallbackSawLoading = false;

    function onListed(refs) {
      listedAgents.value = Array.isArray(refs) ? refs : [];
      hasListed = true;
      listVersion.value += 1;
    }

    watch(formDirty, (dirty) => {
      if (!dirty) {
        pendingLeaveCreate = false;
        pendingLeaveEditKey = null;
      }
    });

    watch(selected, (agent, prev) => {
      if (agent) {
        pendingFallbackRemovedKey = null;
        fallbackSawLoading = false;
        if (pendingLeaveEditKey !== null && agent.primaryKey === pendingLeaveEditKey) {
          pendingLeaveEditKey = null;
        } else if (state.values.value.mode === "create" && formDirty.value) {
          pendingLeaveCreate = true;
        }
        state.set("mode", "edit");
      } else if (pendingLeaveCreate && formDirty.value) {
        pendingLeaveCreate = false;
        state.set("mode", "create");
      } else if (state.values.value.mode === "edit") {
        // When the host clears `selected` after `remove.delete` (`affected.removed`),
        // remember the removed key and wait for the refreshed list before selecting the first remaining agent.
        if (prev?.primaryKey) {
          pendingFallbackRemovedKey = prev.primaryKey;
          fallbackStartVersion = listVersion.value;
          fallbackSawLoading = listStatus.value === "loading";
        }
        state.set("mode", "list");
      }
    }, { immediate: true });

    watch([listStatus, listedAgents, listVersion], ([status, listed]) => {
      if (status === "loading") {
        if (pendingFallbackRemovedKey !== null) fallbackSawLoading = true;
        return;
      }
      if (status !== "ready" && status !== "empty") return;
      // Never replace an explicit selection (e.g. a deep link to a deleted or forbidden agent)
      // with another agent; let the summary projection report the owner's reason in place.
      if (state.values.value.selected) return;

      const agents = status === "empty" ? [] : listed;
      if (state.values.value.mode == null) {
        if (status === "ready" && hasListed && agents.length) {
          state.set("selected", { className: AGENT, primaryKey: agents[0].primaryKey });
        }
        return;
      }

      if (pendingFallbackRemovedKey !== null && state.values.value.mode === "list") {
        if (status === "empty") {
          pendingFallbackRemovedKey = null;
          fallbackSawLoading = false;
          return;
        }
        const containsRemoved = agents.some((item) => item?.primaryKey === pendingFallbackRemovedKey);
        if (containsRemoved) return;
        const refreshed = listVersion.value > fallbackStartVersion || fallbackSawLoading;
        if (!refreshed) return;
        pendingFallbackRemovedKey = null;
        fallbackSawLoading = false;
        if (agents.length) {
          state.set("selected", { className: AGENT, primaryKey: agents[0].primaryKey });
        }
      }
    }, { immediate: true });

    function viewType() {
      const address = panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: AGENT });
      void navigate(address);
    }

    function startCreate() {
      pendingFallbackRemovedKey = null;
      fallbackSawLoading = false;
      pendingLeaveEditKey = selected.value?.primaryKey && formDirty.value ? selected.value.primaryKey : null;
      state.setState({ selected: null, mode: "create" });
    }

    return { mode, listStatus, listVisible, selectedReady, formMounted, onListed, viewType, startCreate };
  },
});
