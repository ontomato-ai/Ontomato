import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelOperation,
} from "@ontomato/sdk/panel";

/*
 * Built-in autotest case sets panel: list-detail manager for creating, importing (JSON / CSV file or pasted text),
 * editing in the three-pane TestcaseWorkbench (with live JSON sync, persisted drafts, and save-discard-cancel switch
 * guard), and deleting `platform:AutotestCaseSet` objects.
 */

const CASE_SET_TYPE = "platform:AutotestCaseSet";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const values = instance.state.values;
    const panelRootRef = ref(null);
    const caseSetListRef = ref(null);

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    // ---- Import dialog state ----
    const importOpen = ref(false);
    const importName = ref("");
    const importFormat = ref("auto");
    const importContent = ref("");
    const importFileName = ref("");
    const importError = ref("");
    const importFileInput = ref(null);

    const importOp = usePanelOperation("importCaseSet", "import", {
      onSettled(receipt) {
        if (!receipt || !("response" in receipt)) return;
        const response = receipt.response;
        if (response.kind === "not-dispatched") {
          importError.value = response.message || t("import.failed");
          return;
        }
        const outcome = response.outcome;
        if (!outcome) {
          importError.value = t("import.failed");
          return;
        }
        if (outcome.kind === "success") {
          importOpen.value = false;
          importError.value = "";
          const created = outcome.created;
          const primaryKey = created?.primaryKey
            || (typeof outcome.data?.id === "string" ? outcome.data.id : "");
          if (primaryKey) {
            instance.state.setState({
              selected: { className: created?.objectType || CASE_SET_TYPE, primaryKey },
            });
          }
          instance.refreshObjects();
          if (outcome.message) {
            notify({ kind: "success", text: outcome.message });
          }
          return;
        }
        importError.value = outcome.message || t("import.failed");
      },
      onError(error) {
        importError.value = error instanceof Error ? error.message : t("import.failed");
      },
    });

    const importBusy = computed(() => importOp.running.value);
    const importEditorLanguage = computed(() => (importFormat.value === "csv" ? "text" : "json"));
    const canSubmitImport = computed(
      () => !importBusy.value && importName.value.trim().length > 0 && importContent.value.trim().length > 0,
    );

    function openImport() {
      importName.value = "";
      importFormat.value = "auto";
      importContent.value = "";
      importFileName.value = "";
      importError.value = "";
      importOpen.value = true;
    }

    function closeImport() {
      if (importBusy.value) return;
      importOpen.value = false;
    }

    function triggerImportFilePicker() {
      const input = importFileInput.value;
      if (!input) return;
      input.value = "";
      input.click();
    }

    function clearImportFile() {
      importFileName.value = "";
      const input = importFileInput.value;
      if (input) input.value = "";
    }

    async function onImportFileChange(event) {
      const target = event?.target;
      const file = target?.files?.[0];
      if (!file) return;
      importError.value = "";
      try {
        const text = await file.text();
        importFileName.value = file.name;
        importContent.value = text;
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".csv")) {
          importFormat.value = "csv";
        } else if (lower.endsWith(".json")) {
          importFormat.value = "json";
        }
        if (!importName.value.trim()) {
          importName.value = file.name.replace(/\.(json|csv)$/i, "");
        }
      } catch {
        importError.value = t("import.readError");
      }
    }

    async function submitImport() {
      if (!canSubmitImport.value) return;
      importError.value = "";
      await importOp.run({
        name: importName.value.trim(),
        format: importFormat.value,
        content: importContent.value,
      });
    }

    function refresh() {
      instance.refreshObjects();
    }

    function clearSelection() {
      instance.state.setState({ selected: null });
    }

    function onCreateDone(outcome) {
      if (outcome?.kind !== "success") return;
      const created = outcome.created;
      const primaryKey = created?.primaryKey
        || (typeof outcome.data?.id === "string" ? outcome.data.id : "");
      if (!primaryKey) return;
      instance.state.setState({
        selected: { className: created?.objectType || CASE_SET_TYPE, primaryKey },
      });
    }

    function onCaseSetSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("detail.saved") });
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      const handle = instance.forms.handle("caseSetForm");
      if (handle?.dirty?.value) {
        void handle.reset({ confirm: false });
      }
      instance.state.setState({ selected: null });
      instance.refreshObjects();
      notify({ kind: "success", text: t("detail.deleted") });
    }

    function focusCaseSetSelector() {
      const container = caseSetListRef.value;
      if (!container) return;
      const target = container.querySelector(
        'input[type="search"], .sdk-object-list-search, input, [role="listbox"], button, [tabindex]',
      );
      if (target instanceof HTMLElement) {
        target.focus();
        if (target instanceof HTMLInputElement) {
          target.select();
        }
      }
    }

    // Keyboard shortcuts matching the original page: Ctrl/Cmd+S saves, Ctrl/Cmd+P focuses the case set selector.
    function onKeyDown(event) {
      if (!panelRootRef.value?.isConnected) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key === "s") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (importOpen.value || !selectedKey.value) return;
        const handle = instance.forms.handle("caseSetForm");
        if (handle?.canSubmit?.value && !handle.submitting?.value) {
          void handle.submit().catch(() => {});
        }
      } else if (key === "p") {
        event.preventDefault();
        focusCaseSetSelector();
      }
    }

    onMounted(() => {
      if (typeof window !== "undefined") {
        window.addEventListener("keydown", onKeyDown);
      }
    });

    onBeforeUnmount(() => {
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", onKeyDown);
      }
    });

    return {
      t,
      panelRootRef,
      caseSetListRef,
      selectedKey,
      importOpen,
      importName,
      importFormat,
      importContent,
      importFileName,
      importError,
      importFileInput,
      importBusy,
      importEditorLanguage,
      canSubmitImport,
      openImport,
      closeImport,
      triggerImportFilePicker,
      clearImportFile,
      onImportFileChange,
      submitImport,
      refresh,
      clearSelection,
      onCreateDone,
      onCaseSetSaved,
      onDeleteDone,
    };
  },
});
