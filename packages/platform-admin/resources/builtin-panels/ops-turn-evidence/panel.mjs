import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOperation, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in turn evidence panel: full-height frameless 280px list-detail workspace browser with
 * panel-owned Enter-to-select-or-collect search bar (`turns.build`), inline retention/delete row
 * actions, on-demand artifact file inspection, and diagnosis entry.
 */

await mountPanel({
  setup() {
    const context = usePanelContext();
    const { instance, notify, t } = context;

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const searchText = computed(() => {
      const value = instance.state.values.value.search;
      return typeof value === "string" ? value : "";
    });
    const searchError = ref(null);
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const fileSearch = computed(() => {
      const value = instance.state.values.value.fileSearch;
      return typeof value === "string" && value.length > 0 ? value : null;
    });

    const listedTurns = usePanelOutput("turns", "listed");
    const turnStatus = usePanelOutput("detailHeader", "status");
    const isCollecting = computed(() => turnStatus.value === "collecting");
    const hasEvidence = usePanelOutput("detailHeader", "hasEvidence");
    const gapsCount = usePanelOutput("evidenceGaps", "loadedCount");
    const gapsStatus = usePanelOutput("evidenceGaps", "status");
    const showGaps = computed(
      () => !isCollecting.value && ((typeof gapsCount.value === "number" && gapsCount.value > 0) || gapsStatus.value === "error"),
    );

    const buildOp = usePanelOperation("turns", "build", {
      onSettled(receipt, ctx) {
        if (!receipt || receipt.decision !== "confirm" || !receipt.response) return;
        if (receipt.response.kind !== "dispatched") {
          searchError.value = receipt.response.message;
          return;
        }
        const outcome = receipt.response.outcome;
        if (outcome?.kind === "success") {
          if (outcome.message) notify({ kind: "success", text: outcome.message });
          const createdRef = outcome.created
            ? { className: outcome.created.objectType, primaryKey: outcome.created.primaryKey }
            : typeof ctx.input?.turnKey === "string" && ctx.input.turnKey
              ? { className: "platform:TurnEvidence", primaryKey: ctx.input.turnKey }
              : null;
          instance.state.setState(createdRef ? { selected: createdRef, search: null } : { search: null });
          return;
        }
        if (outcome && outcome.kind !== "batch" && outcome.message) {
          searchError.value = outcome.message;
        }
      },
      onError(error) {
        searchError.value = error.message;
      },
    });

    function onSearchInput(event) {
      searchError.value = null;
      const next = event?.target?.value ?? "";
      instance.state.set("search", next === "" ? null : next);
    }

    async function submitSearch() {
      const trimmed = searchText.value.trim();
      if (!trimmed || buildOp.running.value) return;
      searchError.value = null;
      const loaded = Array.isArray(listedTurns.value) ? listedTurns.value : [];
      const loadedMatch = loaded.find((item) => item?.primaryKey === trimmed);
      if (loadedMatch) {
        instance.state.setState({ selected: loadedMatch, search: null });
        return;
      }
      await buildOp.run({ turnKey: trimmed });
    }

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
      searchText,
      searchError,
      filePath,
      isCollecting,
      hasEvidence,
      showGaps,
      onSearchInput,
      submitSearch,
      refresh,
      clearSelection,
      onDeleteDone,
      onTurnRowOperationDone,
    };
  },
});
