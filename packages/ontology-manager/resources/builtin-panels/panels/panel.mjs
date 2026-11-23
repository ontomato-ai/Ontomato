import { computed, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const PANEL_TYPE = "platform:ProductPanel";
const PROJECTION_TYPE = "platform:ProductProjection";
const APPLICATION_TYPE = "platform:Application";
const OBJECT_TYPE = "platform:ObjectType";

const PanelsDirectory = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const creating = computed(() => values.value.creating === true);
    const detailMode = computed(() => (values.value.detailMode === "edit" ? "edit" : "view"));
    const isFormMode = computed(() => creating.value || (Boolean(selectedKey.value) && detailMode.value === "edit"));
    const showDetail = computed(() => Boolean(selectedKey.value) || creating.value);

    const scopeModel = computed({
      get: () => (typeof values.value.scope === "string" && values.value.scope ? values.value.scope : "all"),
      set: (next) => state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => (typeof values.value.sort === "string" && values.value.sort ? values.value.sort : "updated"),
      set: (next) => state.set("sort", next || "updated"),
    });
    const templateFilterModel = computed({
      get: () => {
        if (values.value.templateFilter === true) return "template";
        if (values.value.templateFilter === false) return "ordinary";
        return "all";
      },
      set: (next) => {
        if (next === "template") state.set("templateFilter", true);
        else if (next === "ordinary") state.set("templateFilter", false);
        else state.set("templateFilter", null);
      },
    });

    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    const tabModel = computed({
      get: () => (typeof values.value.tab === "string" && values.value.tab ? values.value.tab : "overview"),
      set: (next) => state.set("tab", next || "overview"),
    });

    // Read-only projection outputs published by the selected panel header.
    const recordStatus = usePanelOutput("headerTitle", "status");
    const recordLabelOutput = usePanelOutput("headerTitle", "label");
    const recordErrorOutput = usePanelOutput("headerTitle", "errorMessage");
    const canEditOutput = usePanelOutput("headerTitle", "canEdit");
    const canGrantOutput = usePanelOutput("headerTitle", "canGrant");
    const canDeleteOutput = usePanelOutput("headerTitle", "canDelete");
    const isTemplateOutput = usePanelOutput("headerTitle", "isTemplate");
    const domainSharedOutput = usePanelOutput("headerTitle", "domainShared");
    const revisionOutput = usePanelOutput("headerTitle", "revision");
    const hiddenUsedByCountOutput = usePanelOutput("headerTitle", "hiddenUsedByCount");

    const recordReady = computed(() => recordStatus.value === "ready");
    const recordLabel = computed(() => (typeof recordLabelOutput.value === "string" && recordLabelOutput.value ? recordLabelOutput.value : selectedKey.value));
    const canEdit = computed(() => canEditOutput.value === true);
    const canGrant = computed(() => canGrantOutput.value === true);
    const canDelete = computed(() => canDeleteOutput.value === true);
    const isTemplate = computed(() => isTemplateOutput.value === true);
    const domainShared = computed(() => domainSharedOutput.value === true);
    const hiddenUsedByCount = computed(() => (typeof hiddenUsedByCountOutput.value === "number" ? hiddenUsedByCountOutput.value : 0));

    const recordErrorText = computed(() => {
      const message = typeof recordErrorOutput.value === "string" ? recordErrorOutput.value : "";
      return message || t("detail.missing");
    });

    // Keep selectedRevision synced for bound OperationButton deletion checks.
    watch(
      () => (recordReady.value && typeof revisionOutput.value === "number" ? revisionOutput.value : null),
      (revision) => {
        if ((values.value.selectedRevision ?? null) !== revision) {
          state.set("selectedRevision", revision);
        }
      },
      { immediate: true },
    );

    // Leave the Grants tab when switching to a panel the reader cannot grant.
    watch([recordReady, canGrant, tabModel], ([ready, grantable, activeTab]) => {
      if (ready && !grantable && activeTab === "grants") {
        state.set("tab", "overview");
      }
    });

    // Reset per-panel view state when switching selection.
    watch(selectedKey, (nextKey, prevKey) => {
      if (nextKey === prevKey) return;
      if (creating.value && !nextKey) return;
      state.setState({
        creating: null,
        detailMode: "view",
        sourceFile: null,
        copyDialog: null,
        grantDialog: null,
      });
    });

    // Copy / Save as template / Create from template dialog state.
    const copyMode = computed(() => {
      const raw = values.value.copyMode;
      return raw === "saveAsTemplate" || raw === "fromTemplate" ? raw : "copy";
    });
    const copyDialogOpen = computed({
      get: () => values.value.copyDialog === true,
      set: (open) => {
        if (!open) {
          state.setState({ copyDialog: null, copyId: null, copyName: null, copyTemplate: null });
        } else {
          state.set("copyDialog", true);
        }
      },
    });
    const copyIdModel = computed({
      get: () => (typeof values.value.copyId === "string" ? values.value.copyId : ""),
      set: (next) => state.set("copyId", next),
    });
    const copyNameModel = computed({
      get: () => (typeof values.value.copyName === "string" ? values.value.copyName : ""),
      set: (next) => state.set("copyName", next),
    });
    const canSubmitCopy = computed(() => Boolean(copyIdModel.value.trim()) && Boolean(copyNameModel.value.trim()));
    const copyDialogTitle = computed(() => (
      copyMode.value === "saveAsTemplate"
        ? t("copy.saveAsTemplateTitle")
        : copyMode.value === "fromTemplate"
          ? t("copy.fromTemplateTitle")
          : t("copy.title")
    ));
    const copyDialogNote = computed(() => (
      copyMode.value === "saveAsTemplate"
        ? t("copy.templateNote")
        : copyMode.value === "fromTemplate"
          ? t("copy.fromTemplateNote")
          : t("copy.note")
    ));
    const copyActionLabelKey = computed(() => (
      copyMode.value === "saveAsTemplate"
        ? "action.saveAsTemplate"
        : copyMode.value === "fromTemplate"
          ? "action.fromTemplate"
          : "action.copy"
    ));

    function openCopyDialog(mode) {
      const baseId = selectedKey.value;
      const baseName = recordLabel.value;
      const suggestedId = mode === "fromTemplate" ? `${baseId}-new` : `${baseId}-copy`;
      const suggestedName = mode === "saveAsTemplate"
        ? t("copy.defaultTemplateName", { name: baseName })
        : mode === "fromTemplate"
          ? t("copy.defaultDerivedName", { name: baseName })
          : t("copy.defaultName", { name: baseName });
      const templateValue = mode === "saveAsTemplate" ? true : mode === "fromTemplate" ? false : null;
      state.setState({
        copyMode: mode,
        copyId: suggestedId,
        copyName: suggestedName,
        copyTemplate: templateValue,
        copyDialog: true,
      });
    }

    function onCopyDone(outcome) {
      if (outcome?.kind !== "success") return;
      const createdId = typeof outcome.data?.id === "string" && outcome.data.id
        ? outcome.data.id
        : copyIdModel.value.trim();
      state.setState({
        copyDialog: null,
        copyId: null,
        copyName: null,
        copyTemplate: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        ...(createdId ? { selected: { className: PANEL_TYPE, primaryKey: createdId } } : {}),
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.copied", { id: createdId }) });
    }

    // Grant dialog state (matches application-detail pattern).
    const grantDialogOpen = computed({
      get: () => values.value.grantDialog === true,
      set: (open) => state.set("grantDialog", open ? true : null),
    });
    const grantPrincipalKindModel = computed({
      get: () => (values.value.grantPrincipalKind === "role" ? "role" : "principal"),
      set: (next) => {
        state.setState({
          grantPrincipalKind: next === "role" ? "role" : "principal",
          grantUser: null,
          grantRole: null,
          grantPrincipalId: null,
        });
      },
    });
    const grantVerbModel = computed({
      get: () => (values.value.grantVerb === "edit" ? "edit" : "use"),
      set: (next) => state.set("grantVerb", next === "edit" ? "edit" : "use"),
    });
    const grantPrincipalId = computed(() => (typeof values.value.grantPrincipalId === "string" ? values.value.grantPrincipalId : ""));
    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);

    watch(
      () => ({
        kind: grantPrincipalKindModel.value,
        userId: values.value.grantUser?.primaryKey ?? null,
        roleId: values.value.grantRole?.primaryKey ?? null,
      }),
      ({ kind, userId, roleId }) => {
        const nextId = kind === "role" ? roleId : userId;
        if ((values.value.grantPrincipalId ?? null) !== nextId) {
          state.set("grantPrincipalId", nextId);
        }
      },
      { immediate: true },
    );

    function openGrantDialog() {
      state.setState({
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
      state.setState({
        grantDialog: null,
        grantUser: null,
        grantRole: null,
        grantPrincipalId: null,
      });
      instance.refreshObjects();
    }

    function onShareDone(outcome) {
      if (outcome?.kind !== "success") return;
      const skipped = Array.isArray(outcome.data?.skippedProjectionIds) ? outcome.data.skippedProjectionIds : [];
      if (skipped.length) {
        notify({ kind: "warning", text: t("grants.skipped", { ids: skipped.join(", ") }) });
      } else {
        notify({ kind: "success", text: t("grants.updated") });
      }
      instance.refreshObjects();
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      const deleted = Array.isArray(outcome.data?.deletedProjectionIds) ? outcome.data.deletedProjectionIds : [];
      const retained = Array.isArray(outcome.data?.retainedProjectionIdsWithoutEdit) ? outcome.data.retainedProjectionIdsWithoutEdit : [];
      let text = t("notify.deleted");
      if (deleted.length) text = t("notify.deletedWithProjections", { deleted: deleted.join(", ") });
      else if (retained.length) text = t("notify.deletedWithRetained", { retained: retained.join(", ") });
      notify({ kind: "success", text });
      state.setState({
        selected: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        selectedRevision: null,
      });
      instance.refreshObjects();
    }

    function startCreate() {
      state.setState({
        selected: null,
        creating: true,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
      });
    }

    function startEdit() {
      if (!selectedKey.value) return;
      state.setState({ creating: null, detailMode: "edit" });
    }

    function cancelForm() {
      state.setState({ creating: null, detailMode: "view" });
    }

    function closeDetail() {
      state.setState({
        selected: null,
        creating: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
      });
    }

    function onSaved(saved) {
      const reference = saved?.primaryKey
        ? { className: saved.className || PANEL_TYPE, primaryKey: saved.primaryKey }
        : selected.value;
      state.setState({
        creating: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        ...(reference ? { selected: reference } : {}),
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    // Wire Escape / browser Back while editing or creating so unsaved changes pass through the host guard.
    usePanelBack({
      active: isFormMode,
      onBack: cancelForm,
    });

    async function openAddress(address) {
      if (!address) return;
      try {
        await navigate(address);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function onNavigateReference(reference) {
      if (!reference?.primaryKey) return;
      if (reference.className === PANEL_TYPE) {
        state.setState({
          selected: { className: PANEL_TYPE, primaryKey: reference.primaryKey },
          creating: null,
          detailMode: "view",
          tab: "overview",
          sourceFile: null,
        });
      } else if (reference.className === PROJECTION_TYPE) {
        void openAddress(panelAddress("/ontology/projections", { selected: reference.primaryKey }));
      } else if (reference.className === APPLICATION_TYPE) {
        void openAddress(panelAddress("/ontology/applications/detail", { selected: reference.primaryKey }));
      } else if (reference.className === OBJECT_TYPE) {
        void openAddress(panelAddress("/ontology/objects", { selected: reference.primaryKey }));
      }
    }

    function onUsedByRowAction({ id, ref }) {
      if (id === "openEntry" && ref?.primaryKey) {
        void openAddress(ref.primaryKey);
      }
    }

    return {
      t,
      selectedKey,
      creating,
      isFormMode,
      showDetail,
      scopeModel,
      scopeOptions,
      sortModel,
      templateFilterModel,
      tabModel,
      recordStatus,
      recordReady,
      recordErrorText,
      canEdit,
      canGrant,
      canDelete,
      isTemplate,
      domainShared,
      hiddenUsedByCount,
      copyDialogOpen,
      copyIdModel,
      copyNameModel,
      canSubmitCopy,
      copyDialogTitle,
      copyDialogNote,
      copyActionLabelKey,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      grantKindOptions,
      openCopyDialog,
      onCopyDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
      onDeleteDone,
      startCreate,
      startEdit,
      cancelForm,
      closeDetail,
      onSaved,
      openAddress,
      onNavigateReference,
      onUsedByRowAction,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(PanelsDirectory);
