import { computed, nextTick, ref, shallowRef, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

/*
 * The ontology graph: composes official projections for counts (`ObjectCount`), resource lists (`ObjectList`),
 * graph canvas & shortest-path finding (`OntologyModelGraph`), product asset overview (`ProductAssetGraph`),
 * path pickers (`ReferencePicker`), and inspector details (`ObjectHeader`, `TypedValue`, `ObjectRefCard`,
 * `ObjectList`). Reads zero raw record fields and performs zero business calculations; coordinates only public
 * panel state, visual layout, and navigation.
 */

const OBJECT_TYPE = "platform:ObjectType";
const PRODUCT_PROJECTION = "platform:ProductProjection";
const PRODUCT_PANEL = "platform:ProductPanel";
const APPLICATION = "platform:Application";
const AGENT_DEFINITION = "platform:AgentDefinition";

function productAssetRoute(target) {
  const id = target?.primaryKey || target?.assetId;
  if (!id) return null;
  if (target.className === PRODUCT_PROJECTION) {
    return panelAddress("/ontology/projections/detail", { selected: id });
  }
  if (target.className === PRODUCT_PANEL) {
    return panelAddress("/ontology/panels/detail", { selected: id });
  }
  if (target.className === APPLICATION) {
    return panelAddress("/ontology/applications/detail", { selected: id });
  }
  if (target.className === AGENT_DEFINITION) {
    return panelAddress("/ontology/agents/detail", { selected: id });
  }
  return null;
}

await mountPanel({
  setup() {
    const { instance, refreshing, refreshObjects, t, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef, { token: "--og-narrow-breakpoint" });

    // Read-only outputs published by official projections (no raw record reads).
    const graphStatus = usePanelOutput("graph", "status");
    const graphPathStatus = usePanelOutput("graph", "pathStatus");
    const graphPathMessage = usePanelOutput("graph", "pathMessage");
    const graphPathHops = usePanelOutput("graph", "pathHops");

    const objectListStatus = usePanelOutput("objectList", "status");
    const relationListStatus = usePanelOutput("relationList", "status");
    const objectFilteredCount = usePanelOutput("objectList", "filteredCount");
    const relationFilteredCount = usePanelOutput("relationList", "filteredCount");

    const objectHeaderStatus = usePanelOutput("objectHeader", "status");
    const objectHeaderLabel = usePanelOutput("objectHeader", "label");
    const objectHeaderError = usePanelOutput("objectHeader", "errorMessage");
    const relationHeaderStatus = usePanelOutput("relationHeader", "status");
    const relationHeaderLabel = usePanelOutput("relationHeader", "label");
    const relationHeaderError = usePanelOutput("relationHeader", "errorMessage");
    const objectAttributesTotal = usePanelOutput("objectAttributes", "total");
    const objectRelationsTotal = usePanelOutput("objectRelations", "total");

    const navigationError = ref("");
    const productGraphOpen = ref(false);
    const listEl = ref(null);

    // Opaque object reference lists reported by official ObjectList projections for canvas browse highlighting
    // and known-membership checks when distinguishing missing deep links from general read failures.
    const listedObjects = shallowRef([]);
    const listedRelations = shallowRef([]);
    const knownObjectKeys = shallowRef(null);
    const knownRelationKeys = shallowRef(null);
    let browseHighlightActive = false;

    const filterOptions = computed(() => [
      { value: "all", label: t("ontologyGraph.filterAll") },
      { value: "objects", label: t("ontologyGraph.objectTypes") },
      { value: "relations", label: t("ontologyGraph.relationTypes") },
    ]);

    const graphHint = computed(() => (narrow.value ? "" : t("ontologyGraph.graphHint")));

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
      Boolean(instance.state.values.value.draftPathFrom && instance.state.values.value.draftPathTo),
    );

    const loading = computed(
      () =>
        graphStatus.value === null ||
        graphStatus.value === "loading" ||
        objectListStatus.value === "loading" ||
        relationListStatus.value === "loading",
    );
    const graphEmpty = computed(() => graphStatus.value === "empty");
    const graphEverReady = ref(false);
    watch(
      graphStatus,
      (status) => {
        if (status === "ready") {
          graphEverReady.value = true;
        } else if (status === "empty" || status === "forbidden") {
          graphEverReady.value = false;
        }
      },
      { immediate: true },
    );
    const readError = computed(() =>
      graphStatus.value === "error" ? t("ontologyGraph.graphReadFailedDesc") : "",
    );
    const showGraphWorkspace = computed(() => !readError.value || graphEverReady.value);
    const safeObjectHeaderError = computed(() => t("ontologyGraph.readFailedFallback"));
    const safeRelationHeaderError = computed(() => t("ontologyGraph.readFailedFallback"));

    // Mirror SDK #303 `previous` semantics: once the current target has loaded, a same-target reread failure
    // keeps the element details visible with an error banner instead of mislabelling it as deleted.
    const objectEverReady = ref(false);
    const lastObjectLabel = ref("");
    const relationEverReady = ref(false);
    const lastRelationLabel = ref("");

    watch(requestedObjectKey, () => {
      objectEverReady.value = false;
      lastObjectLabel.value = "";
    });
    watch(
      [objectHeaderStatus, objectHeaderLabel],
      ([status, label]) => {
        if (!requestedObjectKey.value) return;
        if (status === "ready") {
          objectEverReady.value = true;
          if (typeof label === "string" && label) lastObjectLabel.value = label;
        } else if (status === "forbidden" || status === "empty") {
          objectEverReady.value = false;
        }
      },
      { immediate: true },
    );

    watch(requestedRelationKey, () => {
      relationEverReady.value = false;
      lastRelationLabel.value = "";
    });
    watch(
      [relationHeaderStatus, relationHeaderLabel],
      ([status, label]) => {
        if (!requestedRelationKey.value) return;
        if (status === "ready") {
          relationEverReady.value = true;
          if (typeof label === "string" && label) lastRelationLabel.value = label;
        } else if (status === "forbidden" || status === "empty") {
          relationEverReady.value = false;
        }
      },
      { immediate: true },
    );

    const isForbiddenObject = computed(() => hasObjectSelection.value && objectHeaderStatus.value === "forbidden");
    const isMissingObject = computed(() => {
      if (!hasObjectSelection.value) return false;
      if (objectHeaderStatus.value === "empty") return true;
      return (
        objectHeaderStatus.value === "error" &&
        !objectEverReady.value &&
        knownObjectKeys.value !== null &&
        !knownObjectKeys.value.has(requestedObjectKey.value)
      );
    });
    const isErrorObject = computed(
      () => hasObjectSelection.value && objectHeaderStatus.value === "error" && !isMissingObject.value,
    );
    const objectReady = computed(
      () => hasObjectSelection.value && (objectHeaderStatus.value === "ready" || objectEverReady.value) && !isForbiddenObject.value && !isMissingObject.value,
    );
    const showObjectStateBox = computed(
      () => isForbiddenObject.value || isMissingObject.value || (isErrorObject.value && !objectEverReady.value),
    );

    const isForbiddenRelation = computed(() => hasRelationSelection.value && relationHeaderStatus.value === "forbidden");
    const isMissingRelation = computed(() => {
      if (!hasRelationSelection.value) return false;
      if (relationHeaderStatus.value === "empty") return true;
      return (
        relationHeaderStatus.value === "error" &&
        !relationEverReady.value &&
        knownRelationKeys.value !== null &&
        !knownRelationKeys.value.has(requestedRelationKey.value)
      );
    });
    const isErrorRelation = computed(
      () => hasRelationSelection.value && relationHeaderStatus.value === "error" && !isMissingRelation.value,
    );
    const relationReady = computed(
      () => hasRelationSelection.value && (relationHeaderStatus.value === "ready" || relationEverReady.value) && !isForbiddenRelation.value && !isMissingRelation.value,
    );
    const showRelationStateBox = computed(
      () => isForbiddenRelation.value || isMissingRelation.value || (isErrorRelation.value && !relationEverReady.value),
    );

    const showObjectsSection = computed(
      () => filter.value !== "relations" && (objectFilteredCount.value ?? 0) > 0,
    );
    const showRelationsSection = computed(
      () => filter.value !== "objects" && (relationFilteredCount.value ?? 0) > 0,
    );
    const listEmpty = computed(() => {
      if (loading.value) return false;
      if (filter.value === "objects") return (objectFilteredCount.value ?? 0) === 0;
      if (filter.value === "relations") return (relationFilteredCount.value ?? 0) === 0;
      return (objectFilteredCount.value ?? 0) === 0 && (relationFilteredCount.value ?? 0) === 0;
    });

    function syncBrowseHighlight() {
      const hasQuery = search.value.trim() !== "" || filter.value !== "all";
      if (!hasQuery) {
        if (
          (instance.state.values.value.highlightedNodes?.length ?? 0) > 0 ||
          (instance.state.values.value.highlightedEdges?.length ?? 0) > 0
        ) {
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

    // Mirror externally committed path endpoints into the pending pickers without clearing pickers on deselection.
    watch(
      [() => instance.state.values.value.pathFrom, () => instance.state.values.value.pathTo],
      ([from, to]) => {
        const patch = {};
        if (from && from.primaryKey !== instance.state.values.value.draftPathFrom?.primaryKey) {
          patch.draftPathFrom = from;
        }
        if (to && to.primaryKey !== instance.state.values.value.draftPathTo?.primaryKey) {
          patch.draftPathTo = to;
        }
        if (Object.keys(patch).length > 0) {
          instance.state.setState(patch);
        }
      },
      { immediate: true },
    );

    // Clear active path/search highlights whenever a node or edge is selected (whether via list or canvas click),
    // while keeping the pending path-finder picker values intact.
    watch([requestedObjectKey, requestedRelationKey], ([objKey, relKey]) => {
      if (!objKey && !relKey) return;
      navigationError.value = "";
      browseHighlightActive = false;
      const values = instance.state.values.value;
      if (
        values.pathFrom !== null ||
        values.pathTo !== null ||
        (values.highlightedNodes?.length ?? 0) > 0 ||
        (values.highlightedEdges?.length ?? 0) > 0
      ) {
        instance.state.setState({
          pathFrom: null,
          pathTo: null,
          highlightedNodes: [],
          highlightedEdges: [],
        });
      }
    });

    function updateKnownObjectKeys() {
      if (search.value.trim() !== "") return;
      if (objectListStatus.value === "ready") {
        knownObjectKeys.value = new Set(listedObjects.value.map((item) => item.primaryKey));
      } else if (objectListStatus.value === "empty") {
        knownObjectKeys.value = new Set();
      }
    }

    function updateKnownRelationKeys() {
      if (search.value.trim() !== "") return;
      if (relationListStatus.value === "ready") {
        knownRelationKeys.value = new Set(listedRelations.value.map((item) => item.primaryKey));
      } else if (relationListStatus.value === "empty") {
        knownRelationKeys.value = new Set();
      }
    }

    watch(objectListStatus, updateKnownObjectKeys, { immediate: true });
    watch(relationListStatus, updateKnownRelationKeys, { immediate: true });

    watch(usePanelOutput("objectList", "listed"), (refs) => {
      listedObjects.value = Array.isArray(refs) ? refs : [];
      updateKnownObjectKeys();
      if (browseHighlightActive) syncBrowseHighlight();
    });

    watch(usePanelOutput("relationList", "listed"), (refs) => {
      listedRelations.value = Array.isArray(refs) ? refs : [];
      updateKnownRelationKeys();
      if (browseHighlightActive) syncBrowseHighlight();
    });

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
      const from = instance.state.values.value.draftPathFrom;
      const to = instance.state.values.value.draftPathTo;
      if (!from || !to) return;
      browseHighlightActive = false;
      instance.state.setState({
        objectType: null,
        relation: null,
        highlightedNodes: [],
        highlightedEdges: [],
        pathFrom: from,
        pathTo: to,
      });
      await nextTick();
      const status = graphPathStatus.value;
      if (status === "found" || status === "same-node") {
        notify({ kind: "success", text: t("ontologyGraph.pathFound", { count: graphPathHops.value ?? 0 }) });
      } else if (status === "not-found") {
        notify({ kind: "warning", text: String(graphPathMessage.value || t("ontologyGraph.pathNotFound")) });
      }
    }

    async function refresh() {
      if (refreshing.value) return;
      navigationError.value = "";
      await refreshObjects();
      await nextTick();
      if (
        graphStatus.value !== "error" &&
        objectListStatus.value !== "error" &&
        relationListStatus.value !== "error"
      ) {
        clearSelection();
      }
    }

    // Esc or browser Back clears an active object/relation selection cleanly; closes the product graph dialog first.
    usePanelBack(
      () => Boolean(requestedObjectKey.value || requestedRelationKey.value),
      clearSelection,
      { pushHistory: true },
    );
    usePanelBack(
      () => productGraphOpen.value,
      () => {
        productGraphOpen.value = false;
      },
      { pushHistory: false },
    );

    function openProductGraph() {
      navigationError.value = "";
      productGraphOpen.value = true;
    }

    async function onOpenProductAsset(target) {
      const address = productAssetRoute(target);
      if (!address) return;
      navigationError.value = "";
      productGraphOpen.value = false;
      try {
        await instance.navigate(address);
      } catch {
        navigationError.value = t("ontologyGraph.navigationFailed");
      }
    }

    async function openModeling() {
      navigationError.value = "";
      const target = requestedObjectKey.value
        ? { focus: "object", id: requestedObjectKey.value }
        : requestedRelationKey.value
          ? { focus: "relation", id: requestedRelationKey.value }
          : null;
      if (!target) return;
      const address = panelAddress(
        "/ontology/visual-modeling",
        target.focus === "relation"
          ? { selectedEdge: target.id, back: "playground" }
          : { selectedNode: target.id, back: "playground" },
      );
      try {
        await instance.navigate(address);
      } catch {
        navigationError.value = t("ontologyGraph.navigationFailed");
      }
    }

    return {
      t,
      rootRef,
      loading,
      refreshing,
      graphEmpty,
      graphEverReady,
      graphHint,
      readError,
      showGraphWorkspace,
      safeObjectHeaderError,
      safeRelationHeaderError,
      productGraphOpen,
      openProductGraph,
      onOpenProductAsset,
      search,
      setSearch,
      filter,
      filterOptions,
      setFilter,
      listEl,
      showObjectsSection,
      showRelationsSection,
      objectFilteredCount,
      relationFilteredCount,
      listEmpty,
      onObjectChosen,
      onRelationChosen,
      onNavigateObject,
      clearSelection,
      requestedObjectKey,
      requestedRelationKey,
      hasObjectSelection,
      hasRelationSelection,
      objectEverReady,
      lastObjectLabel,
      relationEverReady,
      lastRelationLabel,
      isForbiddenObject,
      isMissingObject,
      isErrorObject,
      showObjectStateBox,
      objectHeaderError,
      isForbiddenRelation,
      isMissingRelation,
      isErrorRelation,
      showRelationStateBox,
      relationHeaderError,
      objectReady,
      relationReady,
      objectAttributesTotal,
      objectRelationsTotal,
      canFindPath,
      findPath,
      openModeling,
      navigationError,
      refresh,
      retryDetail: () => void refreshObjects(),
    };
  },
});
