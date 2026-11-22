import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/*
 * The ontology graph: the owner's object types and relation types on the platform's shared graph canvas (the same one
 * visual modeling draws on). The canvas draws, selects, keeps each reader's node places, and shows what the page
 * highlights; this page decides what a search finds, which path exists between two classes, and what an inspector says
 * about the chosen one. Nothing here draws or lays out the graph.
 */

const OBJECT_TYPE = "platform:ObjectType";
const RELATIONSHIP = "platform:Relationship";

const recordsOf = (state) => (state.value.status === "ready" ? state.value.value : []);

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const objectRows = usePanelData("objectTypes", "rows");
    const relationRows = usePanelData("relations", "rows");
    const attributeRows = usePanelData("attributes", "rows");

    const FILTERS = [
      { value: "all", label: "全部" },
      { value: "objects", label: "对象类型" },
      { value: "relations", label: "关系类型" },
    ];
    const filter = ref("all");
    const pathFrom = ref("");
    const pathTo = ref("");
    const pathMessage = ref("");
    const navigationError = ref("");

    const countOf = (rows) => (rows.value.status === "ready" ? rows.value.value.length : null);
    const counts = computed(() => ({
      objects: countOf(objectRows),
      attributes: countOf(attributeRows),
      relations: countOf(relationRows),
    }));
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
        type: record.fields.type || "",
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

    // The page's public state: the reader's selection, search and what stands out, which its agent reads too.
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value ?? ""),
    });
    const selectedObject = computed(() =>
      objects.value.find((object) => object.className === instance.state.values.value.objectType?.primaryKey) ?? null,
    );
    const selectedRelation = computed(() =>
      relations.value.find((relation) => relation.relationship === instance.state.values.value.relation?.primaryKey) ?? null,
    );
    /** The left column's two sections: the classes and the relations the reader's query and filter leave. */
    const matches = (values, term) => !term || values.some((value) => String(value ?? "").toLowerCase().includes(term));
    const filteredObjects = computed(() => {
      if (filter.value === "relations") return [];
      const term = search.value.trim().toLowerCase();
      return objects.value.filter((object) =>
        matches([object.className, object.showName, object.classDesc, ...attributesOf(object.className).flatMap((item) => [item.name, item.showName])], term),
      );
    });
    const filteredRelations = computed(() => {
      if (filter.value === "objects") return [];
      const term = search.value.trim().toLowerCase();
      return drawableRelations.value.filter((relation) => matches([relation.relationship, relation.name, relation.desc], term));
    });
    const attributesOf = (className) => attributesByClass.value.get(className) ?? [];

    const selectedAttributes = computed(() => attributesByClass.value.get(selectedObject.value?.className ?? "") ?? []);
    const connectedRelations = computed(() =>
      selectedObject.value
        ? relations.value.filter(
            (relation) =>
              relation.fromclass === selectedObject.value.className || relation.toclass === selectedObject.value.className,
          )
        : [],
    );

    /** The relations the canvas can draw: both ends are object types of this domain. */
    const drawableRelations = computed(() =>
      relations.value.filter((relation) => objectNames.value.has(relation.fromclass) && objectNames.value.has(relation.toclass)),
    );

    const highlighted = computed(() => ({
      nodes: instance.state.values.value.highlightedNodes ?? [],
      edges: instance.state.values.value.highlightedEdges ?? [],
    }));
    const hasHighlight = computed(() => highlighted.value.nodes.length > 0 || highlighted.value.edges.length > 0);

    function highlight(nodes, edges) {
      instance.state.setState({
        highlightedNodes: nodes.map((className) => ({ className: OBJECT_TYPE, primaryKey: className })),
        highlightedEdges: edges.map((relationship) => ({ className: RELATIONSHIP, primaryKey: relationship })),
      });
    }
    function clearHighlight() {
      pathMessage.value = "";
      highlight([], []);
    }

    /** What the page highlights: what the query and the filter leave, or nothing when both are open. */
    function highlightBrowsed() {
      if (!search.value.trim() && filter.value === "all") {
        clearHighlight();
        return;
      }
      highlight(
        filteredObjects.value.map((object) => object.className),
        filteredRelations.value.map((relation) => relation.relationship),
      );
    }
    const setFilter = (value) => {
      filter.value = value;
      pathMessage.value = "";
      highlightBrowsed();
    };

    const setSearch = (value) => {
      search.value = value ?? "";
      pathMessage.value = "";
      const term = search.value.trim().toLowerCase();
      if (!term) {
        highlightBrowsed();
        return;
      }
      const words = (className) => (attributesByClass.value.get(className) ?? []).flatMap((item) => [item.name, item.showName]);
      const hitObjects = objects.value.filter((object) =>
        [object.className, object.showName, object.classDesc, ...words(object.className)].some((value) =>
          String(value ?? "").toLowerCase().includes(term),
        ),
      );
      const hitRelations = drawableRelations.value.filter((relation) =>
        [relation.relationship, relation.name, relation.desc].some((value) =>
          String(value ?? "").toLowerCase().includes(term),
        ),
      );
      highlight(
        hitObjects.map((object) => object.className),
        hitRelations.map((relation) => relation.relationship),
      );
    };

    function findPath() {
      const from = pathFrom.value;
      const to = pathTo.value;
      if (!from || !to) {
        pathMessage.value = "先选起点和终点对象类型。";
        return;
      }
      if (from === to) {
        highlight([from], []);
        pathMessage.value = `「${classNameLabel(from)}」自己就是起点和终点。`;
        return;
      }
      const queue = [{ node: from, nodes: [from], edges: [] }];
      const visited = new Set([from]);
      while (queue.length) {
        const current = queue.shift();
        for (const relation of drawableRelations.value) {
          if (relation.fromclass !== current.node || visited.has(relation.toclass)) continue;
          const next = {
            node: relation.toclass,
            nodes: [...current.nodes, relation.toclass],
            edges: [...current.edges, relation.relationship],
          };
          if (next.node === to) {
            highlight(next.nodes, next.edges);
            pathMessage.value = `找到路径：${next.edges.length} 跳`;
            return;
          }
          visited.add(next.node);
          queue.push(next);
        }
      }
      highlight([], []);
      pathMessage.value = `找不到从「${classNameLabel(from)}」到「${classNameLabel(to)}」的路径`;
    }

    function selectObject(className) {
      navigationError.value = "";
      instance.state.setState({ objectType: { className: OBJECT_TYPE, primaryKey: className }, relation: null });
    }

    function selectRelation(relationship) {
      navigationError.value = "";
      instance.state.setState({ relation: { className: RELATIONSHIP, primaryKey: relationship }, objectType: null });
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

    // Selecting an object type or relation highlights its neighbourhood and dims unrelated nodes and edges, matching the
    // original graph explorer; clearing selection restores any active search/filter highlight.
    watch([selectedObject, selectedRelation], ([object, relation]) => {
      if (object) {
        pathMessage.value = "";
        const edges = drawableRelations.value.filter(
          (item) => item.fromclass === object.className || item.toclass === object.className,
        );
        const nodes = new Set([object.className]);
        for (const edge of edges) {
          nodes.add(edge.fromclass);
          nodes.add(edge.toclass);
        }
        highlight([...nodes], edges.map((edge) => edge.relationship));
        return;
      }
      if (relation) {
        pathMessage.value = "";
        highlight(
          [relation.fromclass, relation.toclass].filter((className) => objectNames.value.has(className)),
          [relation.relationship],
        );
        return;
      }
      highlightBrowsed();
    });

    // The agent names the selected object by the owner's label, not by its key alone.
    watch(
      objects,
      (list) => {
        if (list.length)
          instance.nameObjects(OBJECT_TYPE, list.map((object) => ({ primaryKey: object.className, label: object.showName })));
      },
      { immediate: true },
    );
    watch(
      relations,
      (list) => {
        if (list.length)
          instance.nameObjects(
            RELATIONSHIP,
            list.map((relation) => ({ primaryKey: relation.relationship, label: relation.name })),
          );
      },
      { immediate: true },
    );

    return {
      loading,
      readErrors,
      counts,
      objects,
      relations,
      search,
      setSearch,
      filter,
      filterOptions: FILTERS,
      setFilter,
      filteredObjects,
      filteredRelations,
      selectObject,
      selectedObject,
      selectedRelation,
      selectedAttributes,
      connectedRelations,
      pathFrom,
      pathTo,
      pathMessage,
      hasHighlight,
      findPath,
      clearHighlight,
      selectRelation,
      openModeling,
      navigationError,
      classNameLabel,
    };
  },
});
