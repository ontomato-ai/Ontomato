import { computed, nextTick, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelNarrow } from "@ontomato/sdk/panel";

/*
 * Ontology Graph — Workbench Template.
 *
 * All business data is read and rendered strictly by official SDK projections (ObjectCount, ReferencePicker,
 * ObjectList, ObjectGraph, ObjectHeader, ObjectSummary). All shared interaction state lives in panel.json so
 * human readers, deep links, and the page assistant observe and drive one source of truth.
 */

const OBJECT_TYPE = "platform:ObjectType";

function refsSignature(list) {
  return Array.isArray(list) ? list.map((item) => `${item?.className ?? ""}:${item?.primaryKey ?? ""}`).join("|") : "";
}

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const state = instance.state.values;

    const rootRef = ref(null);
    const detailScrollRef = ref(null);
    const narrow = usePanelNarrow(rootRef, { token: "--workbench-narrow-breakpoint" });

    // Local presentation toggles: desktop left-pane collapse and mutually exclusive narrow overlay drawer.
    const leftCollapsed = ref(false);
    const narrowDrawer = ref("none");
    const navigationError = ref("");

    // Latest locally-filtered references emitted by the two catalog ObjectList members.
    const listedObjects = ref([]);
    const listedRelations = ref([]);
    const objectsReady = ref(false);
    const relationsReady = ref(false);

    const selectedObjectRef = computed(() => state.value.objectType ?? null);
    const selectedRelationRef = computed(() => state.value.relation ?? null);
    const hasSelection = computed(() => Boolean(selectedObjectRef.value || selectedRelationRef.value));

    const search = computed({
      get: () => state.value.search ?? "",
      set: (value) => instance.state.set("search", value ?? ""),
    });
    const searchTerm = computed(() => search.value.trim());

    const scope = computed({
      get: () => {
        const current = state.value.scope;
        return current === "objects" || current === "relations" ? current : "all";
      },
      set: (value) => {
        const next = value === "objects" || value === "relations" ? value : "all";
        instance.state.set("scope", next);
      },
    });

    const scopeOptions = computed(() => [
      { value: "all", label: t("og.scope.all") },
      { value: "objects", label: t("og.scope.objects") },
      { value: "relations", label: t("og.scope.relations") },
    ]);

    const hasPathEndpoints = computed(() => Boolean(state.value.pathFrom?.primaryKey || state.value.pathTo?.primaryKey));

    // Three-pane visibility state machine:
    // - Wide: left pane collapsible, right pane collapsed by default and auto-opened on selection.
    // - Narrow: at most one overlay drawer open at a time (opening left closes right and vice versa).
    const showLeftPane = computed(() => (narrow.value ? narrowDrawer.value === "left" : !leftCollapsed.value));
    const showRightPane = computed(() => hasSelection.value && (!narrow.value || narrowDrawer.value === "right"));

    const leftToggleText = computed(() => (narrow.value ? t("og.explorer.toggle") : showLeftPane.value ? t("og.explorer.collapse") : t("og.explorer.expand")));
    const leftToggleLabel = computed(() => (showLeftPane.value ? t("og.explorer.collapse") : t("og.explorer.expand")));

    // In "all" scope while searching, avoid rendering two empty lists stacked together.
    const showUnifiedSearchEmpty = computed(
      () =>
        scope.value === "all"
        && searchTerm.value !== ""
        && objectsReady.value
        && relationsReady.value
        && listedObjects.value.length === 0
        && listedRelations.value.length === 0,
    );
    const showObjectsSection = computed(() => {
      if (scope.value === "relations") return false;
      if (scope.value === "objects") return true;
      if (!searchTerm.value || !objectsReady.value) return true;
      return listedObjects.value.length > 0;
    });
    const showRelationsSection = computed(() => {
      if (scope.value === "objects") return false;
      if (scope.value === "relations") return true;
      if (!searchTerm.value || !relationsReady.value) return true;
      return listedRelations.value.length > 0;
    });

    function scrollDetailToTop() {
      void nextTick(() => {
        if (detailScrollRef.value) detailScrollRef.value.scrollTop = 0;
      });
    }

    function toggleLeftPane() {
      if (narrow.value) {
        narrowDrawer.value = narrowDrawer.value === "left" ? "none" : "left";
      } else {
        leftCollapsed.value = !leftCollapsed.value;
      }
    }

    function clearSelection() {
      navigationError.value = "";
      if (narrowDrawer.value === "right") narrowDrawer.value = "none";
      if (state.value.objectType || state.value.relation || state.value.selectedClassName) {
        instance.state.setState({ objectType: null, relation: null, selectedClassName: null });
      }
    }

    // Host back stack (LIFO):
    // - Detail pane (wide or narrow): closes on Escape, browser Back, or the header Close button.
    // - Narrow left catalog overlay: closes on Escape without adding a browser history entry.
    const detailBack = usePanelBack(hasSelection, clearSelection);
    const leftDrawerBack = usePanelBack(
      () => narrow.value && narrowDrawer.value === "left",
      () => {
        narrowDrawer.value = "none";
      },
      { pushHistory: false },
    );

    function closeNarrowDrawer() {
      if (narrowDrawer.value === "right") {
        closeDetail();
        return;
      }
      if (narrow.value && narrowDrawer.value === "left") {
        void leftDrawerBack.back();
        return;
      }
      narrowDrawer.value = "none";
    }

    function closeDetail() {
      if (hasSelection.value) {
        void detailBack.back();
        return;
      }
      clearSelection();
    }

    function clearSearch() {
      search.value = "";
    }

    function clearPath() {
      if (!hasPathEndpoints.value) return;
      instance.state.setState({ pathFrom: null, pathTo: null });
    }

    // Keep objectType and relation mutually exclusive, keep selectedClassName synced for detail list reads,
    // and open the narrow right overlay automatically when a selection is made.
    watch(
      () => state.value.objectType?.primaryKey ?? "",
      (next) => {
        const expectedClassName = next || null;
        const patch = {};
        if ((state.value.selectedClassName ?? null) !== expectedClassName) {
          patch.selectedClassName = expectedClassName;
        }
        if (next) {
          navigationError.value = "";
          if (state.value.relation) patch.relation = null;
          scrollDetailToTop();
          if (narrow.value) narrowDrawer.value = "right";
        } else if (!state.value.relation && narrowDrawer.value === "right") {
          narrowDrawer.value = "none";
        }
        if (Object.keys(patch).length) instance.state.setState(patch);
      },
      { immediate: true },
    );

    watch(
      () => state.value.relation?.primaryKey ?? "",
      (next) => {
        if (next) {
          navigationError.value = "";
          const patch = {};
          if (state.value.objectType) patch.objectType = null;
          if (state.value.selectedClassName) patch.selectedClassName = null;
          if (Object.keys(patch).length) instance.state.setState(patch);
          scrollDetailToTop();
          if (narrow.value) narrowDrawer.value = "right";
        } else if (!state.value.objectType && narrowDrawer.value === "right") {
          narrowDrawer.value = "none";
        }
      },
      { immediate: true },
    );

    // When container transitions from wide to narrow, start clean on the canvas with no stacked overlays.
    watch(narrow, (isNarrow) => {
      if (!isNarrow) narrowDrawer.value = "none";
    });

    // Only highlight graph elements when search text is non-empty; switching scope with empty search never dims the graph.
    function syncSearchHighlights() {
      if (!searchTerm.value) {
        if ((state.value.highlightedNodes?.length ?? 0) > 0 || (state.value.highlightedEdges?.length ?? 0) > 0) {
          instance.state.setState({ highlightedNodes: [], highlightedEdges: [] });
        }
        return;
      }
      const nextNodes = scope.value === "relations" ? [] : listedObjects.value;
      const nextEdges = scope.value === "objects" ? [] : listedRelations.value;
      const sameNodes = refsSignature(state.value.highlightedNodes) === refsSignature(nextNodes);
      const sameEdges = refsSignature(state.value.highlightedEdges) === refsSignature(nextEdges);
      const needsPathClear = hasPathEndpoints.value;
      if (sameNodes && sameEdges && !needsPathClear) return;
      instance.state.setState({
        ...(needsPathClear ? { pathFrom: null, pathTo: null } : {}),
        highlightedNodes: nextNodes,
        highlightedEdges: nextEdges,
      });
    }

    function onObjectsListed(refs) {
      objectsReady.value = true;
      listedObjects.value = Array.isArray(refs) ? refs : [];
      syncSearchHighlights();
    }

    function onRelationsListed(refs) {
      relationsReady.value = true;
      listedRelations.value = Array.isArray(refs) ? refs : [];
      syncSearchHighlights();
    }

    watch([searchTerm, scope], () => {
      syncSearchHighlights();
    });

    // When both directed-path endpoints are set, clear any search highlights so path mode stays visually distinct.
    watch(
      () => [state.value.pathFrom?.primaryKey ?? "", state.value.pathTo?.primaryKey ?? ""],
      ([from, to]) => {
        if (!from || !to) return;
        if ((state.value.highlightedNodes?.length ?? 0) > 0 || (state.value.highlightedEdges?.length ?? 0) > 0) {
          instance.state.setState({ highlightedNodes: [], highlightedEdges: [] });
        }
      },
    );

    function onSummaryNavigate(reference) {
      if (!reference?.primaryKey) return;
      navigationError.value = "";
      if (reference.className === OBJECT_TYPE) {
        instance.state.setState({
          objectType: { className: OBJECT_TYPE, primaryKey: reference.primaryKey },
          relation: null,
          selectedClassName: reference.primaryKey,
        });
      }
    }

    async function openModeling() {
      navigationError.value = "";
      const target = selectedObjectRef.value
        ? { focus: "object", id: selectedObjectRef.value.primaryKey }
        : selectedRelationRef.value
          ? { focus: "relation", id: selectedRelationRef.value.primaryKey }
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
      rootRef,
      detailScrollRef,
      narrow,
      narrowDrawer,
      search,
      scope,
      scopeOptions,
      selectedObjectRef,
      selectedRelationRef,
      hasSelection,
      hasPathEndpoints,
      showLeftPane,
      showRightPane,
      leftToggleText,
      leftToggleLabel,
      listedObjects,
      listedRelations,
      objectsReady,
      relationsReady,
      showUnifiedSearchEmpty,
      showObjectsSection,
      showRelationsSection,
      navigationError,
      toggleLeftPane,
      closeNarrowDrawer,
      closeDetail,
      clearSearch,
      clearPath,
      onObjectsListed,
      onRelationsListed,
      onSummaryNavigate,
      openModeling,
    };
  },
});
