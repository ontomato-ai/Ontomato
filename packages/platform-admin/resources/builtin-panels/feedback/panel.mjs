import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOperation, usePanelOutput } from "@ontomato/sdk/panel";

function normalizeDraftFilter(value) {
  return typeof value === "string" && value !== "" && value !== "all" ? value : "";
}

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const state = instance.state.values;

    const selected = computed(() => state.value.selected ?? null);
    const detailVisible = computed(() => Boolean(selected.value));

    // Pending toolbar filter controls stay separate from applied panel state until explicit submission (FB-01).
    const draftSourceType = ref(normalizeDraftFilter(state.value.sourceType));
    const draftRating = ref(normalizeDraftFilter(state.value.rating));
    const draftSearch = ref(typeof state.value.search === "string" ? state.value.search : "");

    watch(
      () => [state.value.sourceType, state.value.rating, state.value.search],
      ([nextSource, nextRating, nextSearch]) => {
        draftSourceType.value = normalizeDraftFilter(nextSource);
        draftRating.value = normalizeDraftFilter(nextRating);
        draftSearch.value = typeof nextSearch === "string" ? nextSearch : "";
      },
    );

    const listStatus = usePanelOutput("list", "status");
    const listLoading = computed(() => listStatus.value === "loading" || listStatus.value === "refreshing");

    function applyFilters() {
      const nextSourceType = draftSourceType.value || "all";
      const nextRating = draftRating.value || "all";
      const nextSearch = draftSearch.value.trim();
      const unchanged =
        (state.value.sourceType ?? "all") === nextSourceType
        && (state.value.rating ?? "all") === nextRating
        && (state.value.search ?? "") === nextSearch;

      if (unchanged) {
        instance.refreshObjects();
        return;
      }
      instance.state.setState({
        sourceType: nextSourceType,
        rating: nextRating,
        search: nextSearch,
      });
    }

    function onRowAction({ id, ref: rowRef }) {
      if (id === "detail" && rowRef) {
        instance.state.set("selected", rowRef);
      }
    }

    function onDetailToggle(open) {
      if (!open && selected.value) {
        instance.state.set("selected", null);
      }
    }

    const exportError = ref("");
    const exportCsv = usePanelOperation("exportCsv", "export", {
      prepareInput(provided) {
        const { search, sourceType, rating } = state.value;
        const input = {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...provided,
        };
        if (input.search === undefined && typeof search === "string" && search.trim() !== "") input.search = search;
        if (input.sourceType === undefined && typeof sourceType === "string" && sourceType !== "") input.sourceType = sourceType;
        if (input.rating === undefined && typeof rating === "string" && rating !== "") input.rating = rating;
        return input;
      },
      onSettled(receipt) {
        exportError.value = "";
        if (receipt && receipt.kind === "json") {
          notify({
            kind: "warning",
            text: typeof receipt.message === "string" && receipt.message ? receipt.message : t("panel.exportEmpty"),
          });
          return;
        }
        notify({ kind: "success", text: t("panel.exportDone") });
      },
      onError(error) {
        exportError.value = error instanceof Error && error.message ? error.message : String(error);
      },
    });
    const exporting = exportCsv.running;
    const runExport = async () => {
      exportError.value = "";
      await exportCsv.run({});
    };

    return {
      t,
      selected,
      detailVisible,
      draftSourceType,
      draftRating,
      draftSearch,
      listLoading,
      exporting,
      exportError,
      applyFilters,
      onRowAction,
      onDetailToggle,
      runExport,
      refresh: () => instance.refreshObjects(),
    };
  },
});
