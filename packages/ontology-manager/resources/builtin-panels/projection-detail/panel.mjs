import { computed, nextTick, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
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

const CATALOG_PATH = "/ontology/projections";
const CAPABILITY_MAP = "/ontology/assets/capability-map";
const PANELS_PAGE = "/ontology/panels/detail";
const COMPONENTS_PAGE = "/ontology/components";
const OBJECTS_PAGE = "/ontology/objects";
const RELATIONS_PAGE = "/ontology/relations";
const ACTIONS_PAGE = "/ontology/assets/actions";
const METRICS_PAGE = "/ontology/assets/metrics";

const VALID_TABS = new Set(["overview", "definition", "usage", "grants"]);

const newProjectionId = () => `projection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const CLOSED_DIALOGS_PATCH = {
  copyDialog: false,
  copyId: null,
  copyName: null,
  grantDialog: false,
  grantUser: null,
  grantRole: null,
  grantPrincipalId: null,
};

const ProjectionDetailPanel = {
  setup() {
    const ctx = usePanelContext();
    const { instance, navigate, notify, t } = ctx;
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const detailMode = computed(() => (values.value.detailMode === "edit" ? "edit" : "view"));
    const isEditMode = computed(() => Boolean(selectedKey.value) && detailMode.value === "edit");

    const tabModel = computed({
      get: () => (VALID_TABS.has(values.value.tab) ? values.value.tab : "overview"),
      set: (next) => instance.state.set("tab", VALID_TABS.has(next) ? next : "overview"),
    });

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

    // Align dialog and operation availability strictly with view-mode entry conditions.
    const canStartEdit = computed(() => Boolean(selectedKey.value) && !isEditMode.value && recordReady.value && canEdit.value);
    const canOpenCopy = computed(() => Boolean(selectedKey.value) && !isEditMode.value && recordReady.value && canEdit.value && canCopy.value && !isChart.value);
    const canTriggerDelete = computed(() => Boolean(selectedKey.value) && !isEditMode.value && recordReady.value && canEdit.value && canDelete.value);
    const canOpenGrant = computed(() => Boolean(selectedKey.value) && !isEditMode.value && recordReady.value && canEdit.value && canGrant.value);

    const tabItems = computed(() => [
      { name: "overview", label: t("tab.overview") },
      { name: "definition", label: t("tab.definition") },
      { name: "usage", label: t("tab.usage") },
      ...(canOpenGrant.value ? [{ name: "grants", label: t("tab.grants") }] : []),
    ]);

    const editDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && recordReady.value && isEditMode.value && canEdit.value,
    });

    // Registered first so `lastPatchedKeys` reflects the incoming `selected` update before sibling watchers run.
    watch(
      selectedKey,
      (nextKey, prevKey) => {
        if (prevKey === undefined || nextKey === prevKey) return;

        const patched = instance.state.lastPatchedKeys;
        const resetPatch = {};
        if (!patched?.has("detailMode") && values.value.detailMode !== "view") {
          resetPatch.detailMode = "view";
        }
        if (!patched?.has("copyDialog")) {
          if (values.value.copyDialog) resetPatch.copyDialog = false;
          if (!patched?.has("copyId") && values.value.copyId !== null) resetPatch.copyId = null;
          if (!patched?.has("copyName") && values.value.copyName !== null) resetPatch.copyName = null;
        }
        if (!patched?.has("grantDialog")) {
          if (values.value.grantDialog) resetPatch.grantDialog = false;
          if (!patched?.has("grantUser") && values.value.grantUser !== null) resetPatch.grantUser = null;
          if (!patched?.has("grantRole") && values.value.grantRole !== null) resetPatch.grantRole = null;
          if (!patched?.has("grantPrincipalId") && values.value.grantPrincipalId !== null) resetPatch.grantPrincipalId = null;
        }
        if (Object.keys(resetPatch).length > 0) {
          instance.state.setState(resetPatch);
        }
      },
      { flush: "sync" },
    );

    // Prevent non-editable projections from staying in edit mode.
    watch(
      [recordReady, canEdit, detailMode],
      ([ready, editable, mode]) => {
        if (ready && !editable && mode === "edit") {
          instance.state.set("detailMode", "view");
        }
      },
      { immediate: true },
    );

    // Fall back to overview tab if the selected projection does not grant permission editing.
    watch(
      [selectedKey, recordReady, canOpenGrant, tabModel],
      ([key, ready, grantable, activeTab]) => {
        if (key && ready && !grantable && activeTab === "grants") {
          instance.state.set("tab", "overview");
        }
      },
      { immediate: true },
    );

    // Keep deleteRevision aligned with the ready selected projection's revision for delete operation binding.
    watch(
      [selectedKey, recordReady, revision],
      ([key, ready, rev]) => {
        const next = key && ready && rev !== null ? rev : null;
        if ((values.value.deleteRevision ?? null) !== next) {
          instance.state.set("deleteRevision", next);
        }
      },
      { immediate: true },
    );

    const deleteRevision = computed(() => (typeof values.value.deleteRevision === "number" ? values.value.deleteRevision : null));

    // Bound delete operation shared by the More dropdown menu and assistant `page_action`.
    const deleteOp = usePanelOperation("deleteProjection", "delete", {
      available: () => canTriggerDelete.value,
      disabled: () => deleteRevision.value == null,
      onSettled: async (receipt) => {
        if (receipt.response?.kind === "not-dispatched") {
          if (receipt.response.message) notify({ kind: "error", text: receipt.response.message });
          return;
        }
        const outcome = receipt.response?.kind === "dispatched" ? receipt.response.outcome : null;
        if (!outcome) return;
        if (outcome.kind === "success") {
          instance.state.setState({
            deleteRevision: null,
            detailMode: "view",
            selected: null,
            ...CLOSED_DIALOGS_PATCH,
          });
          instance.refreshObjects();
          notify({ kind: "success", text: t("notify.deleted") });
          await nextTick();
          void goTo(CATALOG_PATH);
        } else if (outcome.kind === "refusal" || outcome.kind === "failure") {
          if (outcome.message) notify({ kind: "error", text: outcome.message });
        }
      },
    });
    const deleteRunning = deleteOp.running;

    // Dialog states backed by manifest.state so agents can inspect and operate them.
    const copyDialogOpen = computed({
      get: () => canOpenCopy.value && values.value.copyDialog === true,
      set: (open) => {
        if (!open) instance.state.setState({ copyDialog: false, copyId: null, copyName: null });
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

    const grantDialogOpen = computed({
      get: () => canOpenGrant.value && values.value.grantDialog === true,
      set: (open) => {
        if (!open) {
          instance.state.setState({
            grantDialog: false,
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

    function exitEdit() {
      if (detailMode.value !== "view") {
        instance.state.set("detailMode", "view");
      }
    }

    const editBack = usePanelBack(
      () => recordReady.value && isEditMode.value && canEdit.value,
      exitEdit,
      { pushHistory: false, forms: "form" },
    );

    async function cancelEdit() {
      if (ctx.confirmLeaveUnsaved) {
        await editBack.back();
        return;
      }
      if (instance.forms.dirty("form")) {
        const allowed = await instance.forms.reset("form", { confirm: true });
        if (!allowed) return;
      }
      exitEdit();
    }

    function startEdit() {
      if (!canStartEdit.value) return;
      instance.state.setState({ detailMode: "edit", ...CLOSED_DIALOGS_PATCH });
    }

    function onSaved() {
      instance.state.set("detailMode", "view");
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
      instance.state.setState({
        copyDialog: false,
        copyId: null,
        copyName: null,
        detailMode: "view",
        ...(nextSelected ? { selected: nextSelected } : {}),
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
        grantDialog: false,
        grantUser: null,
        grantRole: null,
        grantPrincipalId: null,
      });
      instance.refreshObjects();
    }

    function onShareDone(outcome) {
      if (outcome?.kind === "success") instance.refreshObjects();
    }

    function onMoreCommand(command) {
      if (command === "openClass") {
        openClass();
      } else if (command === "copy") {
        openCopy();
      } else if (command === "grants") {
        if (canOpenGrant.value) tabModel.value = "grants";
      } else if (command === "delete") {
        if (canTriggerDelete.value && deleteRevision.value != null && !deleteRunning.value) {
          void deleteOp.run();
        }
      }
    }

    async function goTo(address) {
      try {
        await navigate(address);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    // Route back to the catalog entry so the platform's unified unsaved-changes guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
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
      isEditMode,
      editDraft,
      tabModel,
      tabItems,
      recordStatus,
      recordReady,
      recordErrorText,
      canEdit,
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
      deleteRunning,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      grantKindOptions,
      goBack,
      startEdit,
      cancelEdit,
      onSaved,
      openCopy,
      onCopyDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
      onMoreCommand,
      openClass,
      onChoosePanel,
      onNavigateReference,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionDetailPanel);
