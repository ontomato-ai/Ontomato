import { computed, onMounted, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t, navigate } = usePanelContext();
    const values = instance.state.values;

    const selectedNode = computed(() => values.value.selectedNode ?? null);
    const selectedEdge = computed(() => values.value.selectedEdge ?? null);
    const selectedAttribute = computed(() => values.value.selectedAttribute ?? null);
    const dialog = computed(() => values.value.dialog ?? null);
    const attributes = usePanelData("attributes", "rows");
    const graphNodes = usePanelData("graph", "nodes");
    const graphEdges = usePanelData("graph", "edges");

    const selectedNodeLabel = computed(() => {
      const key = selectedNode.value?.primaryKey;
      if (!key) return "";
      const list = graphNodes.value.status === "ready" ? graphNodes.value.value : [];
      return list.find(row => row.primaryKey === key)?.label || key;
    });
    const selectedEdgeLabel = computed(() => {
      const key = selectedEdge.value?.primaryKey;
      if (!key) return "";
      const list = graphEdges.value.status === "ready" ? graphEdges.value.value : [];
      return list.find(row => row.primaryKey === key)?.label || key;
    });

    // The attribute reads take the chosen object type's key as a plain string.
    watch(
      selectedNode,
      node => {
        instance.state.setState({
          className: node ? node.primaryKey : null,
          selectedAttribute: null,
        });
      },
      { immediate: true },
    );

    // A selected record that the canvas no longer lists (deleted here or elsewhere) is not kept selected.
    const stillListed = (data, key) =>
      data.value.status !== "ready" || data.value.value.some(row => row.primaryKey === key);
    watch([graphNodes, selectedNode], () => {
      const node = selectedNode.value;
      if (node && !stillListed(graphNodes, node.primaryKey)) instance.state.set("selectedNode", null);
    });
    watch([graphEdges, selectedEdge], () => {
      const edge = selectedEdge.value;
      if (edge && !stillListed(graphEdges, edge.primaryKey)) instance.state.set("selectedEdge", null);
    });

    // A line drawn with Shift from one node to another hands the page both ends: that is a new relation, so the owner's
    // create form opens with them filled in. Opening it from the header clears them first, which leaves this alone.
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
    const openDialog = value => instance.state.set("dialog", value);
    const classDialog = computed({
      get: () => dialog.value === "class",
      set: value => {
        if (!value && dialog.value === "class") closeDialog();
      },
    });
    const relationDialog = computed({
      get: () => dialog.value === "relation",
      set: value => {
        if (!value && dialog.value === "relation") closeDialog();
      },
    });
    // Open the matching create dialog when an assistant draft targets either creation form.
    watch(
      instance.draft,
      draft => {
        if (!draft) return;
        if (draft.slot === "classCreate" && dialog.value !== "class") instance.state.set("dialog", "class");
        else if (draft.slot === "relationCreate" && dialog.value !== "relation") instance.state.set("dialog", "relation");
      },
      { immediate: true },
    );
    const pickAttribute = row => instance.state.set("selectedAttribute", {
      className: "platform:Attribute",
      primaryKey: String(row.primaryKey),
    });
    const newAttribute = () => instance.state.set("selectedAttribute", null);
    const clearSelection = () => {
      instance.state.setState({ selectedNode: null, selectedEdge: null, selectedAttribute: null });
    };
    const browseData = () => {
      const node = selectedNode.value;
      return node ? navigate(`/browser/data/${encodeURIComponent(node.primaryKey)}`) : undefined;
    };

    // The canvas draws its nodes where the grid puts them; the page fits the view once it is drawn,
    // using the canvas's own fit control, as the original page fitted itself on first load.
    const fitView = () => {
      const button = document.querySelector('[data-graph-action="fit"]');
      if (button instanceof HTMLElement) button.click();
    };
    onMounted(() => {
      window.setTimeout(fitView, 1200);
      window.setTimeout(fitView, 3600);
    });

    const fieldEntries = row => Object.entries(row.fields ?? {})
      .filter(([, value]) => value !== null && value !== undefined && String(value) !== "")
      .map(([key, value]) => ({
        key,
        label: row.fieldLabels?.[key] ?? key,
        value: String(value),
        tone: row.tones?.[key] ?? "default",
      }));

    return {
      t,
      selectedNode,
      selectedEdge,
      selectedNodeLabel,
      selectedEdgeLabel,
      selectedAttribute,
      dialog,
      classDialog,
      relationDialog,
      attributes,
      openClassDialog,
      openRelationDialog,
      openDialog,
      closeDialog,
      pickAttribute,
      newAttribute,
      clearSelection,
      browseData,
      fitView,
      fieldEntries,
    };
  },
});
