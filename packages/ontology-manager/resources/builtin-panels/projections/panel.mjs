import { computed, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const PROJECTION_TYPE = "platform:ProductProjection";
const PANEL_TYPE = "platform:ProductPanel";
const SDK_COMPONENT_TYPE = "platform:SDKComponent";
const ONTOLOGY_TYPE = "platform:OntologyType";
const OBJECT_TYPE = "platform:ObjectType";
const RELATIONSHIP_TYPE = "platform:Relationship";
const ACTION_TYPE = "platform:Action";
const METRIC_VIEW_TYPE = "platform:MetricView";

const CAPABILITY_MAP = "/ontology/assets/capability-map";
const PANELS_PAGE = "/ontology/panels";
const COMPONENTS_PAGE = "/ontology/components";
const OBJECTS_PAGE = "/ontology/objects";
const RELATIONS_PAGE = "/ontology/relations";
const ACTIONS_PAGE = "/ontology/assets/actions";
const METRICS_PAGE = "/ontology/assets/metrics";

const VALID_TABS = new Set(["overview", "definition", "usage", "grants"]);

const newProjectionId = () => `projection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ProjectionsCataloguePanel = {
  setup() {
    const ctx = usePanelContext();
    const { instance, navigate, notify, t } = ctx;
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const creating = computed(() => values.value.creating === true);
    const detailMode = computed(() => (values.value.detailMode === "edit" ? "edit" : "view"));
    const isFormMode = computed(() => creating.value || (detailMode.value === "edit" && Boolean(selectedKey.value)));
    const showDetail = computed(() => Boolean(selectedKey.value) || isFormMode.value);

    const scopeModel = computed({
      get: () => values.value.scope || "all",
      set: (next) => instance.state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => values.value.sort || "updated",
      set: (next) => instance.state.set("sort", next || "updated"),
    });
    const tabModel = computed({
      get: () => (VALID_TABS.has(values.value.tab) ? values.value.tab : "overview"),
      set: (next) => instance.state.set("tab", VALID_TABS.has(next) ? next : "overview"),
    });

    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    // Read-only projection outputs published by ObjectHeader.
    const headerStatus = usePanelOutput("headerTitle", "status");
    const headerError = usePanelOutput("headerTitle", "errorMessage");
    const headerLabel = usePanelOutput("headerTitle", "label");
    const canEditOutput = usePanelOutput("headerTitle", "canEdit");
    const canGrantOutput = usePanelOutput("headerTitle", "canGrant");
    const canDeleteOutput = usePanelOutput("headerTitle", "canDelete");
    const canCopyOutput = usePanelOutput("headerTitle", "canCopy");
    const isChartOutput = usePanelOutput("headerTitle", "isChart");
    const domainSharedOutput = usePanelOutput("headerTitle", "domainShared");
    const revisionOutput = usePanelOutput("headerTitle", "revision");
    const usedByCountOutput = usePanelOutput("headerTitle", "usedByCount");
    const hiddenUsedByCountOutput = usePanelOutput("headerTitle", "hiddenUsedByCount");

    const recordStatus = computed(() => (typeof headerStatus.value === "string" ? headerStatus.value : ""));
    const recordReady = computed(() => recordStatus.value === "ready");
    const selectedLabel = computed(() => (typeof headerLabel.value === "string" ? headerLabel.value : ""));
    const recordErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value : "";
      return message || t("detail.missing");
    });

    const canEdit = computed(() => canEditOutput.value === true);
    const canGrant = computed(() => canGrantOutput.value === true);
    const canDelete = computed(() => canDeleteOutput.value === true);
    const canCopy = computed(() => canCopyOutput.value === true);
    const isChart = computed(() => isChartOutput.value === true);
    const domainShared = computed(() => domainSharedOutput.value === true);
    const revision = computed(() => (typeof revisionOutput.value === "number" ? revisionOutput.value : null));
    const usedByCount = computed(() => (typeof usedByCountOutput.value === "number" ? usedByCountOutput.value : 0));
    const hiddenUsedByCount = computed(() => (typeof hiddenUsedByCountOutput.value === "number" ? hiddenUsedByCountOutput.value : 0));

    // Align dialog and submit availability strictly with the detail entry conditions.
    const canStartEdit = computed(() => Boolean(selectedKey.value) && !isFormMode.value && recordReady.value && canEdit.value);
    const canOpenCopy = computed(
      () => Boolean(selectedKey.value) && !isFormMode.value && recordReady.value && canEdit.value && canCopy.value && !isChart.value,
    );
    const canTriggerDelete = computed(() => Boolean(selectedKey.value) && !isFormMode.value && recordReady.value && canEdit.value && canDelete.value);
    const canOpenGrant = computed(() => Boolean(selectedKey.value) && !isFormMode.value && recordReady.value && canEdit.value && canGrant.value);

    const CLOSED_DIALOGS_PATCH = {
      copyDialog: null,
      copyId: null,
      copyName: null,
      grantDialog: null,
      grantUser: null,
      grantRole: null,
      grantPrincipalId: null,
    };

    let silentDiscard = false;
    let guardingSelection = false;
    let leavingFormPromise = null;
    let committedSelected = selected.value;

    function isFormDirty() {
      return isFormMode.value && instance.forms.dirty("form");
    }

    async function confirmAndDiscardForm() {
      if (!isFormDirty()) return true;
      if (leavingFormPromise) return false;
      const run = (async () => {
        if (ctx.confirmLeaveUnsaved) {
          const allowed = await ctx.confirmLeaveUnsaved();
          if (!allowed) return false;
          silentDiscard = true;
          try {
            instance.forms.discard("form");
          } finally {
            silentDiscard = false;
          }
          return true;
        }
        silentDiscard = true;
        try {
          return await instance.forms.reset("form", { confirm: true });
        } finally {
          silentDiscard = false;
        }
      })();
      leavingFormPromise = run;
      try {
        return await run;
      } finally {
        leavingFormPromise = null;
      }
    }

    // Registered first so `lastPatchedKeys` reflects the incoming `selected` update before sibling watchers run.
    // Returns to view mode and closes dialogs when only `selected` changes, while preserving fields explicitly
    // passed in the same atomic `setState` (for example `{ selected, detailMode: "edit" }`).
    watch(selectedKey, (nextKey, prevKey) => {
      if (nextKey === prevKey || guardingSelection) return;

      const prevSelected = committedSelected;
      const nextSelected = selected.value;
      const patched = instance.state.lastPatchedKeys;

      const resetPatch = {};
      if (!patched?.has("creating") && values.value.creating !== null) {
        resetPatch.creating = null;
      }
      if (!patched?.has("detailMode") && values.value.detailMode !== "view") {
        resetPatch.detailMode = "view";
      }
      if (!patched?.has("copyDialog")) {
        if (values.value.copyDialog !== null) resetPatch.copyDialog = null;
        if (!patched?.has("copyId") && values.value.copyId !== null) resetPatch.copyId = null;
        if (!patched?.has("copyName") && values.value.copyName !== null) resetPatch.copyName = null;
      }
      if (!patched?.has("grantDialog")) {
        if (values.value.grantDialog !== null) resetPatch.grantDialog = null;
        if (!patched?.has("grantUser") && values.value.grantUser !== null) resetPatch.grantUser = null;
        if (!patched?.has("grantRole") && values.value.grantRole !== null) resetPatch.grantRole = null;
        if (!patched?.has("grantPrincipalId") && values.value.grantPrincipalId !== null) resetPatch.grantPrincipalId = null;
      }

      if (isFormDirty()) {
        const restoreTarget = creating.value ? null : prevSelected;
        guardingSelection = true;
        instance.state.set("selected", restoreTarget);
        void confirmAndDiscardForm()
          .then((allowed) => {
            if (!allowed) return;
            committedSelected = nextSelected;
            instance.state.setState({ selected: nextSelected, ...resetPatch });
          })
          .finally(() => {
            guardingSelection = false;
          });
        return;
      }

      committedSelected = nextSelected;
      if (Object.keys(resetPatch).length > 0) {
        instance.state.setState(resetPatch);
      }
    });

    // Fall back to overview tab if the selected projection does not grant permission editing.
    watch([selectedKey, recordReady, canOpenGrant, tabModel], ([key, ready, grantable, activeTab]) => {
      if (key && ready && !grantable && activeTab === "grants") {
        instance.state.set("tab", "overview");
      }
    });

    // Keep deleteRevision aligned with the ready selected projection's revision for OperationButton binding.
    watch([selectedKey, recordReady, revision], ([key, ready, rev]) => {
      const next = key && ready && rev !== null ? rev : null;
      if ((values.value.deleteRevision ?? null) !== next) {
        instance.state.set("deleteRevision", next);
      }
    }, { immediate: true });

    // Dialog states backed by manifest.state so agents can inspect and operate them.
    const copyDialogOpen = computed({
      get: () => canOpenCopy.value && values.value.copyDialog === true,
      set: (open) => {
        if (!open) instance.state.setState({ copyDialog: null, copyId: null, copyName: null });
        else if (canOpenCopy.value) instance.state.set("copyDialog", true);
      },
    });
    const copyIdModel = computed({
      get: () => values.value.copyId ?? "",
      set: (next) => instance.state.set("copyId", next || null),
    });
    const copyNameModel = computed({
      get: () => values.value.copyName ?? "",
      set: (next) => instance.state.set("copyName", next || null),
    });
    const copyReady = computed(() => Boolean(copyIdModel.value.trim() && copyNameModel.value.trim()));

    const deleteRevision = computed(() => (typeof values.value.deleteRevision === "number" ? values.value.deleteRevision : null));

    const grantDialogOpen = computed({
      get: () => canOpenGrant.value && values.value.grantDialog === true,
      set: (open) => {
        if (!open) {
          instance.state.setState({
            grantDialog: null,
            grantUser: null,
            grantRole: null,
            grantPrincipalId: null,
          });
        } else if (canOpenGrant.value) {
          instance.state.set("grantDialog", true);
        }
      },
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
    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);

    // Sync grantPrincipalId from the selected User or Role ReferencePicker state.
    watch(
      () => ({
        kind: grantPrincipalKindModel.value,
        userId: values.value.grantUser?.primaryKey ?? "",
        roleId: values.value.grantRole?.primaryKey ?? "",
      }),
      ({ kind, userId, roleId }) => {
        const picked = kind === "role" ? roleId : userId;
        const next = picked || null;
        if ((values.value.grantPrincipalId ?? null) !== next) {
          instance.state.set("grantPrincipalId", next);
        }
      },
      { immediate: true },
    );

    function closeForm() {
      const patch = {};
      if (creating.value) patch.creating = null;
      if (detailMode.value === "edit") patch.detailMode = "view";
      if (Object.keys(patch).length) instance.state.setState(patch);
    }

    function onFormDiscarded() {
      if (silentDiscard) return;
      closeForm();
    }

    const formBack = usePanelBack(isFormMode, closeForm, {
      pushHistory: false,
      forms: "form",
    });

    function closeFormGuarded() {
      if (ctx.confirmLeaveUnsaved) {
        void formBack.back();
        return;
      }
      void confirmAndDiscardForm().then((allowed) => {
        if (allowed) closeForm();
      });
    }

    async function startCreate() {
      if (isFormDirty()) {
        const allowed = await confirmAndDiscardForm();
        if (!allowed) return;
      }
      committedSelected = null;
      instance.state.setState({
        selected: null,
        creating: true,
        detailMode: "view",
        ...CLOSED_DIALOGS_PATCH,
      });
    }

    function startEdit() {
      if (!canStartEdit.value) return;
      instance.state.setState({ creating: null, detailMode: "edit", ...CLOSED_DIALOGS_PATCH });
    }

    async function onChooseProjection(nextSelection) {
      if (!isFormMode.value) return;
      if (!isFormDirty()) {
        closeForm();
        return;
      }
      // ObjectList writes `selected` synchronously before emitting `choose`; restore the active form target
      // in the same tick so ObjectForm stays mounted on the unsaved draft until the reader decides.
      const restoreTarget = creating.value ? null : committedSelected;
      guardingSelection = true;
      try {
        instance.state.set("selected", restoreTarget);
        const allowed = await confirmAndDiscardForm();
        if (!allowed) return;
        committedSelected = nextSelection ?? null;
        instance.state.setState({
          selected: nextSelection ?? null,
          creating: null,
          detailMode: "view",
          ...CLOSED_DIALOGS_PATCH,
        });
      } finally {
        guardingSelection = false;
      }
    }

    function onSaved(saved) {
      const nextSelected = saved?.primaryKey
        ? { className: saved.className ?? PROJECTION_TYPE, primaryKey: saved.primaryKey }
        : selected.value;
      committedSelected = nextSelected ?? null;
      const patch = { creating: null, detailMode: "view" };
      if (saved?.primaryKey) {
        patch.selected = nextSelected;
      }
      instance.state.setState(patch);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function openCopy() {
      if (!canOpenCopy.value) return;
      const baseName = selectedLabel.value || selectedKey.value;
      instance.state.setState({
        copyName: t("copy.defaultName", { name: baseName }),
        copyId: newProjectionId(),
        copyDialog: true,
      });
    }

    function onCopyDone(outcome) {
      if (outcome?.kind !== "success") return;
      const copiedId = typeof outcome.data?.id === "string" && outcome.data.id ? outcome.data.id : "";
      const nextSelected = copiedId ? { className: PROJECTION_TYPE, primaryKey: copiedId } : null;
      if (nextSelected) committedSelected = nextSelected;
      instance.state.setState({
        copyDialog: null,
        copyId: null,
        copyName: null,
        detailMode: "view",
        ...(nextSelected ? { selected: nextSelected } : {}),
      });
      instance.refreshObjects();
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      committedSelected = null;
      instance.state.setState({
        deleteRevision: null,
        detailMode: "view",
        selected: null,
        ...CLOSED_DIALOGS_PATCH,
      });
      instance.refreshObjects();
    }

    function openGrantDialog() {
      if (!canOpenGrant.value) return;
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

    function onShareDone(outcome) {
      if (outcome?.kind === "success") instance.refreshObjects();
    }

    async function goTo(address) {
      try {
        await navigate(address);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function openClass() {
      void goTo(panelAddress(CAPABILITY_MAP, { mode: "type", view: "list", selectedType: PROJECTION_TYPE }));
    }

    function onChoosePanel(item) {
      if (!item?.primaryKey) return;
      void goTo(panelAddress(PANELS_PAGE, { selected: item.primaryKey }));
    }

    function onNavigateReference(reference) {
      if (!reference?.primaryKey) return;
      switch (reference.className) {
        case PANEL_TYPE:
          void goTo(panelAddress(PANELS_PAGE, { selected: reference.primaryKey }));
          return;
        case SDK_COMPONENT_TYPE:
          void goTo(panelAddress(COMPONENTS_PAGE, { selected: reference.primaryKey }));
          return;
        case ONTOLOGY_TYPE:
          void goTo(panelAddress(CAPABILITY_MAP, { mode: "type", view: "list", selectedType: reference.primaryKey }));
          return;
        case OBJECT_TYPE:
          void goTo(panelAddress(OBJECTS_PAGE, { selected: reference.primaryKey }));
          return;
        case RELATIONSHIP_TYPE:
          void goTo(panelAddress(RELATIONS_PAGE, { selected: reference.primaryKey }));
          return;
        case ACTION_TYPE:
          void goTo(panelAddress(ACTIONS_PAGE, { selected: reference.primaryKey }));
          return;
        case METRIC_VIEW_TYPE:
          void goTo(panelAddress(METRICS_PAGE, { selected: reference.primaryKey }));
          return;
        default:
          return;
      }
    }

    return {
      t,
      selectedKey,
      selectedLabel,
      creating,
      isFormMode,
      showDetail,
      scopeModel,
      scopeOptions,
      sortModel,
      tabModel,
      recordStatus,
      recordReady,
      recordErrorText,
      canStartEdit,
      canOpenCopy,
      canTriggerDelete,
      canOpenGrant,
      isChart,
      domainShared,
      usedByCount,
      hiddenUsedByCount,
      copyDialogOpen,
      copyIdModel,
      copyNameModel,
      copyReady,
      deleteRevision,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      grantKindOptions,
      startCreate,
      startEdit,
      closeForm,
      onFormDiscarded,
      closeFormGuarded,
      onChooseProjection,
      onSaved,
      openCopy,
      onCopyDone,
      onDeleteDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
      openClass,
      onChoosePanel,
      onNavigateReference,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionsCataloguePanel);
