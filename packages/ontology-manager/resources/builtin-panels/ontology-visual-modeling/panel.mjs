import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t, navigate } = usePanelContext();
    const values = instance.state.values;
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const selectedNode = computed(() => values.value.selectedNode ?? null);
    const selectedNodeKey = computed(() => selectedNode.value?.primaryKey ?? "");
    const selectedEdge = computed(() => values.value.selectedEdge ?? null);
    const selectedAttribute = computed(() => values.value.selectedAttribute ?? null);
    const dialog = computed(() => values.value.dialog ?? null);

    // Read-only outputs from official projections (zero raw record reads).
    const nodeHeaderStatus = usePanelOutput("nodeHeader", "status");
    const nodeHeaderLabel = usePanelOutput("nodeHeader", "label");
    const edgeHeaderStatus = usePanelOutput("edgeHeader", "status");
    const edgeHeaderLabel = usePanelOutput("edgeHeader", "label");
    const attributesOutputTotal = usePanelOutput("attributes", "total");
    const attributesListedCount = ref(null);
    const attributesTotal = computed(() => attributesOutputTotal.value ?? attributesListedCount.value);
    const onAttributesListed = (refs) => {
      attributesListedCount.value = Array.isArray(refs) ? refs.length : null;
    };

    const selectedNodeLabel = computed(() =>
      (typeof nodeHeaderLabel.value === "string" && nodeHeaderLabel.value) || selectedNode.value?.primaryKey || "",
    );
    const selectedEdgeLabel = computed(() =>
      (typeof edgeHeaderLabel.value === "string" && edgeHeaderLabel.value) || selectedEdge.value?.primaryKey || "",
    );
    const nodeMissing = computed(() =>
      Boolean(selectedNode.value) && (nodeHeaderStatus.value === "error" || nodeHeaderStatus.value === "forbidden"),
    );
    const edgeMissing = computed(() =>
      Boolean(selectedEdge.value) && (edgeHeaderStatus.value === "error" || edgeHeaderStatus.value === "forbidden"),
    );
    const nodeEverReady = ref(false);
    const edgeEverReady = ref(false);

    const clearSelection = () => {
      instance.state.setState({
        selectedNode: null,
        selectedEdge: null,
        selectedAttribute: null,
      });
    };

    // Keep node/edge selection mutually exclusive (latest patched wins), reset ready tracking on target switch,
    // and clear selectedAttribute unless preserved on initial mount or supplied in the same atomic patch.
    watch(
      [() => selectedNode.value?.primaryKey ?? null, () => selectedEdge.value?.primaryKey ?? null],
      ([nextNodeKey, nextEdgeKey], prev) => {
        const [prevNodeKey, prevEdgeKey] = prev ?? [undefined, undefined];
        const patched = instance.state.lastPatchedKeys;

        if (nextNodeKey !== prevNodeKey) {
          nodeEverReady.value = false;
          attributesListedCount.value = null;
        }
        if (nextEdgeKey !== prevEdgeKey) edgeEverReady.value = false;

        const patch = {};
        let effectiveNodeKey = nextNodeKey;

        if (nextNodeKey && nextEdgeKey) {
          if (patched.has("selectedEdge") && !patched.has("selectedNode")) {
            patch.selectedNode = null;
            effectiveNodeKey = null;
            if (selectedAttribute.value !== null) patch.selectedAttribute = null;
          } else {
            patch.selectedEdge = null;
          }
        }

        const explicitAttr = patched.has("selectedAttribute");
        const nodeSwitched = prevNodeKey !== undefined && effectiveNodeKey !== prevNodeKey;
        const clearAttr = !effectiveNodeKey || (nodeSwitched && !explicitAttr);
        if (clearAttr && selectedAttribute.value !== null) {
          patch.selectedAttribute = null;
        }

        if (Object.keys(patch).length > 0) {
          instance.state.setState(patch);
        }
      },
      { immediate: true },
    );

    // Record once a selected target loads successfully so transient refresh read failures keep forms mounted in place.
    watch(
      nodeHeaderStatus,
      (status) => {
        if (status === "ready" && selectedNode.value) nodeEverReady.value = true;
      },
      { immediate: true },
    );
    watch(
      edgeHeaderStatus,
      (status) => {
        if (status === "ready" && selectedEdge.value) edgeEverReady.value = true;
      },
      { immediate: true },
    );

    // Shift-dragging from one node to another populates connectFrom/connectTo; open the create-relation dialog with them.
    watch(
      [() => values.value.connectFrom, () => values.value.connectTo],
      ([from, to]) => {
        if (from && to && values.value.dialog !== "relation") {
          instance.state.setState({ dialog: "relation", connectFrom: from, connectTo: to });
        }
      },
    );

    // Clear stale Shift-connect endpoints when the dialog closes or opens cleanly without explicit connect endpoints.
    watch(dialog, (next) => {
      const hasStaleConnect = values.value.connectFrom !== null || values.value.connectTo !== null;
      if (!hasStaleConnect) return;
      if (next !== "relation") {
        instance.state.setState({ connectFrom: null, connectTo: null });
        return;
      }
      const patched = instance.state.lastPatchedKeys;
      if (!patched.has("connectFrom") && !patched.has("connectTo")) {
        instance.state.setState({ connectFrom: null, connectTo: null });
      }
    });

    const openClassDialog = () => instance.state.set("dialog", "class");
    const openRelationDialog = () => {
      instance.state.setState({ dialog: "relation", connectFrom: null, connectTo: null });
    };
    const closeDialog = () => {
      instance.state.setState({ dialog: null, connectFrom: null, connectTo: null });
    };

    // LIFO back/Esc layers: closing an open create dialog takes precedence over closing the side inspector.
    const selectionBack = usePanelBack(
      () => Boolean(selectedNode.value || selectedEdge.value),
      clearSelection,
      {
        pushHistory: true,
        forms: () => (selectedNode.value ? ["classForm", "attributeForm"] : ["relationForm"]),
      },
    );
    const dialogBack = usePanelBack(
      () => dialog.value === "class" || dialog.value === "relation",
      closeDialog,
      {
        pushHistory: true,
        forms: () => (dialog.value === "class" ? "classCreate" : "relationCreate"),
      },
    );

    const classDialog = computed(() => dialog.value === "class");
    const relationDialog = computed(() => dialog.value === "relation");
    async function handleDialogClose(done) {
      if (await dialogBack.back()) done();
    }

    const newAttribute = () => instance.state.set("selectedAttribute", null);
    const requestCloseSide = () => void selectionBack.back();
    const onClassDeleted = outcome => {
      if (outcome?.kind === "success") clearSelection();
    };
    const onRelationDeleted = outcome => {
      if (outcome?.kind === "success") clearSelection();
    };
    const onAttributeDeleted = outcome => {
      if (outcome?.kind === "success") instance.state.set("selectedAttribute", null);
    };
    const browseData = () => {
      const node = selectedNode.value;
      return node ? navigate(`/browser/data/${encodeURIComponent(node.primaryKey)}`) : undefined;
    };

    return {
      t,
      rootRef,
      narrow,
      selectedNode,
      selectedNodeKey,
      selectedEdge,
      selectedNodeLabel,
      selectedEdgeLabel,
      nodeMissing,
      edgeMissing,
      nodeEverReady,
      edgeEverReady,
      selectedAttribute,
      attributesTotal,
      onAttributesListed,
      classDialog,
      relationDialog,
      handleDialogClose,
      openClassDialog,
      openRelationDialog,
      closeDialog,
      newAttribute,
      requestCloseSide,
      onClassDeleted,
      onRelationDeleted,
      onAttributeDeleted,
      browseData,
      refresh: () => instance.refreshObjects(),
    };
  },
});
