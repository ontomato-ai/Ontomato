import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOperation } from "@ontomato/sdk/panel";

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

    const importOp = usePanelOperation("import", "import", { entry: false });

    function onImported(response) {
      const outcome = response?.kind === "dispatched" ? response.outcome : null;
      if (outcome?.kind !== "success") return;
      setImporting(false);
      if (outcome.message) notify({ kind: "success", text: outcome.message });
    }

    async function onImportRefused(response, meta) {
      const outcome = response?.kind === "dispatched" ? response.outcome : null;
      const uploadId = meta?.file?.uploadId;
      if (outcome?.kind !== "refusal" || outcome.code !== "SKILL_EXISTS" || !uploadId) return;
      const answer = await importOp.run({
        file: { kind: "upload", uploadId },
        overwrite: true,
      });
      if (answer?.decision !== "confirm" || !answer.response) return;
      if (answer.response.kind !== "dispatched") {
        if (answer.response.message) notify({ kind: "error", text: answer.response.message });
        return;
      }
      const retryOutcome = answer.response.outcome;
      if (retryOutcome?.kind === "success") {
        setImporting(false);
        if (retryOutcome.message) notify({ kind: "success", text: retryOutcome.message });
      } else if (retryOutcome && retryOutcome.kind !== "batch" && retryOutcome.message) {
        notify({ kind: "error", text: retryOutcome.message });
      }
    }

    return {
      t,
      importing,
      importDialog,
      open,
      openImport,
      closeImport,
      onImported,
      onImportRefused,
    };
  },
});
