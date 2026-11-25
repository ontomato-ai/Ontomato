import { computed, ref, shallowRef, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const ATTRIBUTE = "platform:Attribute";

function parseAttributeName(primaryKey) {
  if (typeof primaryKey !== "string" || !primaryKey) return null;
  try {
    const parsed = JSON.parse(primaryKey);
    if (Array.isArray(parsed) && typeof parsed[1] === "string" && parsed[1]) return parsed[1];
  } catch {
    // Fallback to raw primaryKey if not composite JSON.
  }
  return primaryKey;
}

function todayStamp() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameNode(a, b) {
  return Boolean(a && b && a.className === b.className && a.primaryKey === b.primaryKey);
}

await mountPanel({
  setup() {
    const { instance, t, navigate, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const drawerSize = computed(() => (narrow.value ? "100%" : "420px"));
    const dialogWidth = computed(() => (narrow.value ? "94%" : "560px"));

    const state = computed(() => instance.state.values.value);
    const viewMode = computed(() => (state.value.viewMode === "table" ? "table" : "graph"));
    const isGraphMode = computed(() => viewMode.value === "graph");
    const isTableMode = computed(() => viewMode.value === "table");

    const viewModeOptions = computed(() => [
      { value: "graph", label: t("db.modeGraph") },
      { value: "table", label: t("db.modeTable") },
    ]);

    const selectedClass = computed(() => state.value.selectedClass ?? null);
    const selectedClassKey = computed(() => selectedClass.value?.primaryKey ?? "");

    const selectedNode = computed(() => state.value.selectedNode ?? null);
    const hasSelectedNode = computed(() => Boolean(selectedNode.value?.className && selectedNode.value?.primaryKey));
    const nodeHeaderStatus = usePanelOutput("nodeHeader", "status");
    const nodeHeaderLabel = usePanelOutput("nodeHeader", "label");
    const selectedNodeFallbackTitle = computed(() => {
      if (nodeHeaderLabel.value) return nodeHeaderLabel.value;
      const node = selectedNode.value;
      if (!node) return "";
      return instance.objectName(node.className, node.primaryKey) || node.primaryKey;
    });

    // Graph stats & version sync for graph search.
    const graphNodeCount = usePanelOutput("instanceGraph", "nodeCount");
    const graphEdgeCount = usePanelOutput("instanceGraph", "edgeCount");
    const graphVersionOutput = usePanelOutput("instanceGraph", "graphVersion");
    const graphStatsLabel = computed(() => {
      if (typeof graphNodeCount.value !== "number") return "";
      const edges = typeof graphEdgeCount.value === "number" ? graphEdgeCount.value : 0;
      return t("db.graphStatsSummary", { nodes: graphNodeCount.value, edges });
    });

    watch(
      graphVersionOutput,
      (version) => {
        const next = typeof version === "string" && version ? version : null;
        if ((instance.state.values.value.graphVersion ?? null) !== next) {
          instance.state.set("graphVersion", next);
        }
      },
      { immediate: true },
    );

    // Sync optional graph search class filter ref -> string parameter state so null omits className cleanly.
    const graphSearchClassKey = computed(() => state.value.graphSearchClass?.primaryKey ?? null);
    watch(
      graphSearchClassKey,
      (next) => {
        if ((instance.state.values.value.graphSearchClassName ?? null) !== next) {
          instance.state.set("graphSearchClassName", next);
        }
      },
      { immediate: true },
    );

    const graphSearchOpen = ref(false);
    const graphQueryInput = computed({
      get: () => (typeof state.value.graphQuery === "string" ? state.value.graphQuery : ""),
      set: (value) => instance.state.set("graphQuery", value || ""),
    });
    const showGraphSearchPopover = computed(
      () => graphSearchOpen.value && Boolean(graphQueryInput.value.trim()),
    );

    function onGraphQueryInput(value) {
      graphSearchOpen.value = Boolean(typeof value === "string" && value.trim());
    }

    function onGraphQueryClear() {
      graphSearchOpen.value = false;
      instance.state.set("graphQuery", "");
    }

    function focusSearchedInstance(reference) {
      if (!reference?.className || !reference?.primaryKey) return;
      const target = { className: reference.className, primaryKey: reference.primaryKey };
      graphSearchOpen.value = false;
      instance.state.setState({
        selectedNode: target,
        graphStart: target,
      });
    }

    function clearSelectedNode() {
      instance.state.set("selectedNode", null);
    }

    function openSelectedNodeDetail() {
      const node = selectedNode.value;
      if (!node?.className || !node?.primaryKey) return;
      void navigate(panelAddress("/browser/views", {
        selected: { className: node.className, primaryKey: node.primaryKey },
      })).catch(() => undefined);
    }

    function exploreSelectedNode() {
      const node = selectedNode.value;
      if (!node?.className || !node?.primaryKey) return;
      const target = { className: node.className, primaryKey: node.primaryKey };
      const currentStart = state.value.graphStart;
      if (!currentStart) {
        instance.state.set("graphStart", target);
        return;
      }
      const existing = Array.isArray(state.value.expandedNodes) ? state.value.expandedNodes : [];
      if (!existing.some((item) => sameNode(item, target))) {
        instance.state.set("expandedNodes", [...existing, target]);
      }
    }

    // Table mode: search, attributes, multi-condition filters & server sort.
    const tableSearchInput = computed({
      get: () => (typeof state.value.search === "string" ? state.value.search : ""),
      set: (value) => instance.state.set("search", value || ""),
    });

    const exportFileName = computed(() =>
      selectedClassKey.value ? `${selectedClassKey.value}-${todayStamp()}` : undefined,
    );

    const attributeOptions = shallowRef([]);
    function onAttributesListed(refs) {
      if (!Array.isArray(refs)) {
        attributeOptions.value = [];
        return;
      }
      const seen = new Set();
      const next = [];
      for (const refItem of refs) {
        const name = parseAttributeName(refItem?.primaryKey);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const label = instance.objectName(ATTRIBUTE, refItem.primaryKey) || name;
        next.push({ name, label });
      }
      attributeOptions.value = next;
    }

    const filterOperators = computed(() => [
      { value: "eq", label: t("db.opEq") },
      { value: "ne", label: t("db.opNe") },
      { value: "contains", label: t("db.opContains") },
      { value: "gt", label: t("db.opGt") },
      { value: "lt", label: t("db.opLt") },
      { value: "gte", label: t("db.opGte") },
      { value: "lte", label: t("db.opLte") },
      { value: "null", label: t("db.opNull") },
      { value: "notnull", label: t("db.opNotNull") },
    ]);

    const filterDrawerOpen = ref(false);
    const draftFilters = ref([]);
    const draftSortField = ref("");
    const draftSortOrder = ref("asc");

    const appliedFilters = computed(() => (Array.isArray(state.value.filters) ? state.value.filters : []));
    const appliedSort = computed(() => {
      const current = state.value.sort;
      return current && typeof current === "object" && typeof current.field === "string" && current.field
        ? current
        : null;
    });
    const activeFilterSortCount = computed(() => appliedFilters.value.length + (appliedSort.value ? 1 : 0));

    function syncDraftFromState() {
      draftFilters.value = appliedFilters.value.map((item) => ({
        field: typeof item.field === "string" ? item.field : "",
        operator: typeof item.operator === "string" ? item.operator : "eq",
        value: item.value == null ? "" : String(item.value),
      }));
      draftSortField.value = appliedSort.value?.field ?? "";
      draftSortOrder.value = appliedSort.value?.order === "desc" ? "desc" : "asc";
    }

    function openFilterDrawer() {
      syncDraftFromState();
      if (draftFilters.value.length === 0) {
        draftFilters.value.push({ field: "", operator: "eq", value: "" });
      }
      filterDrawerOpen.value = true;
    }

    function addFilterCondition() {
      draftFilters.value.push({ field: "", operator: "eq", value: "" });
    }

    function removeFilterCondition(index) {
      draftFilters.value.splice(index, 1);
    }

    function applyFilters() {
      const normalizedFilters = [];
      for (const item of draftFilters.value) {
        const field = typeof item.field === "string" ? item.field.trim() : "";
        const operator = typeof item.operator === "string" ? item.operator : "";
        if (!field || !operator) continue;
        if (operator === "null" || operator === "notnull") {
          normalizedFilters.push({ field, operator });
          continue;
        }
        const rawValue = item.value == null ? "" : String(item.value);
        if (rawValue === "") continue;
        normalizedFilters.push({ field, operator, value: rawValue });
      }
      const sortField = typeof draftSortField.value === "string" ? draftSortField.value.trim() : "";
      const nextSort = sortField
        ? { field: sortField, order: draftSortOrder.value === "desc" ? "desc" : "asc" }
        : null;
      instance.state.setState({
        filters: normalizedFilters.length > 0 ? normalizedFilters : null,
        sort: nextSort,
      });
      filterDrawerOpen.value = false;
    }

    function resetAppliedFilters() {
      draftFilters.value = [];
      draftSortField.value = "";
      draftSortOrder.value = "asc";
      instance.state.setState({ filters: null, sort: null });
      filterDrawerOpen.value = false;
    }

    function onListClearFilters() {
      draftFilters.value = [];
      draftSortField.value = "";
      draftSortOrder.value = "asc";
    }

    function openInstanceDetail(reference) {
      if (!reference?.className || !reference?.primaryKey) return;
      void navigate(panelAddress("/browser/views", {
        selected: { className: reference.className, primaryKey: reference.primaryKey },
      })).catch(() => undefined);
    }

    // Presentation configuration dialog (local UI toggle only, never enters URL).
    const canConfigureOutput = usePanelOutput("detailBinding", "canConfigure");
    const canConfigure = computed(() => canConfigureOutput.value === true);
    const configureDialog = ref(false);

    const dialogBack = usePanelBack(
      () => configureDialog.value,
      () => {
        configureDialog.value = false;
      },
      { pushHistory: false, forms: "detailPanelForm" },
    );

    function openConfigureDialog() {
      if (!canConfigure.value || !selectedClassKey.value) return;
      configureDialog.value = true;
    }

    async function handleConfigureDialogClose(done) {
      if (await dialogBack.back()) done();
    }

    function onDetailPanelSaved() {
      configureDialog.value = false;
      notify({ kind: "success", text: t("db.savedNotice") });
      instance.refreshObjects();
    }

    function onDetailPanelCleared(outcome) {
      if (outcome?.kind !== "success") return;
      configureDialog.value = false;
      notify({ kind: "success", text: t("db.clearedNotice") });
      instance.refreshObjects();
    }

    function openPanelsDirectory() {
      configureDialog.value = false;
      void navigate("/ontology/panels").catch(() => undefined);
    }

    // Switching object type clears class-specific filters/sort and closes class dialogs/drawers.
    watch(selectedClassKey, (next, prev) => {
      if (prev === undefined || next === prev) return;
      attributeOptions.value = [];
      configureDialog.value = false;
      filterDrawerOpen.value = false;
      draftFilters.value = [];
      draftSortField.value = "";
      draftSortOrder.value = "asc";
      if (instance.state.values.value.filters != null || instance.state.values.value.sort != null) {
        instance.state.setState({ filters: null, sort: null });
      }
    });

    return {
      rootRef,
      drawerSize,
      dialogWidth,
      t,
      isGraphMode,
      isTableMode,
      viewModeOptions,
      selectedClassKey,
      selectedNode,
      hasSelectedNode,
      nodeHeaderStatus,
      selectedNodeFallbackTitle,
      graphStatsLabel,
      graphSearchOpen,
      graphQueryInput,
      showGraphSearchPopover,
      onGraphQueryInput,
      onGraphQueryClear,
      focusSearchedInstance,
      clearSelectedNode,
      openSelectedNodeDetail,
      exploreSelectedNode,
      tableSearchInput,
      exportFileName,
      attributeOptions,
      onAttributesListed,
      filterOperators,
      filterDrawerOpen,
      draftFilters,
      draftSortField,
      draftSortOrder,
      activeFilterSortCount,
      openFilterDrawer,
      addFilterCondition,
      removeFilterCondition,
      applyFilters,
      resetAppliedFilters,
      onListClearFilters,
      openInstanceDetail,
      canConfigure,
      configureDialog,
      openConfigureDialog,
      handleConfigureDialogClose,
      onDetailPanelSaved,
      onDetailPanelCleared,
      openPanelsDirectory,
      refresh: () => instance.refreshObjects(),
    };
  },
});
