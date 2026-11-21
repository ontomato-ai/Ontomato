import { computed, nextTick, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/** The same place the Manager's graph page keeps dragged node positions, so a reader's layout carries over. */
const POSITIONS_KEY = "ontology-graph-layout-v1";
const EDGE_PREFIX = "relation:";

/** Lucide shapes (24px grid, stroked) for the canvas's icon tools. */
const MAGNIFIER = ["M19 11a8 8 0 1 1-16 0a8 8 0 1 1 16 0", "M21 21l-4.35-4.35"];
const TOOLS = [
  { key: "zoomIn", label: "放大", paths: [...MAGNIFIER, "M11 8v6", "M8 11h6"] },
  { key: "zoomOut", label: "缩小", paths: [...MAGNIFIER, "M8 11h6"] },
  { key: "fit", label: "适应画布", paths: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2"] },
  {
    key: "relayout",
    label: "重新布局",
    paths: [3, 14].flatMap((y) => [3, 14].map((x) => `M${x + 1} ${y}h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z`)),
  },
  { key: "export", label: "导出 PNG", paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"] },
  { key: "path", label: "路径查找", paths: ["M9 19a3 3 0 1 1-6 0a3 3 0 1 1 6 0", "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15", "M21 5a3 3 0 1 1-6 0a3 3 0 1 1 6 0"] },
];
const CLOSE_PATHS = ["M18 6 6 18", "M6 6l12 12"];

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
    // Where the inspector does not fit beside the canvas it opens on demand: for a selection, or the path finder.
    const pathOpen = ref(false);

    const loading = computed(() => [objectRows, relationRows, attributeRows].some((rows) => rows.value.status === "loading"));
    // A count or an empty list is only said once the owner has answered: before that the reads are still running.
    const countOf = (rows) => (rows.value.status === "ready" ? rows.value.value.length : null);
    const counts = computed(() => ({ objects: countOf(objectRows), attributes: countOf(attributeRows), relations: countOf(relationRows) }));
    const catalogueReady = computed(() => objectRows.value.status === "ready" && relationRows.value.status === "ready");
    const catalogueFailed = computed(() =>
      [objectRows, relationRows].some((rows) => rows.value.status === "error" || rows.value.status === "forbidden"),
    );
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

    const inspectorOpen = computed(() => Boolean(selectedObject.value || selectedRelation.value || pathOpen.value || pathFound.value));

    function closeInspector() {
      pathOpen.value = false;
      clearSelection();
    }

    function runTool(key) {
      if (key === "zoomIn") zoomIn();
      else if (key === "zoomOut") zoomOut();
      else if (key === "fit") fitGraph();
      else if (key === "relayout") void relayout();
      else if (key === "export") void exportPng();
      else if (key === "path") pathOpen.value = !pathOpen.value;
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
      counts,
      catalogueReady,
      catalogueFailed,
      tools: TOOLS,
      closePaths: CLOSE_PATHS,
      pathOpen,
      inspectorOpen,
      closeInspector,
      runTool,
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
      openModeling,
    };
  },
});
