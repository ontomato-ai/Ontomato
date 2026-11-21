import { computed, nextTick, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/** The same place the Manager's graph page keeps dragged node positions, so a reader's layout carries over. */
const POSITIONS_KEY = "ontology-graph-layout-v1";
const EDGE_PREFIX = "relation:";

function readPositions() {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function writePositions(positions) {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    // A page without storage keeps the positions for as long as it is open.
  }
}

function recordsOf(state) {
  return state.value.status === "ready" ? state.value.value : [];
}

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const objectRows = usePanelData("objectTypes", "rows");
    const relationRows = usePanelData("relations", "rows");
    const attributeRows = usePanelData("attributes", "rows");

    const canvas = ref(null);
    const layingOut = ref(false);
    const pathFrom = ref("");
    const pathTo = ref("");
    const pathNodes = ref([]);
    const pathEdges = ref([]);
    const pathMessage = ref("");
    const pathFound = ref(false);
    const navigationError = ref("");
    const storedPositions = ref(readPositions());

    const loading = computed(() => [objectRows, relationRows, attributeRows].some((rows) => rows.value.status === "loading"));
    const readErrors = computed(() =>
      [
        ["对象类型", objectRows],
        ["关系类型", relationRows],
        ["属性", attributeRows],
      ].flatMap(([name, rows]) => {
        const state = rows.value;
        if (state.status === "error") return [`${name}读取失败：${state.message}`];
        if (state.status === "forbidden") return [`没有权限读取${name}`];
        return [];
      }),
    );

    const objects = computed(() =>
      recordsOf(objectRows).map((record) => ({
        className: record.fields.className || record.primaryKey,
        showName: record.label || record.fields.showName || record.primaryKey,
        classDesc: record.fields.classDesc || "",
      })),
    );

    const relations = computed(() =>
      recordsOf(relationRows).map((record) => ({
        relationship: record.primaryKey,
        name: record.label || record.primaryKey,
        desc: record.fields.desc || "",
        fromclass: record.fields.fromclass || "",
        toclass: record.fields.toclass || "",
      })),
    );

    const attributes = computed(() =>
      recordsOf(attributeRows).map((record) => ({
        className: record.fields.className || "",
        name: record.fields.name || record.primaryKey,
        showName: record.label || record.fields.name || record.primaryKey,
        type: record.fields.type || "string",
      })),
    );

    const attributesByClass = computed(() => {
      const grouped = new Map();
      for (const attribute of attributes.value) {
        const list = grouped.get(attribute.className);
        if (list) list.push(attribute);
        else grouped.set(attribute.className, [attribute]);
      }
      return grouped;
    });

    const objectNames = computed(() => new Map(objects.value.map((object) => [object.className, object.showName])));
    const classNameLabel = (className) => objectNames.value.get(className) ?? (className || "（未知对象类型）");

    // The page's public state: the reader's selection, search and filter, which its agent reads too.
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value ?? ""),
    });
    const filterOptions = [
      { label: "全部", value: "all" },
      { label: "对象类型", value: "objects" },
      { label: "关系类型", value: "relations" },
    ];
    /** Which resources the reader looks at; an address value this page does not offer reads as all of them. */
    const filter = computed({
      get: () => {
        const value = instance.state.values.value.filter;
        return ["all", "objects", "relations"].includes(value) ? value : "all";
      },
      set: (value) => instance.state.set("filter", value ?? "all"),
    });
    const filterValue = filter;

    const selectedObjectKey = computed(() => instance.state.values.value.objectType?.primaryKey ?? "");
    const selectedRelationKey = computed(() => instance.state.values.value.relation?.primaryKey ?? "");
    const selectedObject = computed(() => objects.value.find((object) => object.className === selectedObjectKey.value) ?? null);
    const selectedRelation = computed(
      () => relations.value.find((relation) => relation.relationship === selectedRelationKey.value) ?? null,
    );
    const selectedAttributes = computed(() => attributesByClass.value.get(selectedObjectKey.value) ?? []);
    const connectedRelations = computed(() =>
      selectedObject.value
        ? relations.value.filter(
            (relation) => relation.fromclass === selectedObject.value.className || relation.toclass === selectedObject.value.className,
          )
        : [],
    );

    const hasResources = computed(() => objects.value.length > 0 || relations.value.length > 0);
    const query = computed(() => search.value.trim().toLowerCase());

    const attrWords = (className) =>
      (attributesByClass.value.get(className) ?? []).flatMap((attribute) => [attribute.name, attribute.showName]);

    const filteredObjects = computed(() => {
      if (filterValue.value === "relations") return [];
      if (!query.value) return objects.value;
      return objects.value.filter((object) =>
        [object.className, object.showName, object.classDesc, ...attrWords(object.className)].some((value) =>
          String(value ?? "").toLowerCase().includes(query.value),
        ),
      );
    });

    const filteredRelations = computed(() => {
      if (filterValue.value === "objects") return [];
      if (!query.value) return relations.value;
      return relations.value.filter((relation) =>
        [relation.relationship, relation.name, relation.desc, relation.fromclass, relation.toclass].some((value) =>
          String(value ?? "").toLowerCase().includes(query.value),
        ),
      );
    });

    /** The relations the canvas can draw: both ends are object types of this domain. */
    const drawableRelations = computed(() =>
      relations.value.filter((relation) => objectNames.value.has(relation.fromclass) && objectNames.value.has(relation.toclass)),
    );
    const edgeId = (relation) => `${EDGE_PREFIX}${relation.relationship}`;

    const gridPosition = (index) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, objects.value.length))));
      return { x: (index % columns) * 240, y: Math.floor(index / columns) * 180 };
    };
    const nodePosition = (className, index) => storedPositions.value[className] ?? gridPosition(index);

    /**
     * What stands out and what fades back: the search's hits and the filter, else the found path, else the selection
     * with what it is joined to. Everything else is drawn muted.
     */
    const emphasis = computed(() => {
      const accent = new Set();
      const muted = new Set();
      const filtering = query.value !== "" || filterValue.value !== "all";
      if (filtering) {
        filteredObjects.value.forEach((object) => accent.add(object.className));
        filteredRelations.value.forEach((relation) => accent.add(edgeId(relation)));
      } else if (pathFound.value) {
        pathNodes.value.forEach((className) => accent.add(className));
        pathEdges.value.forEach((id) => accent.add(id));
      } else if (selectedObject.value) {
        accent.add(selectedObject.value.className);
        for (const relation of connectedRelations.value) {
          accent.add(edgeId(relation));
          accent.add(relation.fromclass);
          accent.add(relation.toclass);
        }
      } else if (selectedRelation.value) {
        accent.add(edgeId(selectedRelation.value));
        accent.add(selectedRelation.value.fromclass);
        accent.add(selectedRelation.value.toclass);
      }
      if (!accent.size) return { accent, muted };
      objects.value.forEach((object) => {
        if (!accent.has(object.className)) muted.add(object.className);
      });
      drawableRelations.value.forEach((relation) => {
        if (!accent.has(edgeId(relation))) muted.add(edgeId(relation));
      });
      return { accent, muted };
    });

    const toneOf = (id) => (emphasis.value.muted.has(id) ? "muted" : emphasis.value.accent.has(id) ? "accent" : "default");

    const nodes = computed(() =>
      objects.value.map((object, index) => {
        const position = nodePosition(object.className, index);
        return {
          id: object.className,
          label: object.showName,
          title: `${object.showName}（${object.className}）`,
          category: "对象类型",
          tone: toneOf(object.className),
          x: position.x,
          y: position.y,
        };
      }),
    );

    const edges = computed(() =>
      drawableRelations.value.map((relation) => ({
        id: edgeId(relation),
        source: relation.fromclass,
        target: relation.toclass,
        label: relation.name,
        tone: toneOf(edgeId(relation)),
      })),
    );

    const selectedNodeIds = computed(() => (selectedObject.value ? [selectedObject.value.className] : []));
    const selectedEdgeIds = computed(() => (selectedRelation.value ? [edgeId(selectedRelation.value)] : []));

    // The agent names the selected object by the owner's label, not by its key alone.
    watch(
      objects,
      (list) => {
        if (list.length) instance.nameObjects("platform:ObjectType", list.map((object) => ({ primaryKey: object.className, label: object.showName })));
      },
      { immediate: true },
    );
    watch(
      relations,
      (list) => {
        if (list.length) instance.nameObjects("platform:Relationship", list.map((relation) => ({ primaryKey: relation.relationship, label: relation.name })));
      },
      { immediate: true },
    );

    function resetPath() {
      pathNodes.value = [];
      pathEdges.value = [];
      pathMessage.value = "";
      pathFound.value = false;
    }

    function selectObject(className) {
      if (!className) return;
      resetPath();
      navigationError.value = "";
      instance.state.setState({ objectType: { className: "platform:ObjectType", primaryKey: className }, relation: null });
    }

    function selectRelation(relationship) {
      if (!relationship) return;
      resetPath();
      navigationError.value = "";
      instance.state.setState({ relation: { className: "platform:Relationship", primaryKey: relationship }, objectType: null });
    }

    function clearSelection() {
      if (!selectedObjectKey.value && !selectedRelationKey.value && !pathFound.value) return;
      resetPath();
      navigationError.value = "";
      instance.state.setState({ objectType: null, relation: null });
    }

    function onCanvasSelection(ids) {
      const id = ids.at(-1);
      if (!id) clearSelection();
      else selectObject(id);
    }

    function onCanvasEdgeSelection(ids) {
      const id = ids.at(-1);
      if (!id) clearSelection();
      else selectRelation(String(id).replace(EDGE_PREFIX, ""));
    }

    function onNodeMoved(id, position) {
      storedPositions.value = { ...storedPositions.value, [id]: { x: position.x, y: position.y } };
      writePositions(storedPositions.value);
    }

    function findPath() {
      const from = pathFrom.value;
      const to = pathTo.value;
      if (!from || !to) return;
      const queue = [{ node: from, nodes: [from], edges: [] }];
      const visited = new Set([from]);
      while (queue.length) {
        const current = queue.shift();
        if (current.node === to) {
          pathNodes.value = current.nodes;
          pathEdges.value = current.edges;
          pathFound.value = true;
          pathMessage.value = `找到路径：${current.edges.length} 跳`;
          return;
        }
        for (const relation of drawableRelations.value) {
          if (relation.fromclass !== current.node || visited.has(relation.toclass)) continue;
          visited.add(relation.toclass);
          queue.push({
            node: relation.toclass,
            nodes: [...current.nodes, relation.toclass],
            edges: [...current.edges, edgeId(relation)],
          });
        }
      }
      pathNodes.value = [];
      pathEdges.value = [];
      pathFound.value = false;
      pathMessage.value = `找不到从「${classNameLabel(from)}」到「${classNameLabel(to)}」的路径`;
    }

    function zoomIn() {
      canvas.value?.zoomBy(1.2);
    }

    function zoomOut() {
      canvas.value?.zoomBy(0.8);
    }

    function fitGraph() {
      canvas.value?.fit({ maxZoom: 1, padding: 48 });
    }

    async function relayout() {
      if (layingOut.value) return;
      layingOut.value = true;
      try {
        storedPositions.value = {};
        writePositions({});
        await nextTick();
        await canvas.value?.relayout();
        await canvas.value?.fit({ maxZoom: 1, padding: 48 });
      } finally {
        layingOut.value = false;
      }
    }

    async function exportPng() {
      const blob = await canvas.value?.exportImage();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ontology-graph-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function refresh() {
      resetPath();
      navigationError.value = "";
      instance.refreshAll();
    }

    async function openModeling() {
      navigationError.value = "";
      const target = selectedObject.value
        ? { focus: "object", id: selectedObject.value.className }
        : selectedRelation.value
          ? { focus: "relation", id: selectedRelation.value.relationship }
          : null;
      if (!target) return;
      const address = `/ontology/visual-modeling?focus=${target.focus}&id=${encodeURIComponent(target.id)}&back=playground`;
      try {
        await instance.navigate(address);
      } catch (reason) {
        navigationError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    const fitOnce = async () => {
      await nextTick();
      await canvas.value?.fit({ maxZoom: 1, padding: 48 });
    };
    watch(
      () => objects.value.length,
      async (count, previous) => {
        if (count && count !== previous) await fitOnce();
      },
    );
    onMounted(() => {
      if (objects.value.length) void fitOnce();
    });

    return {
      canvas,
      loading,
      readErrors,
      objects,
      relations,
      attributes,
      hasResources,
      search,
      filter,
      filterOptions,
      selectedObject,
      selectedRelation,
      selectedAttributes,
      connectedRelations,
      filteredObjects,
      filteredRelations,
      pathFrom,
      pathTo,
      pathMessage,
      pathFound,
      navigationError,
      nodes,
      edges,
      selectedNodeIds,
      selectedEdgeIds,
      layingOut,
      classNameLabel,
      selectObject,
      selectRelation,
      clearSelection,
      onCanvasSelection,
      onCanvasEdgeSelection,
      onNodeMoved,
      findPath,
      zoomIn,
      zoomOut,
      fitGraph,
      relayout,
      exportPng,
      refresh,
      openModeling,
    };
  },
});
