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
    const { instance, navigate, notify, t } = usePanelContext();
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

    // Clear stale create mode when a projection is selected without altering detailMode.
    watch(selectedKey, (nextKey, prevKey) => {
      if (nextKey === prevKey) return;
      if (nextKey && creating.value) {
        instance.state.set("creating", null);
      }
    });

    // Fall back to overview tab if the selected projection does not grant permission editing.
    watch([selectedKey, recordReady, canGrant, tabModel], ([key, ready, grantable, activeTab]) => {
      if (key && ready && !grantable && activeTab === "grants") {
        instance.state.set("tab", "overview");
      }
    });

    // Keep deleteRevision aligned with the selected projection's current revision for OperationButton binding.
    watch([selectedKey, revision], ([key, rev]) => {
      const next = key && rev !== null ? rev : null;
      if ((values.value.deleteRevision ?? null) !== next) {
        instance.state.set("deleteRevision", next);
      }
    }, { immediate: true });

    // Dialog states backed by manifest.state so agents can inspect and operate them.
    const copyDialogOpen = computed({
      get: () => values.value.copyDialog === true,
      set: (open) => {
        if (!open) instance.state.setState({ copyDialog: null, copyId: null, copyName: null });
        else instance.state.set("copyDialog", true);
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

    const deleteDialogOpen = computed({
      get: () => values.value.deleteDialog === true,
      set: (open) => instance.state.set("deleteDialog", open ? true : null),
    });
    const deleteRevision = computed(() => (typeof values.value.deleteRevision === "number" ? values.value.deleteRevision : null));

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

    const formBack = usePanelBack(isFormMode, closeForm, {
      pushHistory: false,
      forms: "form",
    });

    function closeFormGuarded() {
      void formBack.back();
    }

    function startCreate() {
      instance.state.setState({ selected: null, creating: true, detailMode: "view" });
    }

    function startEdit() {
      if (!selectedKey.value || !canEdit.value) return;
      instance.state.setState({ creating: null, detailMode: "edit" });
    }

    function onChooseProjection() {
      if (isFormMode.value) closeForm();
    }

    function onSaved(saved) {
      const patch = { creating: null, detailMode: "view" };
      if (saved?.primaryKey) {
        patch.selected = { className: saved.className ?? PROJECTION_TYPE, primaryKey: saved.primaryKey };
      }
      instance.state.setState(patch);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function openCopy() {
      if (!selectedKey.value || !canCopy.value) return;
      const baseName = selectedLabel.value || selectedKey.value;
      instance.state.setState({
        copyName: t("copy.defaultName", { name: baseName }),
        copyId: newProjectionId(),
        copyDialog: true,
      });
    }

    function onCopyDone(outcome) {
      if (outcome?.kind !== "success") return;
      const copiedId = typeof outcome.data?.id === "string" && outcome.data.id
        ? outcome.data.id
        : copyIdModel.value.trim();
      instance.state.setState({
        copyDialog: null,
        copyId: null,
        copyName: null,
        detailMode: "view",
        ...(copiedId ? { selected: { className: PROJECTION_TYPE, primaryKey: copiedId } } : {}),
      });
      instance.refreshObjects();
    }

    function openDelete() {
      if (!selectedKey.value || !canDelete.value) return;
      instance.state.setState({
        deleteRevision: revision.value,
        deleteDialog: true,
      });
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({
        deleteDialog: null,
        deleteRevision: null,
        detailMode: "view",
        selected: null,
      });
      instance.refreshObjects();
    }

    function openGrantDialog() {
      if (!selectedKey.value || !canGrant.value) return;
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
      canEdit,
      canGrant,
      canDelete,
      canCopy,
      isChart,
      domainShared,
      usedByCount,
      hiddenUsedByCount,
      copyDialogOpen,
      copyIdModel,
      copyNameModel,
      copyReady,
      deleteDialogOpen,
      deleteRevision,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      grantKindOptions,
      startCreate,
      startEdit,
      closeForm,
      closeFormGuarded,
      onChooseProjection,
      onSaved,
      openCopy,
      onCopyDone,
      openDelete,
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
