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
 * The ontology graph: composes official projections for counts (`ObjectCount`), resource lists (`ObjectList`), graph
 * canvas & shortest-path finding (`OntologyTypeGraph`), path pickers (`ReferencePicker`), and inspector details
 * (`ObjectHeader`, `TypedValue`, `ObjectRefCard`, `ObjectSummary`, `ObjectList`). It owns two sets of projections — the
 * business ontology and the four-layer platform ontology — and chooses between them by the `dataSource` it is given;
 * every member reads whichever set that source names. Visually it coordinates layout and navigation only: which
 * actions it offers follows what the selected element's own read published.
 */

const PROJECTION = "platform:ProductProjection";
const PRODUCT_PANEL = "platform:ProductPanel";
const APPLICATION = "platform:Application";
const AGENT_DEFINITION = "platform:AgentDefinition";
const OBJECT_TYPE = "platform:ObjectType";
const ONTOLOGY_TYPE = "platform:OntologyType";

/** The detail page for a product asset the graph names, when the platform publishes one for its class. */
function productAssetRoute(target) {
  const id = target?.primaryKey || target?.assetId;
  if (!id) return null;
  if (target.className === PROJECTION) return panelAddress("/ontology/projections/detail", { selected: id });
  if (target.className === PRODUCT_PANEL) return panelAddress("/ontology/panels/detail", { selected: id });
  if (target.className === APPLICATION) return panelAddress("/ontology/applications/detail", { selected: id });
  if (target.className === AGENT_DEFINITION) return panelAddress("/ontology/agents/detail", { selected: id });
  return null;
}

const BUSINESS_SOURCES = {
  objectStats: "builtin-product-7040c92e-9a3b-49ad-87a4-5ef4582abf2a",
  attributeStats: "builtin-product-7040c92e-9a3b-49ad-87a4-5ef4582abf2b",
  relationStats: "builtin-product-cd13e0f3-ab1f-497f-87bd-be1733fadb2a",
  objectList: "builtin-product-26d935eb-01ee-44ba-a389-b5c4f9277740",
  relationList: "builtin-product-9dc2abcb-1a64-4e1a-b919-0b8f69a02b65",
  relationEdges: "builtin-product-og-business-relation-edges",
  graph: "builtin-product-b24e84c6-ca27-4ed9-8479-79b076b0f378",
  pathFromPicker: "builtin-product-2e8cd535-4d3c-4851-88a4-840db0692aef",
  pathToPicker: "builtin-product-bcac70a2-e318-41b5-8d33-63014541076e",
  objectHeader: "builtin-product-d900ed11-4e30-4d7c-821a-4d08e964e39d",
  objectDesc: "builtin-product-ce68a32e-2c46-4b9a-a5ad-dd009a90594f",
  objectSummaryExtra: null,
  objectAttributes: "builtin-product-0e433496-05dc-41a6-8d22-696811abb84d",
  objectRelations: "builtin-product-47e75f93-efeb-4227-9079-b312605fbc00",
  objectReads: null,
  objectOperations: null,
  relationHeader: "builtin-product-a19a8a6e-cc18-41b7-bc42-a32cf61b3b6c",
  relationFrom: "builtin-product-e8bef137-dffe-47a0-a9f6-ed8645b8a2ad",
  relationName: "builtin-product-cc69b26b-9bc4-49e0-9400-66c5584e7606",
  relationTo: "builtin-product-9067cae3-cf39-4263-bbea-61f92c6af4f9",
};

const PLATFORM_SOURCES = {
  objectStats: "builtin-product-og-capability-type-count",
  attributeStats: null,
  relationStats: "builtin-product-og-capability-relation-count",
  objectList: "builtin-product-og-capability-type-list",
  relationList: "builtin-product-og-capability-relation-list",
  relationEdges: "builtin-product-og-capability-relation-edges",
  graph: "builtin-product-og-capability-graph",
  pathFromPicker: "builtin-product-og-capability-path-from",
  pathToPicker: "builtin-product-og-capability-path-to",
  objectHeader: "builtin-product-og-capability-object-header",
  objectDesc: "builtin-product-og-capability-object-description",
  objectSummaryExtra: "builtin-product-og-capability-object-summary",
  objectAttributes: "builtin-product-og-capability-object-properties",
  objectRelations: "builtin-product-og-capability-object-relations",
  objectReads: "builtin-product-og-capability-object-reads",
  objectOperations: "builtin-product-og-capability-object-operations",
  relationHeader: "builtin-product-og-capability-relation-header",
  relationFrom: "builtin-product-og-capability-relation-source",
  relationName: "builtin-product-og-capability-relation-name",
  relationTo: "builtin-product-og-capability-relation-targets",
};

const SOURCES = { business: BUSINESS_SOURCES, platform: PLATFORM_SOURCES };

const SELECTION_STATES = [
  "objectType", "relation", "pathFrom", "pathTo", "draftPathFrom", "draftPathTo", "highlightedNodes", "highlightedEdges",
  "platformObjectType",
];

