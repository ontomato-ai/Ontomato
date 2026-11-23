import { computed, nextTick, watch } from "vue";
import {
  draftTarget,
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
    const grantDialogOpen = computed({
      get: () => values.value.grantDialog === true,
      set: (open) => instance.state.set("grantDialog", open ? true : null),
    });
    const grantPrincipalKindModel = computed({
      get: () => (values.value.grantPrincipalKind === "role" ? "role" : "principal"),
      set: (next) => {
        instance.state.setState({
          grantPrincipalKind: next === "role" ? "role" : "principal",
          grantUser: null,
          grantRole: null,
          grantPrincipalId: null,
        });
      },
    });
    const grantVerbModel = computed({
      get: () => (values.value.grantVerb === "edit" ? "edit" : "use"),
      set: (next) => instance.state.set("grantVerb", next === "edit" ? "edit" : "use"),
    });
    const grantPrincipalId = computed(() => values.value.grantPrincipalId ?? "");

    // Read-only projection outputs only (zero usePanelData calls, zero outputFields/fields bag).
    const recordStatus = usePanelOutput("headerTitle", "status");
    const recordError = usePanelOutput("headerTitle", "errorMessage");
    const canMaintainOutput = usePanelOutput("headerTitle", "canMaintain");
    const canEditEntriesOutput = usePanelOutput("headerTitle", "canEditEntries");
    const canGrantOutput = usePanelOutput("headerTitle", "canGrant");
    const openPathOutput = usePanelOutput("headerTitle", "openPath");
    const domainSharedOutput = usePanelOutput("headerTitle", "domainShared");

    const entryTotalOutput = usePanelOutput("entriesList", "total");
    const usedPanelsTotalOutput = usePanelOutput("usedPanelsList", "total");
    const usedPanelsSelectedLabel = usePanelOutput("usedPanelsList", "selectedLabel");

    const recordReady = computed(() => recordStatus.value === "ready");
    const canMaintain = computed(() => canMaintainOutput.value === true);
    const canEditEntries = computed(() => canEditEntriesOutput.value === true);
    const canGrant = computed(() => canGrantOutput.value === true);
    const openPath = computed(() => (typeof openPathOutput.value === "string" ? openPathOutput.value : ""));
    const domainShared = computed(() => domainSharedOutput.value === true);

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

    // Keep grantPrincipalId synced from the selected ReferencePicker object.
    watch(
      () => ({
        kind: grantPrincipalKindModel.value,
        userKey: values.value.grantUser?.primaryKey ?? "",
        roleKey: values.value.grantRole?.primaryKey ?? "",
      }),
      ({ kind, userKey, roleKey }) => {
        const nextId = kind === "role" ? roleKey : userKey;
        if ((values.value.grantPrincipalId ?? "") !== nextId) {
          instance.state.set("grantPrincipalId", nextId || null);
        }
      },
      { immediate: true },
    );

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
          grantDialog: null,
          grantUser: null,
          grantRole: null,
          grantPrincipalId: null,
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

    // Fall back from grants tab if the current reader cannot grant on this application.
    watch(
      [recordReady, canGrant],
      ([ready, allowed]) => {
        if (ready && !allowed && tabModel.value === "grants") {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

    // Route incoming assistant drafts cleanly to the matching form/tab, or redirect create drafts to the catalogue.
    watch(
      instance.draft,
      (draft) => {
        if (!draft) return;
        const target = draftTarget(draft);
        if (target.kind === "create") {
          void navigate(CATALOG_PATH).catch(() => undefined);
          return;
        }
        if (target.id && target.id !== selectedKey.value) {
          instance.state.set("selected", { className: APPLICATION, primaryKey: target.id });
        }
        if (draft.slot === "entriesForm") {
          instance.state.setState({ tab: "entries", entriesView: "bulk" });
        } else if (draft.slot === "entryForm") {
          const draftEntryId = draft.form?.id;
          instance.state.setState({
            tab: "entries",
            entriesView: "list",
            editingEntryId: typeof draftEntryId === "string" && draftEntryId ? draftEntryId : "__new__",
          });
        } else {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

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

    function onShareDone(outcome) {
      if (outcome?.kind === "success") instance.refreshObjects();
    }

    function openGrantDialog() {
      instance.state.setState({
        grantPrincipalKind: "principal",
        grantUser: null,
        grantRole: null,
        grantPrincipalId: null,
        grantVerb: "use",
        grantDialog: true,
      });
    }

    function onGrantAdded(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({
        grantDialog: null,
        grantUser: null,
        grantRole: null,
        grantPrincipalId: null,
      });
      instance.refreshObjects();
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

    function openPanelCatalogue(panelId) {
      if (!panelId) return;
      void openCatalogueRecord("/ontology/panels", panelId);
    }

    function onNavigateReference(reference) {
      if (!reference?.primaryKey) return;
      if (reference.className === PANEL) {
        openPanelCatalogue(reference.primaryKey);
      } else if (reference.className === PROJECTION) {
        void openCatalogueRecord("/ontology/projections", reference.primaryKey);
      }
    }

    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);

    return {
      t,
      selectedKey,
      tabModel,
      entriesBulkMode,
      editingEntryId,
      entryDialogOpen,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      grantKindOptions,
      recordStatus,
      recordReady,
      recordErrorText,
      canMaintain,
      canEditEntries,
      canGrant,
      openPath,
      domainShared,
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
      onShareDone,
      openGrantDialog,
      onGrantAdded,
      openApplication,
      openPanelCatalogue,
      onNavigateReference,
    };
  },
};

await mountPanel(ApplicationDetailPanel);
