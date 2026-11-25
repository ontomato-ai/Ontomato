import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in skills library catalog panel: full-width responsive card grid backed by `ObjectList` (`query` read with
 * server search, owner diagnostics, and per-card export/delete row operations), plus a centered ZIP import dialog
 * hosting `FileUploadControl` (`skills.import`). Clicking a card navigates to the non-menu full-width detail entry.
 */

const DETAIL_PATH = "/ontology/skills/detail";

await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const importing = computed(() => instance.state.values.value.importing === true);
    const setImporting = (value) => instance.state.set("importing", value ? true : null);

    const importDialog = computed({
      get: () => importing.value,
      set: (value) => {
        if (!value && importing.value) setImporting(false);
      },
    });

    function open(ref) {
      if (!ref?.primaryKey) return;
      if (importing.value) setImporting(false);
      void navigate(panelAddress(DETAIL_PATH, { selected: ref.primaryKey })).catch(() => undefined);
    }

    function openImport() {
      setImporting(true);
    }

    function closeImport() {
      setImporting(false);
    }

    function onImported(response) {
      const outcome = response?.kind === "dispatched" ? response.outcome : null;
      if (outcome?.kind !== "success") return;
      setImporting(false);
      if (outcome.message) notify({ kind: "success", text: outcome.message });
    }

    return {
      t,
      importing,
      importDialog,
      open,
      openImport,
      closeImport,
      onImported,
    };
  },
});
