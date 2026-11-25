import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in turn evidence panel: full-height frameless 280px list-detail workspace browser with
 * Enter-to-select-or-collect searchSubmit, inline retention/delete row actions, on-demand
 * artifact file inspection, and diagnosis entry.
 */

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

    const turnStatus = usePanelOutput("detailHeader", "status");
    const isCollecting = computed(() => turnStatus.value === "collecting");
    const hasEvidence = usePanelOutput("detailHeader", "hasEvidence");
    const gapsCount = usePanelOutput("evidenceGaps", "loadedCount");
    const gapsStatus = usePanelOutput("evidenceGaps", "status");
    const showGaps = computed(
      () => !isCollecting.value && ((typeof gapsCount.value === "number" && gapsCount.value > 0) || gapsStatus.value === "error"),
    );

    // Clear file selection when selection clears or switches to another turn unless patched together;
    // files load on demand when the user clicks a file node in the artifact tree.
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

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({ selected: null, filePath: null, fileSearch: null });
      instance.refreshObjects();
    }

    function onTurnRowOperationDone(operationName, outcome, rowRef) {
      if (outcome?.kind !== "success") return;
      if (operationName === "delete" && rowRef?.primaryKey && rowRef.primaryKey === selectedKey.value) {
        instance.state.setState({ selected: null, filePath: null, fileSearch: null });
      }
      instance.refreshObjects();
    }

    return {
      t,
      selectedKey,
      filePath,
      isCollecting,
      hasEvidence,
      showGaps,
      refresh,
      clearSelection,
      onDeleteDone,
      onTurnRowOperationDone,
    };
  },
});
