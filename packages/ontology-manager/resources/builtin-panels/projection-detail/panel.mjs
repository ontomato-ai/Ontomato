import { computed, nextTick, reactive, ref, watch } from "vue";
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
  grantPolicy: null,
  grantPolicyId: null,
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
          if (!patched?.has("grantPolicy") && values.value.grantPolicy !== null) resetPatch.grantPolicy = null;
          if (!patched?.has("grantPolicyId") && values.value.grantPolicyId !== null) resetPatch.grantPolicyId = null;
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
            grantPolicy: null,
            grantPolicyId: null,
          });
        } else if (canOpenGrant.value) {
          instance.state.set("grantDialog", true);
        }
      },
    });
    const grantVerbModel = computed({
      get: () => (values.value.grantVerb === "EDIT" ? "EDIT" : "USE"),
      set: (next) => instance.state.set("grantVerb", next === "EDIT" ? "EDIT" : "USE"),
    });
    const grantPolicyId = computed(() => values.value.grantPolicyId ?? "");
    watch(
      () => values.value.grantPolicy?.primaryKey ?? null,
      policyId => instance.state.set("grantPolicyId", policyId),
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

    // PJ-09: Unify Cancel and Discard into one exit action with a single leave confirmation.
    const headerDraft = computed(() => {
      const draft = editDraft.value;
      if (!draft) return null;
      return {
        ...draft,
        confirmDiscard: false,
        discard: () => cancelEdit(),
      };
    });
    const headerDraftLabels = computed(() => ({
      discard: t("action.cancel"),
    }));

    // PJ-03: Inspect declared preview input ports via direct instance.projectionOf("preview") and apply temporary inputs.
    const previewPorts = ref([]);
    const previewDraftValues = reactive({});
    const previewDraftClasses = reactive({});
    const appliedPreviewInputs = ref({});
    const previewInputError = ref("");
    const previewRevision = ref(0);
    const hasAppliedPreviewInputs = computed(() => Object.keys(appliedPreviewInputs.value).length > 0);
    const previewRenderKey = computed(() => `${selectedKey.value}:${previewRevision.value}`);

    function resetPreviewInputs() {
      for (const key of Object.keys(previewDraftValues)) delete previewDraftValues[key];
      for (const key of Object.keys(previewDraftClasses)) delete previewDraftClasses[key];
      appliedPreviewInputs.value = {};
      previewInputError.value = "";
    }

    let previewPortSeq = 0;
    watch(
      [selectedKey, recordReady, tabModel, isEditMode],
      async ([key, ready, tab, editing]) => {
        const seq = ++previewPortSeq;
        if (!key || !ready || editing || tab !== "overview") {
          if (!key) {
            previewPorts.value = [];
            resetPreviewInputs();
          }
          return;
        }
        if (typeof instance.projectionOf !== "function") return;
        try {
          const projection = await instance.projectionOf("preview");
          if (seq !== previewPortSeq) return;
          const entries = Object.entries(projection?.inputs ?? {});
          const nextPorts = entries.map(([name, port]) => {
            if (port?.kind === "object") {
              return { name, kind: "object", objectType: port.objectType || "@any", label: `${name} (${port.objectType || "@any"})` };
            }
            if (port?.kind === "object-union") {
              const objectTypes = Array.isArray(port.objectTypes) ? port.objectTypes : [];
              return { name, kind: "object-union", objectTypes, label: `${name}` };
            }
            if (port?.kind === "scalar") {
              return { name, kind: "scalar", scalarType: port.type || "string", label: `${name} (${port.type || "string"})` };
            }
            return { name, kind: port?.kind || "json", label: `${name} (${port?.kind || "json"})` };
          });
          previewPorts.value = nextPorts;
          for (const port of nextPorts) {
            if (port.kind === "scalar" && port.scalarType === "boolean") {
              if (!(port.name in previewDraftValues)) previewDraftValues[port.name] = false;
            } else if (!(port.name in previewDraftValues)) {
              previewDraftValues[port.name] = "";
            }
            if (port.kind === "object-union" && !(port.name in previewDraftClasses)) {
              previewDraftClasses[port.name] = port.objectTypes[0] ?? "";
            } else if (port.kind === "object" && port.objectType === "@any" && !(port.name in previewDraftClasses)) {
              previewDraftClasses[port.name] = "";
            }
          }
        } catch {
          if (seq === previewPortSeq) previewPorts.value = [];
        }
      },
      { immediate: true },
    );

    watch(selectedKey, () => {
      previewPorts.value = [];
      resetPreviewInputs();
      previewRevision.value += 1;
    });

    function applyPreviewInputs() {
      previewInputError.value = "";
      const next = {};
      for (const port of previewPorts.value) {
        const raw = previewDraftValues[port.name];
        if (port.kind === "object") {
          const pk = typeof raw === "string" ? raw.trim() : "";
          const cls = port.objectType === "@any"
            ? (typeof previewDraftClasses[port.name] === "string" ? previewDraftClasses[port.name].trim() : "")
            : port.objectType;
          if (pk && cls) next[port.name] = { className: cls, primaryKey: pk };
        } else if (port.kind === "object-union") {
          const pk = typeof raw === "string" ? raw.trim() : "";
          const cls = typeof previewDraftClasses[port.name] === "string" ? previewDraftClasses[port.name].trim() : "";
          if (pk && cls) next[port.name] = { className: cls, primaryKey: pk };
        } else if (port.kind === "scalar") {
          if (port.scalarType === "boolean") {
            next[port.name] = Boolean(raw);
          } else if (port.scalarType === "number") {
            const text = typeof raw === "string" ? raw.trim() : "";
            if (text !== "") {
              const num = Number(text);
              if (Number.isFinite(num)) next[port.name] = num;
            }
          } else {
            const text = typeof raw === "string" ? raw.trim() : "";
            if (text !== "") next[port.name] = text;
          }
        } else {
          const text = typeof raw === "string" ? raw.trim() : "";
          if (text !== "") {
            try {
              next[port.name] = JSON.parse(text);
            } catch {
              previewInputError.value = t("preview.invalidJson", { port: port.name });
              return;
            }
          }
        }
      }
      appliedPreviewInputs.value = next;
      previewRevision.value += 1;
    }

    function clearPreviewInputs() {
      resetPreviewInputs();
      previewRevision.value += 1;
    }

    // PJ-07: Quick binding pickers for ObjectType / MetricView data and Action operations alongside JSON advanced editing.
    const dataBindKind = ref("objectType");
    const dataBindKey = ref("rows");
    const dataBindManualId = ref("");
    const showDataJson = ref(true);
    const opBindKey = ref("execute");
    const opBindManualId = ref("");
    const showOpsJson = ref(true);
    const jsonDraftText = reactive({ data: null, operations: null });
    const jsonFieldErrors = reactive({ data: "", operations: "" });

    const dataBindKindOptions = computed(() => [
      { value: "objectType", label: t("binding.kindObjectType") },
      { value: "metric", label: t("binding.kindMetric") },
    ]);

    watch(dataBindKind, (kind) => {
      if (kind === "metric" && (dataBindKey.value === "rows" || !dataBindKey.value.trim())) {
        dataBindKey.value = "result";
      } else if (kind === "objectType" && (dataBindKey.value === "result" || !dataBindKey.value.trim())) {
        dataBindKey.value = "rows";
      }
    });

    watch(isEditMode, (active) => {
      if (!active) {
        jsonDraftText.data = null;
        jsonDraftText.operations = null;
        jsonFieldErrors.data = "";
        jsonFieldErrors.operations = "";
        instance.state.setState({
          bindingObjectType: null,
          bindingMetric: null,
          bindingAction: null,
        });
      }
    });

    const pickedObjectTypeId = computed(() => values.value.bindingObjectType?.primaryKey || "");
    const pickedMetricId = computed(() => values.value.bindingMetric?.primaryKey || "");
    const pickedActionId = computed(() => values.value.bindingAction?.primaryKey || "");
    const resolvedDataTargetId = computed(() =>
      dataBindManualId.value.trim() || (dataBindKind.value === "metric" ? pickedMetricId.value : pickedObjectTypeId.value),
    );
    const resolvedActionId = computed(() => opBindManualId.value.trim() || pickedActionId.value);
    const canApplyDataBinding = computed(() => Boolean(dataBindKey.value.trim() && resolvedDataTargetId.value));
    const canApplyOperationBinding = computed(() => Boolean(opBindKey.value.trim() && resolvedActionId.value));

    function formatJsonField(value, fieldName) {
      if (jsonDraftText[fieldName] !== null) return jsonDraftText[fieldName];
      try {
        return JSON.stringify(value ?? {}, null, 2);
      } catch {
        return "{}";
      }
    }

    function onJsonFieldInput(fieldName, text, update) {
      jsonDraftText[fieldName] = text;
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!trimmed) {
        jsonFieldErrors[fieldName] = "";
        update({});
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          jsonFieldErrors[fieldName] = t("binding.invalidJson");
          return;
        }
        jsonFieldErrors[fieldName] = "";
        update(parsed);
      } catch {
        jsonFieldErrors[fieldName] = t("binding.invalidJson");
      }
    }

    function applyDataBinding(currentValue, update) {
      const key = dataBindKey.value.trim();
      const targetId = resolvedDataTargetId.value;
      if (!key || !targetId) return;
      const base = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
        ? { ...currentValue }
        : {};
      base[key] = dataBindKind.value === "metric"
        ? {
            source: { object: { literal: { className: METRIC_VIEW_TYPE, primaryKey: targetId } } },
            read: "result",
            params: {},
          }
        : {
            source: { type: { kind: "ObjectType", id: targetId } },
            read: "query",
            params: {},
          };
      jsonDraftText.data = null;
      jsonFieldErrors.data = "";
      update(base);
    }

    function applyOperationBinding(currentValue, update) {
      const key = opBindKey.value.trim();
      const actionId = resolvedActionId.value;
      if (!key || !actionId) return;
      const base = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
        ? { ...currentValue }
        : {};
      base[key] = {
        operation: { kind: "Action", id: actionId },
      };
      jsonDraftText.operations = null;
      jsonFieldErrors.operations = "";
      update(base);
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
        grantPolicy: null,
        grantPolicyId: null,
        grantVerb: "USE",
        grantDialog: true,
      });
    }

    function onGrantAdded(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({
        grantDialog: false,
        grantPolicy: null,
        grantPolicyId: null,
      });
      instance.refreshObjects();
    }

    function onShareDone(outcome) {
      if (outcome?.kind === "success" && outcome.data?.success === true) instance.refreshObjects();
    }

    function onMoreCommand(command) {
      if (command === "copy") {
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
      headerDraft,
      headerDraftLabels,
      previewPorts,
      previewDraftValues,
      previewDraftClasses,
      appliedPreviewInputs,
      hasAppliedPreviewInputs,
      previewRenderKey,
      previewInputError,
      applyPreviewInputs,
      clearPreviewInputs,
      dataBindKind,
      dataBindKindOptions,
      dataBindKey,
      dataBindManualId,
      showDataJson,
      opBindKey,
      opBindManualId,
      showOpsJson,
      jsonFieldErrors,
      canApplyDataBinding,
      canApplyOperationBinding,
      formatJsonField,
      onJsonFieldInput,
      applyDataBinding,
      applyOperationBinding,
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
      grantVerbModel,
      grantPolicyId,
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
      onChoosePanel,
      onNavigateReference,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionDetailPanel);
