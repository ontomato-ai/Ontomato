import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
} from "@ontomato/sdk/panel";

/*
 * Built-in autotest case sets panel: list-detail manager for creating, importing (JSON / CSV file or pasted text),
 * editing in form or JSON mode on the single `/cases` field, and deleting `platform:AutotestCaseSet` objects.
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
    const editMode = computed(() => (values.value.editMode === "json" ? "json" : "form"));

    const editModeOptions = computed(() => [
      { value: "form", label: t("detail.modeForm") },
      { value: "json", label: t("detail.modeJson") },
    ]);

    const caseSetDraft = usePanelFormDraft("caseSetForm", {
      when: () => Boolean(selectedKey.value),
    });
    const draftDirty = computed(() => Boolean(caseSetDraft.value?.dirty));
    const draftSaving = computed(() => Boolean(caseSetDraft.value?.saving));
    const draftCanSave = computed(() => {
      const draft = caseSetDraft.value;
      if (!draft || draft.saving) return false;
      return draft.canSave !== undefined ? draft.canSave : Boolean(draft.dirty);
    });

    function saveDraft() {
      if (!draftCanSave.value || draftSaving.value) return;
      caseSetDraft.value?.save();
    }

    function revertDraft() {
      if (!draftDirty.value || draftSaving.value) return;
      caseSetDraft.value?.discard();
    }

    // Re-describe the form when switching between form and JSON mode while preserving unsaved edits.
    watch(
      editMode,
      () => {
        if (!selectedKey.value) return;
        const handle = instance.forms.handle("caseSetForm");
        if (handle) {
          void handle.refreshDraft();
        }
      },
      { flush: "post" },
    );

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
        event.preventDefault();
        if (!importOpen.value && draftCanSave.value && !draftSaving.value) {
          saveDraft();
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
      editModeOptions,
      caseSetDraft,
      draftDirty,
      draftSaving,
      draftCanSave,
      saveDraft,
      revertDraft,
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
