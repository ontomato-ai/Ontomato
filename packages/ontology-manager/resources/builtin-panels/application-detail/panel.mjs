import { computed, nextTick, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const APPLICATION = "platform:Application";
const PANEL = "platform:ProductPanel";
const PROJECTION = "platform:ProductProjection";
const CATALOG_PATH = "/ontology/applications";

const ApplicationDetailPanel = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    // All business view states live in manifest.state so both URLs and agents can read/write them.
    const tabModel = computed({
      get: () => values.value.tab || "identity",
      set: (next) => instance.state.set("tab", next || "identity"),
    });
    const entriesViewModel = computed({
      get: () => (values.value.entriesView === "bulk" ? "bulk" : "list"),
      set: (next) => instance.state.set("entriesView", next === "bulk" ? "bulk" : "list"),
    });
    const entriesBulkMode = computed(() => entriesViewModel.value === "bulk");
    const editingEntryId = computed({
      get: () => values.value.editingEntryId ?? "",
      set: (next) => instance.state.set("editingEntryId", next ? next : null),
    });
    const entryDialogOpen = computed({
      get: () => Boolean(editingEntryId.value),
      set: (open) => {
        if (!open) editingEntryId.value = "";
      },
    });
    const copyDialogOpen = computed({
      get: () => values.value.copyDialog === true,
      set: (open) => instance.state.set("copyDialog", open ? true : false),
    });
    const copyNameSeededFor = ref("");
    watch(
      [copyDialogOpen, selectedKey, () => instance.forms.handle("copyForm")?.values.value?.declaration?.names],
      ([open, key, names]) => {
        if (!open || !key) {
          copyNameSeededFor.value = "";
          return;
        }
        if (copyNameSeededFor.value === key || !names || typeof names !== "object") return;
        const handle = instance.forms.handle("copyForm");
        if (!handle) return;
        const entries = Object.entries(names).filter(([, v]) => typeof v === "string" && v.trim());
        if (!entries.length) return;
        copyNameSeededFor.value = key;
        const nextNames = Object.fromEntries(
          entries.map(([lang, text]) => [lang, t("copy.suffix", { name: text.trim() })]),
        );
        handle.set("/declaration/names", nextNames);
      },
      { deep: true },
    );
    // Read-only projection outputs only (no raw record reads or fields bag).
    const recordStatus = usePanelOutput("headerTitle", "status");
    const recordError = usePanelOutput("headerTitle", "errorMessage");
    const canMaintainOutput = usePanelOutput("headerTitle", "canMaintain");
    const canEditEntriesOutput = usePanelOutput("headerTitle", "canEditEntries");
    const openPathOutput = usePanelOutput("headerTitle", "openPath");

    const entryTotalOutput = usePanelOutput("entriesList", "total");
    const usedPanelsTotalOutput = usePanelOutput("usedPanelsList", "total");
    const usedPanelsSelectedLabel = usePanelOutput("usedPanelsList", "selectedLabel");

    const recordReady = computed(() => recordStatus.value === "ready");
    const canMaintain = computed(() => canMaintainOutput.value === true);
    const canEditEntries = computed(() => canEditEntriesOutput.value === true);
    const openPath = computed(() => (typeof openPathOutput.value === "string" ? openPathOutput.value : ""));

    const entryTotal = computed(() => (typeof entryTotalOutput.value === "number" ? entryTotalOutput.value : null));
    const usedPanelsTotal = computed(() => (typeof usedPanelsTotalOutput.value === "number" ? usedPanelsTotalOutput.value : null));

    const recordErrorText = computed(() => {
      const message = typeof recordError.value === "string" ? recordError.value : "";
      if (message && message !== "Application not found") return message;
      return t("detail.notFound");
    });

    const identityDraft = usePanelFormDraft("save", {
      when: () => Boolean(selectedKey.value) && recordReady.value && canMaintain.value && tabModel.value === "identity",
    });

    const inspectedPanelId = computed(() => values.value.inspectedPanel?.primaryKey ?? "");
    const inspectedPanelTitle = computed(() => {
      const active = typeof usedPanelsSelectedLabel.value === "string" ? usedPanelsSelectedLabel.value : "";
      return active || inspectedPanelId.value;
    });

    // Reset sub-views belonging to the previous application when switching `selected`, while preserving any
    // sub-view fields explicitly provided in the same atomic state update (e.g. host address restoration or
    // agent `setState({ selected, inspectedPanel })`, even when both applications reference the same panel ID).
    watch(
      selectedKey,
      (next, prev) => {
        if (!prev || next === prev) return;
        const patched = instance.state.lastPatchedKeys;
        const defaults = {
          entriesView: "list",
          editingEntryId: null,
          inspectedPanel: null,
        };
        const resetPatch = {};
        for (const [field, fallback] of Object.entries(defaults)) {
          if (!patched?.has(field) && values.value[field] !== fallback) {
            resetPatch[field] = fallback;
          }
        }
        if (Object.keys(resetPatch).length > 0) {
          instance.state.setState(resetPatch);
        }
      },
      { flush: "sync" },
    );

    // Mount each tab lazily on first visit for the current application, then keep visited tabs mounted
    // via v-show so unsaved edits and pending list confirmations survive tab switches.
    const mountedTabs = ref(new Set());
    watch(
      selectedKey,
      (next, prev) => {
        if (next !== prev) mountedTabs.value = new Set();
      },
      { flush: "sync" },
    );
    watch(
      [recordReady, tabModel],
      ([ready, tab]) => {
        if (!ready) return;
        if (!mountedTabs.value.has(tab)) {
          const next = new Set(mountedTabs.value);
          next.add(tab);
          mountedTabs.value = next;
        }
      },
      { immediate: true, flush: "sync" },
    );
    function isTabMounted(name) {
      return mountedTabs.value.has(name);
    }

    // Route back to the catalog entry so the platform's unified unsaved-changes guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    function retryRecord() {
      instance.refreshObjects();
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function onEntriesFormSaved() {
      entriesViewModel.value = "list";
      instance.refreshObjects();
      notify({ kind: "success", text: t("entries.saved") });
    }

    function onEntryFormSaved() {
      editingEntryId.value = "";
      instance.refreshObjects();
      notify({ kind: "success", text: t("entries.saved") });
    }

    function closeEntryDialog() {
      editingEntryId.value = "";
    }

    function openAddEntry() {
      instance.state.setState({ entriesView: "list", editingEntryId: "__new__" });
    }

    function toggleEntriesView() {
      entriesViewModel.value = entriesBulkMode.value ? "list" : "bulk";
    }

    function onEntryRowAction({ id, ref }) {
      if (id === "edit" && ref?.primaryKey) {
        instance.state.setState({ entriesView: "list", editingEntryId: ref.primaryKey });
      }
    }

    async function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("notify.deleted") });
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function openApplication() {
      if (!openPath.value) return;
      try {
        await navigate(openPath.value);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    async function openCatalogueRecord(path, primaryKey) {
      try {
        await navigate(panelAddress(path, { selected: primaryKey }));
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function openCopyDialog() {
      if (!selectedKey.value || !recordReady.value) return;
      copyNameSeededFor.value = "";
      instance.state.set("copyDialog", true);
    }

    function closeCopyDialog() {
      copyNameSeededFor.value = "";
      instance.state.set("copyDialog", false);
    }

    function onCopied(saved) {
      copyNameSeededFor.value = "";
      instance.state.setState({
        copyDialog: false,
        ...(saved?.primaryKey ? { selected: { className: APPLICATION, primaryKey: saved.primaryKey } } : {}),
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.copied") });
    }

    function onUsedPanelRowAction({ id, ref: rowRef }) {
      if (id === "openPanel" && rowRef?.primaryKey) {
        openPanelCatalogue(rowRef.primaryKey);
      }
    }

    function openPanelCatalogue(panelId) {
      if (!panelId) return;
      void openCatalogueRecord("/ontology/panels/detail", panelId);
    }

    function onNavigateReference(reference) {
      if (!reference?.primaryKey) return;
      if (reference.className === PANEL) {
        openPanelCatalogue(reference.primaryKey);
      } else if (reference.className === PROJECTION) {
        void openCatalogueRecord("/ontology/projections/detail", reference.primaryKey);
      } else if (reference.className === APPLICATION) {
        void openCatalogueRecord("/ontology/applications/detail", reference.primaryKey);
      }
    }

    function onOpenAssetGraph(target) {
      if (!target?.primaryKey) return;
      if (target.className === APPLICATION && target.primaryKey === selectedKey.value) return;
      onNavigateReference(target);
    }

    return {
      t,
      selectedKey,
      tabModel,
      isTabMounted,
      entriesBulkMode,
      editingEntryId,
      entryDialogOpen,
      copyDialogOpen,
      recordStatus,
      recordReady,
      recordErrorText,
      canMaintain,
      canEditEntries,
      openPath,
      entryTotal,
      usedPanelsTotal,
      inspectedPanelId,
      inspectedPanelTitle,
      identityDraft,
      goBack,
      retryRecord,
      onSaved,
      onEntriesFormSaved,
      onEntryFormSaved,
      closeEntryDialog,
      openAddEntry,
      toggleEntriesView,
      onEntryRowAction,
      onDeleteDone,
      openApplication,
      openCopyDialog,
      closeCopyDialog,
      onCopied,
      onUsedPanelRowAction,
      openPanelCatalogue,
      onNavigateReference,
      onOpenAssetGraph,
    };
  },
};

await mountPanel(ApplicationDetailPanel);
