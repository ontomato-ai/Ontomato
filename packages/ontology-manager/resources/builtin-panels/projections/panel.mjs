import { computed, reactive, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/projections/detail";
const SDK_COMPONENT_TYPE = "platform:SDKComponent";
const ONTOLOGY_TYPE = "platform:OntologyType";
const METRIC_VIEW_TYPE = "platform:MetricView";
const DASHBOARD_CARD_TYPE = "platform:DashboardCard";
const METRIC_CHART_COMPONENT = "@ontomato/sdk:MetricChart";

const ProjectionsCatalogPanel = {
  setup() {
    const ctx = usePanelContext();
    const { instance, navigate, notify, t } = ctx;
    const values = instance.state.values;

    const creating = computed(() => values.value.creating === true);
    const createModeModel = computed({
      get: () => (values.value.createMode === "chart" ? "chart" : "standard"),
      set: (next) => instance.state.set("createMode", next === "chart" ? "chart" : "standard"),
    });
    const createModeOptions = computed(() => [
      { value: "standard", label: t("create.standard") },
      { value: "chart", label: t("create.chart") },
    ]);

    // PJ-07: Quick binding helpers for ObjectType / MetricView data and Action operations alongside JSON advanced editing.
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

    // PJ-08: Dashboard chart identification & selection writing a real M2 chart projection reference into createForm.
    const selectedDashboardKey = computed(() => values.value.selectedDashboard?.primaryKey || "");
    const selectedChartCardKey = computed(() => values.value.selectedChartCard?.primaryKey || "");
    const selectedChartCardLabel = usePanelOutput("dashboardCardsList", "selectedLabel");
    const selectedChartCardKind = usePanelOutput("dashboardCardsList", "kind");
    const isSelectedCardChart = computed(() => {
      const kind = typeof selectedChartCardKind.value === "string" ? selectedChartCardKind.value : "";
      return !kind || kind === "chart";
    });
    const canApplyChartCard = computed(() => Boolean(selectedChartCardKey.value && isSelectedCardChart.value));
    const appliedChartLabel = ref("");

    watch(selectedDashboardKey, () => {
      if (values.value.selectedChartCard) {
        instance.state.set("selectedChartCard", null);
      }
    });

    function applySelectedChartCard() {
      const cardKey = selectedChartCardKey.value;
      if (!cardKey || !isSelectedCardChart.value) return;
      const handle = instance.forms.handle("createForm");
      if (!handle) return;
      const cardLabel = typeof selectedChartCardLabel.value === "string" && selectedChartCardLabel.value
        ? selectedChartCardLabel.value
        : cardKey;
      const cardSource = { object: { literal: { className: DASHBOARD_CARD_TYPE, primaryKey: cardKey } } };
      handle.set("/name", cardLabel);
      handle.set("/componentId", METRIC_CHART_COMPONENT);
      handle.set("/data", {
        template: { source: cardSource, read: "chartTemplate", params: {} },
        result: { source: cardSource, read: "result", params: {} },
      });
      appliedChartLabel.value = cardLabel;
    }

    watch(creating, (active) => {
      if (!active) {
        appliedChartLabel.value = "";
        jsonDraftText.data = null;
        jsonDraftText.operations = null;
        jsonFieldErrors.data = "";
        jsonFieldErrors.operations = "";
        instance.state.setState({
          createMode: "standard",
          bindingObjectType: null,
          bindingMetric: null,
          bindingAction: null,
          selectedDashboard: null,
          selectedChartCard: null,
        });
      }
    });
    const scopeModel = computed({
      get: () => values.value.scope || "all",
      set: (next) => instance.state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => values.value.sort || "updated",
      set: (next) => instance.state.set("sort", next || "updated"),
    });
    const componentId = computed(() => (typeof values.value.componentId === "string" ? values.value.componentId : ""));
    const componentFilterKey = computed(() => values.value.componentFilter?.primaryKey || "");
    const objectType = computed(() => (typeof values.value.objectType === "string" ? values.value.objectType : ""));
    const objectTypeFilterKey = computed(() => values.value.objectTypeFilter?.primaryKey || "");

    // Keep deep-linkable scalar filter states synchronized with their ReferencePicker object selections.
    watch(
      componentId,
      (next) => {
        if (next === componentFilterKey.value) return;
        instance.state.set("componentFilter", next ? { className: SDK_COMPONENT_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(componentFilterKey, (next) => {
      if (next === componentId.value) return;
      instance.state.set("componentId", next || null);
    });
    watch(
      objectType,
      (next) => {
        if (next === objectTypeFilterKey.value) return;
        instance.state.set("objectTypeFilter", next ? { className: ONTOLOGY_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(objectTypeFilterKey, (next) => {
      if (next === objectType.value) return;
      instance.state.set("objectType", next || null);
    });

    function clearFilters() {
      instance.state.setState({
        search: null,
        scope: "all",
        componentId: null,
        componentFilter: null,
        objectType: null,
        objectTypeFilter: null,
      });
    }
    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    const createDraft = usePanelFormDraft("createForm", {
      when: () => creating.value,
    });

    function exitCreate() {
      if (creating.value) {
        instance.state.set("creating", false);
      }
    }

    const createBack = usePanelBack(() => creating.value, exitCreate, {
      pushHistory: false,
      forms: "createForm",
    });

    async function cancelCreate() {
      if (!creating.value) return;
      if (ctx.confirmLeaveUnsaved) {
        await createBack.back();
        return;
      }
      if (instance.forms.dirty("createForm")) {
        const allowed = await instance.forms.reset("createForm", { confirm: true });
        if (!allowed) return;
      }
      exitCreate();
    }

    function startCreate() {
      instance.state.set("creating", true);
    }

    let forwarding = false;
    async function navigateToDetail(primaryKey) {
      if (!primaryKey || forwarding) return;
      forwarding = true;
      try {
        await navigate(panelAddress(DETAIL_PATH, { selected: primaryKey }));
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      } finally {
        forwarding = false;
      }
    }

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigateToDetail(item.primaryKey);
    }

    function onCreated(saved) {
      instance.state.set("creating", false);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
      if (saved?.primaryKey) {
        void navigateToDetail(saved.primaryKey);
      }
    }

    return {
      t,
      creating,
      createDraft,
      createModeModel,
      createModeOptions,
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
      selectedDashboardKey,
      selectedChartCardKey,
      isSelectedCardChart,
      canApplyChartCard,
      appliedChartLabel,
      applySelectedChartCard,
      scopeModel,
      scopeOptions,
      sortModel,
      startCreate,
      cancelCreate,
      clearFilters,
      openDetail,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionsCatalogPanel);
