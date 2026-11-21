import { computed, ref } from "vue";
import { mountPanel, usePanelContext, usePanelOperation } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const exporting = ref(false);
    const exportError = ref("");
    const exportCsv = usePanelOperation("exportCsv", "export");
    const refresh = () => instance.refreshObjects();
    const runExport = async () => {
      exporting.value = true;
      exportError.value = "";
      try {
        const { search, sourceType, rating } = instance.state.values.value;
        const input = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        if (typeof search === "string" && search.trim() !== "") input.search = search;
        if (typeof sourceType === "string" && sourceType !== "") input.sourceType = sourceType;
        if (typeof rating === "string" && rating !== "") input.rating = rating;
        await exportCsv.run(input);
        notify({ kind: "success", text: t("panel.exportDone") });
      } catch (error) {
        exportError.value = error instanceof Error && error.message ? error.message : String(error);
      } finally {
        exporting.value = false;
      }
    };
    return { selected, exporting, exportError, refresh, runExport };
  },
});