await mountPanel({
  setup() {
    const { instance, refreshing, refreshObjects, t, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef, { token: "--og-narrow-breakpoint" });

    // Which projections every member reads: the panel's own choice, written before the first frame is drawn.
    function applySource(source) {
      const chosen = SOURCES[source] ?? BUSINESS_SOURCES;
      instance.state.setState(Object.fromEntries(Object.entries(chosen).map(([slot, id]) => [
        `${slot}Source`, id === null ? null : { className: PROJECTION, primaryKey: id },
      ])));
    }
    const dataSource = computed(() => instance.state.values.value.dataSource ?? "business");
    watch(dataSource, source => applySource(source), { immediate: true });
    // A selection of one ontology means nothing in the other: the reader's next click starts the other half clean.
    watch(dataSource, (_source, previous) => {
      if (previous === undefined) return;
      instance.state.setState({
        ...Object.fromEntries(SELECTION_STATES.map(name => [name, null])),
        highlightedNodes: [],
        highlightedEdges: [],
      });
    });
    const sourceChosen = name => instance.state.values.value[`${name}Source`] !== null;

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
    const objectHeaderModelingPath = usePanelOutput("objectHeader", "modelingPath");
    const objectHeaderDirectoryPath = usePanelOutput("objectHeader", "directoryPath");
    const relationHeaderStatus = usePanelOutput("relationHeader", "status");
    const relationHeaderLabel = usePanelOutput("relationHeader", "label");
    const relationHeaderError = usePanelOutput("relationHeader", "errorMessage");
    const relationHeaderModelingPath = usePanelOutput("relationHeader", "modelingPath");
    const objectAttributesTotal = usePanelOutput("objectAttributes", "total");
    const objectRelationsTotal = usePanelOutput("objectRelations", "total");

    const navigationError = ref("");
    const productGraphOpen = ref(false);
    const listEl = ref(null);

    // Opaque object reference lists reported by official ObjectList projections for canvas browse highlighting
    // and known-membership checks when distinguishing missing deep links from general read failures.
    const listedObjects = shallowRef([]);
    const listedRelations = shallowRef([]);
    const listedEdges = shallowRef([]);
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
    const requestedObject = computed(() => instance.state.values.value.objectType ?? null);
    const requestedRelation = computed(() => instance.state.values.value.relation ?? null);
    const requestedObjectKey = computed(() => requestedObject.value?.primaryKey ?? "");
    const requestedRelationKey = computed(() => requestedRelation.value?.primaryKey ?? "");
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
    // The four-layer half's own reads ask for the selected four-layer type alone, never for a business class.
    watch(
      requestedObject,
      (reference) => {
        const next = reference?.className === ONTOLOGY_TYPE ? { className: ONTOLOGY_TYPE, primaryKey: reference.primaryKey } : null;
        const current = instance.state.values.value.platformObjectType ?? null;
        if ((current?.className ?? null) === (next?.className ?? null) && (current?.primaryKey ?? null) === (next?.primaryKey ?? null)) return;
        instance.state.set("platformObjectType", next);
      },
      { immediate: true },
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

    // A relation kind that points at several types is drawn as one edge per target: choosing it on the left lights
    // every one of those edges at once. A kind with one target is the edge the selection already highlights.
    watch([requestedRelationKey, listedEdges], ([key, edges]) => {
      if (!key || browseHighlightActive) return;
      const matching = edges.filter(edge => edge.primaryKey === key || edge.primaryKey.startsWith(`${key}::`));
      if (matching.length < 2) return;
      instance.state.set("highlightedEdges", matching);
    }, { immediate: true });

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

    // The lists' read-only `listed` outputs: the object references each currently shows, drawn or not.
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
    watch(usePanelOutput("relationEdges", "listed"), (refs) => {
      listedEdges.value = Array.isArray(refs) ? refs : [];
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

    // Every address action below is offered only where the selected element's own read published one.
    const modelingPath = computed(() =>
      hasObjectSelection.value ? objectHeaderModelingPath.value : relationHeaderModelingPath.value,
    );
    const directoryPath = computed(() => (hasObjectSelection.value ? objectHeaderDirectoryPath.value : null));

    async function followAddress(address) {
      if (!address) return;
      navigationError.value = "";
      try {
        await instance.navigate(address);
      } catch {
        navigationError.value = t("ontologyGraph.navigationFailed");
      }
    }

    /** Opens the product asset graph dialog; the dialog closes itself when the reader follows an asset. */
    function openProductGraph() {
      navigationError.value = "";
      productGraphOpen.value = true;
    }

    /** Leaves the dialog for the asset the graph published, when that asset has a detail page. */
    function onOpenProductAsset(target) {
      const address = productAssetRoute(target);
      if (!address) return;
      productGraphOpen.value = false;
      void followAddress(address);
    }

    /** Asks for this type's instances: the outer panel takes the request when it bound the output, else this panel goes. */
    function exploreInstances() {
      const target = requestedObject.value;
      if (!target) return;
      if (instance.isOutputBound("exploreTypeRequest")) {
        instance.state.set("exploreTypeRequest", target);
        return;
      }
      void followAddress(panelAddress("/browser/data", { viewMode: "table", selectedClass: target }));
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
      hasAttributeStats: computed(() => sourceChosen("attributeStats")),
      hasObjectSummaryExtra: computed(() => sourceChosen("objectSummaryExtra")),
      hasObjectReads: computed(() => sourceChosen("objectReads")),
      hasObjectOperations: computed(() => sourceChosen("objectOperations")),
      objectAttributesTotal,
      objectRelationsTotal,
      canFindPath,
      findPath,
      modelingPath,
      directoryPath,
      openModeling: () => followAddress(modelingPath.value),
      openDirectory: () => followAddress(directoryPath.value),
      exploreInstances,
      navigationError,
      productGraphOpen,
      openProductGraph,
      onOpenProductAsset,
      refresh,
      retryDetail: () => void refreshObjects(),
    };
  },
});
