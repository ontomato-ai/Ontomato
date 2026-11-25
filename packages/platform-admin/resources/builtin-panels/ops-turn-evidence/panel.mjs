import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in turn evidence panel: list-detail workspace browser for collecting, inspecting, retaining,
 * downloading, deleting, and diagnosing TurnEvidence packages and their artifact files.
 */

const TURN_EVIDENCE_TYPE = "platform:TurnEvidence";

await mountPanel({
  setup() {
    const context = usePanelContext();
    const { instance, t } = context;

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const fileSearch = computed(() => {
      const value = instance.state.values.value.fileSearch;
      return typeof value === "string" && value.length > 0 ? value : null;
    });

    const hasEvidence = usePanelOutput("detailHeader", "hasEvidence");
    const gapsCount = usePanelOutput("evidenceGaps", "loadedCount");
    const gapsStatus = usePanelOutput("evidenceGaps", "status");
    const showGaps = computed(() => (typeof gapsCount.value === "number" && gapsCount.value > 0) || gapsStatus.value === "error");

    // Clear file selection and tree filter when selection clears or switches to another turn without an explicit
    // filePath/fileSearch in the same state patch; ObjectTree then selects the first file once files load.
    watch(
      selectedKey,
      (turnKey, previousTurnKey) => {
        if (!turnKey) {
          if (filePath.value !== null || fileSearch.value !== null) {
            instance.state.setState({ filePath: null, fileSearch: null });
          }
          return;
        }
        if (previousTurnKey && previousTurnKey !== turnKey) {
          const patch = {};
          if (!instance.state.lastPatchedKeys.has("filePath") && filePath.value !== null) {
            patch.filePath = null;
          }
          if (!instance.state.lastPatchedKeys.has("fileSearch") && fileSearch.value !== null) {
            patch.fileSearch = null;
          }
          if (Object.keys(patch).length > 0) {
            instance.state.setState(patch);
          }
        }
      },
      { immediate: true, flush: "sync" },
    );

    function refresh() {
      instance.refreshObjects();
    }

    function clearSelection() {
      instance.state.setState({ selected: null, filePath: null, fileSearch: null });
    }

    function onBuildDone(outcome) {
      if (outcome?.kind !== "success") return;
      const created = outcome.created;
      const primaryKey = created?.primaryKey || (typeof outcome.data?.turnKey === "string" ? outcome.data.turnKey : "");
      if (!primaryKey) return;
      const className = created?.objectType || TURN_EVIDENCE_TYPE;
      instance.state.setState({
        selected: { className, primaryKey },
        filePath: null,
        fileSearch: null,
      });
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({ selected: null, filePath: null, fileSearch: null });
    }

    return {
      t,
      selectedKey,
      filePath,
      hasEvidence,
      showGaps,
      refresh,
      clearSelection,
      onBuildDone,
      onDeleteDone,
    };
  },
});
