import { computed, ref, shallowRef, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";
const RELATIONSHIP_TYPE = "platform:Relationship";

await mountPanel({
  setup() {
    const { instance, t, navigate, notify, refreshObjects, confirmLeaveUnsaved } = usePanelContext();
    const values = instance.state.values;
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const selectedNode = computed(() => values.value.selectedNode ?? null);
    const selectedEdge = computed(() => values.value.selectedEdge ?? null);
    const selectedAttribute = computed(() => values.value.selectedAttribute ?? null);
    const dialog = computed(() => values.value.dialog ?? null);
    const fromPlayground = computed(() => values.value.back === "playground");

    // Read-only outputs from official projections (zero raw record reads).
    const nodeHeaderStatus = usePanelOutput("nodeHeader", "status");
    const nodeHeaderLabel = usePanelOutput("nodeHeader", "label");
    const nodeHeaderError = usePanelOutput("nodeHeader", "errorMessage");
    const edgeHeaderStatus = usePanelOutput("edgeHeader", "status");
    const edgeHeaderLabel = usePanelOutput("edgeHeader", "label");
    const edgeHeaderError = usePanelOutput("edgeHeader", "errorMessage");
    const attributesTotal = usePanelOutput("attributes", "total");
    const objectCatalogStatus = usePanelOutput("objectCatalog", "status");
    const objectCatalogListed = usePanelOutput("objectCatalog", "listed");
    const relationCatalogStatus = usePanelOutput("relationCatalog", "status");
    const relationCatalogListed = usePanelOutput("relationCatalog", "listed");

    // Opaque object reference lists reported by official catalog probes for relation creation defaults
    // and missing-focus detection.
    const listedObjectTypes = computed(() =>
      Array.isArray(objectCatalogListed.value) ? objectCatalogListed.value : [],
    );
    const listedRelations = computed(() =>
      Array.isArray(relationCatalogListed.value) ? relationCatalogListed.value : [],
    );

    const knownObjectKeys = computed(() => {
      if (objectCatalogStatus.value === "ready") {
        return new Set(listedObjectTypes.value.map((item) => item.primaryKey));
      }
      if (objectCatalogStatus.value === "empty") return new Set();
      return null;
    });
    const knownRelationKeys = computed(() => {
      if (relationCatalogStatus.value === "ready") {
        return new Set(listedRelations.value.map((item) => item.primaryKey));
      }
      if (relationCatalogStatus.value === "empty") return new Set();
      return null;
    });

    const nodeEverReady = ref(false);
    const lastNodeLabel = ref("");
    const edgeEverReady = ref(false);
    const lastEdgeLabel = ref("");

    const selectedNodeLabel = computed(() =>
      (typeof nodeHeaderLabel.value === "string" && nodeHeaderLabel.value) ||
      lastNodeLabel.value ||
      selectedNode.value?.primaryKey ||
      "",
    );
    const selectedEdgeLabel = computed(() =>
      (typeof edgeHeaderLabel.value === "string" && edgeHeaderLabel.value) ||
      lastEdgeLabel.value ||
      selectedEdge.value?.primaryKey ||
      "",
    );

    // Distinct states for selected node/edge: forbidden, missing (unlocatable focus), and general read failure.
    const nodeForbidden = computed(() => Boolean(selectedNode.value) && nodeHeaderStatus.value === "forbidden");
    const nodeNotFound = computed(() => {
      if (!selectedNode.value) return false;
      if (nodeHeaderStatus.value === "empty") return true;
      return (
        nodeHeaderStatus.value === "error" &&
        !nodeEverReady.value &&
        knownObjectKeys.value !== null &&
        !knownObjectKeys.value.has(selectedNode.value.primaryKey)
      );
    });
    const nodeReadError = computed(
      () => Boolean(selectedNode.value) && nodeHeaderStatus.value === "error" && !nodeNotFound.value,
    );
    const showNodeContent = computed(
      () =>
        Boolean(selectedNode.value) &&
        !nodeForbidden.value &&
        !nodeNotFound.value &&
        (nodeEverReady.value || !nodeReadError.value),
    );

    const edgeForbidden = computed(() => Boolean(selectedEdge.value) && edgeHeaderStatus.value === "forbidden");
    const edgeNotFound = computed(() => {
      if (!selectedEdge.value) return false;
      if (edgeHeaderStatus.value === "empty") return true;
      return (
        edgeHeaderStatus.value === "error" &&
        !edgeEverReady.value &&
        knownRelationKeys.value !== null &&
        !knownRelationKeys.value.has(selectedEdge.value.primaryKey)
      );
    });
    const edgeReadError = computed(
      () => Boolean(selectedEdge.value) && edgeHeaderStatus.value === "error" && !edgeNotFound.value,
    );
    const showEdgeContent = computed(
      () =>
        Boolean(selectedEdge.value) &&
        !edgeForbidden.value &&
        !edgeNotFound.value &&
        (edgeEverReady.value || !edgeReadError.value),
    );
    const showEdgeBanner = computed(
      () => Boolean(selectedEdge.value) && (edgeForbidden.value || edgeNotFound.value || edgeReadError.value),
    );

    const canEditSelected = computed(() => {
      if (selectedNode.value) return !nodeForbidden.value && !nodeNotFound.value && (nodeEverReady.value || nodeHeaderStatus.value === "ready");
      if (selectedEdge.value) return !edgeForbidden.value && !edgeNotFound.value && (edgeEverReady.value || edgeHeaderStatus.value === "ready");
      return false;
    });

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
          lastNodeLabel.value = "";
        }
        if (nextEdgeKey !== prevEdgeKey) {
          edgeEverReady.value = false;
          lastEdgeLabel.value = "";
        }

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

    // Mirror SDK #303 `previous` semantics: keep mounted edit forms alive across same-target reread failures,
    // and drop ready state when access is lost (`forbidden`) or the target returns `empty`.
    watch(
      [nodeHeaderStatus, nodeHeaderLabel],
      ([status, label]) => {
        if (!selectedNode.value) return;
        if (status === "ready") {
          nodeEverReady.value = true;
          if (typeof label === "string" && label) lastNodeLabel.value = label;
        } else if (status === "forbidden" || status === "empty") {
          nodeEverReady.value = false;
        }
      },
      { immediate: true },
    );
    watch(
      [edgeHeaderStatus, edgeHeaderLabel],
      ([status, label]) => {
        if (!selectedEdge.value) return;
        if (status === "ready") {
          edgeEverReady.value = true;
          if (typeof label === "string" && label) lastEdgeLabel.value = label;
        } else if (status === "forbidden" || status === "empty") {
          edgeEverReady.value = false;
        }
      },
      { immediate: true },
    );

    // Transient pre-selection for top-bar "Add relation" (keeps source/target editable, unlike Shift-drag fixedFields).
    const pendingRelationPreset = shallowRef(null);
    const appliedRelationPreset = shallowRef(null);

    // Shift-dragging from one node to another populates connectFrom/connectTo; open the create-relation dialog with them.
    watch(
      [() => values.value.connectFrom, () => values.value.connectTo],
      ([from, to]) => {
        if (from && to && values.value.dialog !== "relation") {
          pendingRelationPreset.value = null;
          appliedRelationPreset.value = null;
          instance.state.setState({ dialog: "relation", connectFrom: from, connectTo: to });
        }
      },
    );

    // Clear stale Shift-connect endpoints and presets when the dialog closes or switches away.
    watch(dialog, (next) => {
      if (next !== "relation") {
        pendingRelationPreset.value = null;
        appliedRelationPreset.value = null;
      }
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

    // Apply preselected editable endpoints into relationCreate once its owner form loads.
    watch(
      () => ({
        open: dialog.value === "relation",
        preset: pendingRelationPreset.value,
        fieldCount: instance.forms.handle("relationCreate")?.fields.value.length ?? 0,
      }),
      async ({ open, preset, fieldCount }) => {
        if (!open || !preset || fieldCount === 0) return;
        pendingRelationPreset.value = null;
        const result = await instance.forms.fill("relationCreate", {
          "/fromclass": preset.fromclass,
          "/toclass": preset.toclass,
        });
        if (result?.ok) {
          appliedRelationPreset.value = preset;
        }
      },
    );

    const openClassDialog = () => instance.state.set("dialog", "class");
    const openRelationDialog = () => {
      if (
        objectCatalogStatus.value === "empty" ||
        (objectCatalogStatus.value === "ready" && listedObjectTypes.value.length < 2)
      ) {
        notify({ kind: "warning", text: t("visualModeling.needAtLeastTwoClasses") });
        return;
      }
      if (listedObjectTypes.value.length >= 2) {
        const selectedKey = selectedNode.value?.primaryKey;
        const fromclass =
          (selectedKey && listedObjectTypes.value.some((item) => item.primaryKey === selectedKey)
            ? selectedKey
            : listedObjectTypes.value[0]?.primaryKey) || "";
        const toclass =
          listedObjectTypes.value.find((item) => item.primaryKey !== fromclass)?.primaryKey ||
          listedObjectTypes.value[1]?.primaryKey ||
          "";
        pendingRelationPreset.value = fromclass && toclass ? { fromclass, toclass } : null;
      } else {
        pendingRelationPreset.value = null;
      }
      appliedRelationPreset.value = null;
      instance.state.setState({ dialog: "relation", connectFrom: null, connectTo: null });
    };

    const openAttributeDialog = () => {
      if (!selectedNode.value) return;
      instance.state.set("dialog", "attribute");
    };

    async function openEditSelectedDialog() {
      if (!canEditSelected.value) return;
      if (selectedNode.value) {
        if (instance.forms.dirty("classForm") && confirmLeaveUnsaved) {
          const allowed = await confirmLeaveUnsaved();
          if (!allowed) return;
          instance.forms.handle("classForm")?.reset({ confirm: false });
        }
        instance.state.set("dialog", "editClass");
      } else if (selectedEdge.value) {
        instance.state.set("dialog", "editRelation");
      }
    }

    const closeDialog = () => {
      pendingRelationPreset.value = null;
      appliedRelationPreset.value = null;
      instance.state.setState({ dialog: null, connectFrom: null, connectTo: null });
    };

    const classDialog = computed(() => dialog.value === "class");
    const editClassDialog = computed(() => dialog.value === "editClass" && Boolean(selectedNode.value));
    const relationDialog = computed(() => dialog.value === "relation");
    const editRelationDialog = computed(() => dialog.value === "editRelation" && Boolean(selectedEdge.value));
    const attributeDialog = computed(() => dialog.value === "attribute" && Boolean(selectedNode.value));

    const activeDialogForm = () => {
      if (dialog.value === "class") return "classCreate";
      if (dialog.value === "editClass") return "classForm";
      if (dialog.value === "relation") return "relationCreate";
      if (dialog.value === "editRelation") return "relationForm";
      if (dialog.value === "attribute") return "attributeCreate";
      return [];
    };

    // LIFO back/Esc layers: closing an open dialog takes precedence over closing the node inspector.
    const selectionBack = usePanelBack(
      () => Boolean(selectedNode.value || selectedEdge.value),
      clearSelection,
      {
        pushHistory: true,
        forms: () => (selectedNode.value ? ["classForm", "attributeForm"] : []),
      },
    );
    const dialogBack = usePanelBack(
      () =>
        classDialog.value ||
        editClassDialog.value ||
        relationDialog.value ||
        editRelationDialog.value ||
        attributeDialog.value,
      closeDialog,
      {
        pushHistory: true,
        forms: activeDialogForm,
      },
    );

    function isUntouchedRelationPreset() {
      const preset = appliedRelationPreset.value;
      if (!relationDialog.value || !preset) return false;
      const formValues = instance.forms.handle("relationCreate")?.values.value;
      if (!formValues) return false;
      return (
        formValues.fromclass === preset.fromclass &&
        formValues.toclass === preset.toclass &&
        !String(formValues.relationship ?? "").trim() &&
        !String(formValues.desc ?? "").trim() &&
        !String(formValues.fromField ?? "").trim() &&
        !String(formValues.toField ?? "").trim()
      );
    }

    async function handleDialogClose(done) {
      if (isUntouchedRelationPreset()) {
        instance.forms.handle("relationCreate")?.reset({ confirm: false });
        closeDialog();
        done();
        return;
      }
      if (await dialogBack.back()) done();
    }

    async function backToGraph() {
      if (instance.dirty() && confirmLeaveUnsaved) {
        const allowed = await confirmLeaveUnsaved();
        if (!allowed) return;
        instance.forms.discardAll();
      }
      await navigate("/ontology/playground");
    }

    const onClassCreated = (saved, outcome) => {
      const key = saved?.primaryKey || outcome?.primaryKey;
      pendingRelationPreset.value = null;
      appliedRelationPreset.value = null;
      if (key) {
        instance.state.setState({
          dialog: null,
          connectFrom: null,
          connectTo: null,
          selectedNode: { className: saved?.className || OBJECT_TYPE, primaryKey: key },
          selectedEdge: null,
          selectedAttribute: null,
        });
      } else {
        closeDialog();
      }
    };

    const onRelationCreated = (saved, outcome) => {
      const key = saved?.primaryKey || outcome?.primaryKey;
      pendingRelationPreset.value = null;
      appliedRelationPreset.value = null;
      if (key) {
        instance.state.setState({
          dialog: null,
          connectFrom: null,
          connectTo: null,
          selectedNode: null,
          selectedEdge: { className: saved?.className || RELATIONSHIP_TYPE, primaryKey: key },
          selectedAttribute: null,
        });
      } else {
        closeDialog();
      }
    };

    const onAttributeCreated = () => {
      closeDialog();
    };

    const requestCloseSide = () => void selectionBack.back();
    const onClassDeleted = (outcome) => {
      if (outcome?.kind === "success") clearSelection();
    };
    const onRelationDeleted = (outcome) => {
      if (outcome?.kind === "success") clearSelection();
    };
    const onAttributeDeleted = (outcome) => {
      if (outcome?.kind === "success") instance.state.set("selectedAttribute", null);
    };

    return {
      t,
      rootRef,
      narrow,
      fromPlayground,
      backToGraph,
      selectedNode,
      selectedEdge,
      selectedNodeLabel,
      selectedEdgeLabel,
      nodeEverReady,
      lastNodeLabel,
      edgeEverReady,
      nodeForbidden,
      nodeNotFound,
      nodeReadError,
      nodeHeaderError,
      showNodeContent,
      edgeForbidden,
      edgeNotFound,
      edgeReadError,
      edgeHeaderError,
      showEdgeContent,
      showEdgeBanner,
      canEditSelected,
      selectedAttribute,
      attributesTotal,
      classDialog,
      editClassDialog,
      relationDialog,
      editRelationDialog,
      attributeDialog,
      handleDialogClose,
      openClassDialog,
      openRelationDialog,
      openAttributeDialog,
      openEditSelectedDialog,
      closeDialog,
      onClassCreated,
      onRelationCreated,
      onAttributeCreated,
      requestCloseSide,
      onClassDeleted,
      onRelationDeleted,
      onAttributeDeleted,
      retryDetail: () => void refreshObjects(),
    };
  },
});
