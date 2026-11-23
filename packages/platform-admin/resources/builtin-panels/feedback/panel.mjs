import { computed, ref } from "vue";
import { mountPanel, usePanelContext, usePanelOperation } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const exporting = ref(false);
    const exportError = ref("");
    const exportCsv = usePanelOperation("exportCsv", "export", {
      busy: () => exporting.value,
      prepareInput(provided) {
        const { search, sourceType, rating } = instance.state.values.value;
        const input = {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...provided,
        };
        if (input.search === undefined && typeof search === "string" && search.trim() !== "") input.search = search;
        if (input.sourceType === undefined && typeof sourceType === "string" && sourceType !== "") input.sourceType = sourceType;
        if (input.rating === undefined && typeof rating === "string" && rating !== "") input.rating = rating;
        return input;
      },
      onSettled() {
        exportError.value = "";
        notify({ kind: "success", text: t("panel.exportDone") });
      },
      onError(error) {
        exportError.value = error instanceof Error && error.message ? error.message : String(error);
      },
    });
    const runExport = async () => {
      exporting.value = true;
      exportError.value = "";
      try {
        await exportCsv.run({});
      } finally {
        exporting.value = false;
      }
    };
    return { selected, exporting, exportError, runExport, refresh: () => instance.refreshObjects() };
  },
});
