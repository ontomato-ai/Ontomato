import { computed, ref, watch } from "vue";
import {
  draftTarget,
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";
const RELATIONSHIP = "platform:Relationship";
const ATTRIBUTE = "platform:Attribute";

/** Extracts the owning class name from a platform:Attribute composite key JSON tuple `[className, attrName]`. */
function attributeClass(primaryKey) {
  try {
    const parsed = JSON.parse(primaryKey ?? "");
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}

await mountPanel({
  setup() {
    const { instance, t, navigate } = usePanelContext();
    const values = instance.state.values;
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const selectedNode = computed(() => values.value.selectedNode ?? null);
    const selectedEdge = computed(() => values.value.selectedEdge ?? null);
    const selectedAttribute = computed(() => values.value.selectedAttribute ?? null);
    const dialog = computed(() => values.value.dialog ?? null);

    // Read-only outputs from official projections (zero raw record reads).
    const nodeHeaderStatus = usePanelOutput("nodeHeader", "status");
    const nodeHeaderLabel = usePanelOutput("nodeHeader", "label");
    const edgeHeaderStatus = usePanelOutput("edgeHeader", "status");
    const edgeHeaderLabel = usePanelOutput("edgeHeader", "label");
    const attributesTotal = usePanelOutput("attributes", "total");

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

    const clearSelection = () => {
      instance.state.setState({
        selectedNode: null,
        selectedEdge: null,
        selectedAttribute: null,
        className: null,
      });
    };

    // Keep the plain `className` parameter synced with `selectedNode`; preserve a deep-linked or draft-selected
    // attribute on initial mount or atomic state patch, and clear it when switching to another node.
    watch(
      () => selectedNode.value?.primaryKey ?? null,
      (nextKey, prevKey) => {
        const explicitAttr = instance.state.lastPatchedKeys.has("selectedAttribute");
        const clearAttr = !nextKey || (prevKey !== undefined && nextKey !== prevKey && !explicitAttr);
        const patch = { className: nextKey };
        if (clearAttr && selectedAttribute.value !== null) patch.selectedAttribute = null;
        if (values.value.className !== nextKey || "selectedAttribute" in patch) {
          instance.state.setState(patch);
        }
      },
      { immediate: true },
    );

    // Clear selection when a previously loaded object type or relationship disappears (for example deleted via agent).
    watch(nodeHeaderStatus, (next, prev) => {
      if (prev === "ready" && (next === "error" || next === "empty") && selectedNode.value) {
        clearSelection();
      }
    });
    watch(edgeHeaderStatus, (next, prev) => {
      if (prev === "ready" && (next === "error" || next === "empty") && selectedEdge.value) {
        clearSelection();
      }
    });

    // Shift-dragging from one node to another populates connectFrom/connectTo; open the create-relation dialog with them.
    watch(
      () => [values.value.connectFrom, values.value.connectTo],
      ([from, to]) => {
        if (from && to && values.value.dialog !== "relation") instance.state.set("dialog", "relation");
      },
    );

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

    const classDialog = computed({
      get: () => dialog.value === "class",
      set: value => {
        if (!value && dialog.value === "class") void dialogBack.back();
      },
    });
    const relationDialog = computed({
      get: () => dialog.value === "relation",
      set: value => {
        if (!value && dialog.value === "relation") void dialogBack.back();
      },
    });

    // Open the matching create dialog or side inspector when an assistant draft targets any form on this page.
    watch(
      instance.draft,
      draft => {
        if (!draft) return;
        const target = draftTarget(draft);
        if (draft.slot === "classCreate" || (target.kind === "create" && target.objectType === OBJECT_TYPE)) {
          if (dialog.value !== "class") instance.state.set("dialog", "class");
          return;
        }
        if (draft.slot === "relationCreate" || (target.kind === "create" && target.objectType === RELATIONSHIP)) {
          if (dialog.value !== "relation") instance.state.set("dialog", "relation");
          return;
        }
        if (target.kind === "update" && target.objectType === OBJECT_TYPE) {
          instance.state.setState({
            dialog: null,
            selectedEdge: null,
            selectedNode: { className: OBJECT_TYPE, primaryKey: target.id },
            className: target.id,
          });
          return;
        }
        if (target.kind === "update" && target.objectType === RELATIONSHIP) {
          instance.state.setState({
            dialog: null,
            selectedNode: null,
            selectedAttribute: null,
            className: null,
            selectedEdge: { className: RELATIONSHIP, primaryKey: target.id },
          });
          return;
        }
        if (target.objectType === ATTRIBUTE) {
          const ownerClass = target.kind === "update"
            ? attributeClass(target.id)
            : (typeof draft.form?.className === "string" ? draft.form.className : selectedNode.value?.primaryKey ?? null);
          if (ownerClass) {
            instance.state.setState({
              dialog: null,
              selectedEdge: null,
              selectedNode: { className: OBJECT_TYPE, primaryKey: ownerClass },
              className: ownerClass,
              selectedAttribute: target.kind === "update"
                ? { className: ATTRIBUTE, primaryKey: target.id }
                : null,
            });
          }
        }
      },
      { immediate: true },
    );

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
      selectedEdge,
      selectedNodeLabel,
      selectedEdgeLabel,
      nodeMissing,
      edgeMissing,
      selectedAttribute,
      attributesTotal,
      classDialog,
      relationDialog,
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
