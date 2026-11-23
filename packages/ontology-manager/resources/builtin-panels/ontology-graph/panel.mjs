import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * The ontology graph: composes official projections for counts (`ObjectCount`), resource lists (`ObjectList`),
 * graph canvas & shortest-path finding (`ObjectGraph`), path pickers (`ReferencePicker`), and inspector details
 * (`ObjectHeader`, `TypedValue`, `ObjectRefCard`, `ObjectList`). Reads zero raw record fields and performs zero
 * business calculations; coordinates only public panel state, visual layout, and navigation.
 */

const OBJECT_TYPE = "platform:ObjectType";

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "objects", label: "对象类型" },
  { value: "relations", label: "关系类型" },
];

await mountPanel({
  setup() {
    const { instance } = usePanelContext();

    // Read-only outputs published by official projections (no raw record reads).
    const graphStatus = usePanelOutput("graph", "status");
    const graphError = usePanelOutput("graph", "error");
    const graphPathStatus = usePanelOutput("graph", "pathStatus");
    const graphPathHops = usePanelOutput("graph", "pathHops");

    const objectListStatus = usePanelOutput("objectList", "status");
    const relationListStatus = usePanelOutput("relationList", "status");
    const objectFilteredCount = usePanelOutput("objectList", "filteredCount");
    const relationFilteredCount = usePanelOutput("relationList", "filteredCount");

    const objectHeaderStatus = usePanelOutput("objectHeader", "status");
    const relationHeaderStatus = usePanelOutput("relationHeader", "status");
    const objectAttributesTotal = usePanelOutput("objectAttributes", "total");
    const objectRelationsTotal = usePanelOutput("objectRelations", "total");

    const toast = ref(null);
    const navigationError = ref("");
    const listEl = ref(null);

    // Opaque object reference lists reported by official ObjectList projections for canvas browse highlighting.
    const listedObjects = shallowRef([]);
    const listedRelations = shallowRef([]);
    let browseHighlightActive = false;

    let toastTimer = null;
    function showToast(type, text) {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { type, text };
      toastTimer = setTimeout(() => {
        toast.value = null;
        toastTimer = null;
      }, 3200);
    }
    onBeforeUnmount(() => {
      if (toastTimer) clearTimeout(toastTimer);
    });

    // Public state: selection, search, type filter, highlights and path endpoints (all readable/writable by the page agent).
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value ?? ""),
    });
    const filter = computed({
      get: () => {
        const value = instance.state.values.value.filter;
        return value === "objects" || value === "relations" ? value : "all";
      },
      set: (value) => instance.state.set("filter", value === "objects" || value === "relations" ? value : "all"),
    });
    const requestedObjectKey = computed(() => instance.state.values.value.objectType?.primaryKey ?? "");
    const requestedRelationKey = computed(() => instance.state.values.value.relation?.primaryKey ?? "");
    const hasObjectSelection = computed(() => Boolean(requestedObjectKey.value));
    const hasRelationSelection = computed(() => !hasObjectSelection.value && Boolean(requestedRelationKey.value));
    const canFindPath = computed(() =>
      Boolean(instance.state.values.value.pathFrom && instance.state.values.value.pathTo),
    );

    const loading = computed(
      () =>
        graphStatus.value === null ||
        graphStatus.value === "loading" ||
        objectListStatus.value === "loading" ||
        relationListStatus.value === "loading",
    );
    const graphEmpty = computed(() => graphStatus.value === "empty");
    const readError = computed(() => (graphStatus.value === "error" && graphError.value ? String(graphError.value) : ""));

    const isMissingObject = computed(() => hasObjectSelection.value && objectHeaderStatus.value === "error");
    const isMissingRelation = computed(() => hasRelationSelection.value && relationHeaderStatus.value === "error");
    const objectReady = computed(() => hasObjectSelection.value && objectHeaderStatus.value === "ready");
    const relationReady = computed(() => hasRelationSelection.value && relationHeaderStatus.value === "ready");

    const showObjectsSection = computed(
      () => filter.value !== "relations" && (objectFilteredCount.value ?? 0) > 0,
    );
    const showRelationsSection = computed(
      () => filter.value !== "objects" && (relationFilteredCount.value ?? 0) > 0,
    );
    const listEmpty = computed(
      () =>
        !loading.value &&
        objectListStatus.value !== null &&
        relationListStatus.value !== null &&
        !showObjectsSection.value &&
        !showRelationsSection.value,
    );

    function syncBrowseHighlight() {
      const hasQuery = search.value.trim() !== "" || filter.value !== "all";
      if (!hasQuery) {
        const curNodes = instance.state.values.value.highlightedNodes ?? [];
        const curEdges = instance.state.values.value.highlightedEdges ?? [];
        if (curNodes.length || curEdges.length) {
          instance.state.setState({ highlightedNodes: [], highlightedEdges: [] });
        }
        return;
      }
      instance.state.setState({
        pathFrom: null,
        pathTo: null,
        highlightedNodes: filter.value === "relations" ? [] : [...listedObjects.value],
        highlightedEdges: filter.value === "objects" ? [] : [...listedRelations.value],
      });
    }

    // Scroll the resource explorer back to top and refresh canvas highlights whenever search or filter changes.
    watch(
      [search, filter],
      () => {
        if (listEl.value) listEl.value.scrollTop = 0;
        const hasQuery = search.value.trim() !== "" || filter.value !== "all";
        browseHighlightActive = hasQuery;
        syncBrowseHighlight();
      },
      { immediate: true },
    );

    function onObjectsListed(refs) {
      listedObjects.value = Array.isArray(refs) ? refs : [];
      if (browseHighlightActive) syncBrowseHighlight();
    }

    function onRelationsListed(refs) {
      listedRelations.value = Array.isArray(refs) ? refs : [];
      if (browseHighlightActive) syncBrowseHighlight();
    }

    const setFilter = (value) => {
      filter.value = value;
    };

    const setSearch = (value) => {
      search.value = value ?? "";
    };

    function onObjectChosen() {
      navigationError.value = "";
      browseHighlightActive = false;
      instance.state.setState({
        relation: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    function onRelationChosen() {
      navigationError.value = "";
      browseHighlightActive = false;
      instance.state.setState({
        objectType: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    function onNavigateObject(reference) {
      if (!reference?.primaryKey) return;
      navigationError.value = "";
      browseHighlightActive = false;
      instance.state.setState({
        objectType: { className: reference.className || OBJECT_TYPE, primaryKey: reference.primaryKey },
        relation: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    function clearSelection() {
      navigationError.value = "";
      browseHighlightActive = false;
      instance.state.setState({
        objectType: null,
        relation: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    async function findPath() {
      if (!canFindPath.value) return;
      browseHighlightActive = false;
      instance.state.setState({
        objectType: null,
        relation: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
      await nextTick();
      const status = graphPathStatus.value;
      if (status === "found" || status === "same-node") {
        showToast("success", `已找到 ${graphPathHops.value ?? 0} 跳路径`);
      } else if (status === "not-found") {
        showToast("warning", "未找到可达路径");
      }
    }

    // Esc or browser Back clears an active object/relation selection cleanly.
    usePanelBack(
      () => Boolean(requestedObjectKey.value || requestedRelationKey.value),
      clearSelection,
      { pushHistory: true },
    );

    async function openModeling() {
      navigationError.value = "";
      const target = requestedObjectKey.value
        ? { focus: "object", id: requestedObjectKey.value }
        : requestedRelationKey.value
          ? { focus: "relation", id: requestedRelationKey.value }
          : null;
      if (!target) return;
      const address = `/ontology/visual-modeling?focus=${target.focus}&id=${encodeURIComponent(target.id)}&back=playground`;
      try {
        await instance.navigate(address);
      } catch (reason) {
        navigationError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    return {
      loading,
      graphEmpty,
      readError,
      search,
      setSearch,
      filter,
      filterOptions: FILTERS,
      setFilter,
      listEl,
      showObjectsSection,
      showRelationsSection,
      objectFilteredCount,
      relationFilteredCount,
      listEmpty,
      onObjectsListed,
      onRelationsListed,
      onObjectChosen,
      onRelationChosen,
      onNavigateObject,
      clearSelection,
      requestedObjectKey,
      requestedRelationKey,
      hasObjectSelection,
      hasRelationSelection,
      isMissingObject,
      isMissingRelation,
      objectReady,
      relationReady,
      objectAttributesTotal,
      objectRelationsTotal,
      canFindPath,
      toast,
      findPath,
      openModeling,
      navigationError,
      refresh: () => instance.refreshObjects(),
    };
  },
});
