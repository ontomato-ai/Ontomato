import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

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
    const toast = ref(null);
    const navigationError = ref("");
    const listEl = ref(null);

    let toastTimer = null;
    function showToast(type, text) {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { type, text };
      toastTimer = setTimeout(() => {
        toast.value = null;
        toastTimer = null;
      }, 3200);
    }
    onBeforeUnmount(() => {
      if (toastTimer) clearTimeout(toastTimer);
    });

    const countOf = (rows) => (rows.value.status === "ready" ? rows.value.value.length : null);
    const counts = computed(() => ({
      objects: countOf(objectRows),
      attributes: countOf(attributeRows),
      relations: countOf(relationRows),
    }));
    const loading = computed(() =>
      [objectRows, relationRows, attributeRows].some((rows) => rows.value.status === "loading"),
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

    // Public state: selection, search and highlights, readable by the page's agent and preserved in deep links.
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value ?? ""),
    });
    const requestedObjectKey = computed(() => instance.state.values.value.objectType?.primaryKey ?? "");
    const requestedRelationKey = computed(() => instance.state.values.value.relation?.primaryKey ?? "");
    const selectedObject = computed(() =>
      objects.value.find((object) => object.className === requestedObjectKey.value) ?? null,
    );
    const selectedRelation = computed(() =>
      relations.value.find((relation) => relation.relationship === requestedRelationKey.value) ?? null,
    );
    const missingObjectKey = computed(() =>
      !loading.value && requestedObjectKey.value && !selectedObject.value ? requestedObjectKey.value : "",
    );
    const missingRelationKey = computed(() =>
      !loading.value && requestedRelationKey.value && !selectedRelation.value ? requestedRelationKey.value : "",
    );

    const attributesOf = (className) => attributesByClass.value.get(className) ?? [];
    const drawableRelations = computed(() =>
      relations.value.filter(
        (relation) => objectNames.value.has(relation.fromclass) && objectNames.value.has(relation.toclass),
      ),
    );

    const matches = (values, term) =>
      !term || values.some((value) => String(value ?? "").toLowerCase().includes(term));

    const filteredObjects = computed(() => {
      if (filter.value === "relations") return [];
      const term = search.value.trim().toLowerCase();
      return objects.value.filter((object) =>
        matches(
          [
            object.className,
            object.showName,
            object.classDesc,
            ...attributesOf(object.className).flatMap((item) => [item.name, item.showName]),
          ],
          term,
        ),
      );
    });
    const filteredRelations = computed(() => {
      if (filter.value === "objects") return [];
      const term = search.value.trim().toLowerCase();
      return drawableRelations.value.filter((relation) =>
        matches([relation.relationship, relation.name, relation.desc], term),
      );
    });

    const selectedAttributes = computed(() => attributesByClass.value.get(selectedObject.value?.className ?? "") ?? []);
    const connectedRelations = computed(() =>
      selectedObject.value
        ? relations.value.filter(
            (relation) =>
              relation.fromclass === selectedObject.value.className ||
              relation.toclass === selectedObject.value.className,
          )
        : [],
    );

    // Always scroll the left resource list back to top when query or filter changes so the first hit is never clipped.
    watch([search, filter], () => {
      if (listEl.value) listEl.value.scrollTop = 0;
    });

    // Sync path dropdowns when state is updated externally (e.g. by the page's agent).
    watch(
      () => [
        instance.state.values.value.pathFrom?.primaryKey ?? "",
        instance.state.values.value.pathTo?.primaryKey ?? "",
      ],
      ([from, to]) => {
        if (from && from !== pathFrom.value) pathFrom.value = from;
        if (to && to !== pathTo.value) pathTo.value = to;
      },
    );

    // Clearing either path endpoint removes the active path highlight from the canvas.
    watch([pathFrom, pathTo], ([from, to]) => {
      if ((!from || !to) && (instance.state.values.value.pathFrom || instance.state.values.value.pathTo)) {
        instance.state.setState({ pathFrom: null, pathTo: null });
      }
    });

    function highlight(nodes, edges) {
      instance.state.setState({
        pathFrom: null,
        pathTo: null,
        highlightedNodes: nodes.map((className) => ({ className: OBJECT_TYPE, primaryKey: className })),
        highlightedEdges: edges.map((relationship) => ({ className: RELATIONSHIP, primaryKey: relationship })),
      });
    }
    function clearHighlight() {
      highlight([], []);
    }

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
      highlightBrowsed();
    };

    const setSearch = (value) => {
      search.value = value ?? "";
      const term = search.value.trim().toLowerCase();
      if (!term) {
        highlightBrowsed();
        return;
      }
      const words = (className) =>
        (attributesByClass.value.get(className) ?? []).flatMap((item) => [item.name, item.showName]);
      const hitObjects =
        filter.value === "relations"
          ? []
          : objects.value.filter((object) =>
              [object.className, object.showName, object.classDesc, ...words(object.className)].some((v) =>
                String(v ?? "").toLowerCase().includes(term),
              ),
            );
      const hitRelations =
        filter.value === "objects"
          ? []
          : drawableRelations.value.filter((relation) =>
              [relation.relationship, relation.name, relation.desc].some((v) =>
                String(v ?? "").toLowerCase().includes(term),
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
      if (!from || !to) return;
      instance.state.setState({
        objectType: null,
        relation: null,
        pathFrom: { className: OBJECT_TYPE, primaryKey: from },
        pathTo: { className: OBJECT_TYPE, primaryKey: to },
        highlightedNodes: [],
        highlightedEdges: [],
      });
      if (from === to) {
        showToast("success", "已找到 0 跳路径");
        return;
      }
      const queue = [{ node: from, hops: 0 }];
      const visited = new Set([from]);
      while (queue.length) {
        const current = queue.shift();
        for (const relation of drawableRelations.value) {
          if (relation.fromclass !== current.node || visited.has(relation.toclass)) continue;
          const hops = current.hops + 1;
          if (relation.toclass === to) {
            showToast("success", `已找到 ${hops} 跳路径`);
            return;
          }
          visited.add(relation.toclass);
          queue.push({ node: relation.toclass, hops });
        }
      }
      showToast("warning", "未找到可达路径");
    }

    function selectObject(className) {
      navigationError.value = "";
      instance.state.setState({
        objectType: { className: OBJECT_TYPE, primaryKey: className },
        relation: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    function selectRelation(relationship) {
      navigationError.value = "";
      instance.state.setState({
        relation: { className: RELATIONSHIP, primaryKey: relationship },
        objectType: null,
        pathFrom: null,
        pathTo: null,
        highlightedNodes: [],
        highlightedEdges: [],
      });
    }

    function clearSelection() {
      navigationError.value = "";
      instance.state.setState({
        objectType: null,
        relation: null,
        pathFrom: null,
        pathTo: null,
      });
    }

    // Esc or browser Back clears an active object/relation selection cleanly.
    usePanelBack(
      () => Boolean(requestedObjectKey.value || requestedRelationKey.value),
      clearSelection,
      { pushHistory: true },
    );

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

    // Register human-readable labels for the page's agent context.
    watch(
      objects,
      (list) => {
        if (list.length)
          instance.nameObjects(
            OBJECT_TYPE,
            list.map((object) => ({ primaryKey: object.className, label: object.showName })),
          );
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
      listEl,
      selectObject,
      selectRelation,
      clearSelection,
      selectedObject,
      selectedRelation,
      missingObjectKey,
      missingRelationKey,
      selectedAttributes,
      connectedRelations,
      pathFrom,
      pathTo,
      toast,
      findPath,
      openModeling,
      navigationError,
      classNameLabel,
      refresh: () => instance.refreshObjects(),
    };
  },
});
