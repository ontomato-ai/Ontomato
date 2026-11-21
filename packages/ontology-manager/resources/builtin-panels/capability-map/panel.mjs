import { computed, nextTick, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/*
 * The four-layer capability map. Everything the page shows comes from the platform's own ontology reads, declared on the
 * bound projections: the type catalogue and its per-type readable counts (`schema`, `counts`), one-hop neighbors with
 * their relation statuses (`neighbors`), and the per-type object lists (`objects`). This module coordinates the panel's
 * public state — mode, view, start, selected, selectedType and the highlight query — and draws the parts no official
 * component draws: the layer-grouped type list, the read-only class detail and the node relations pane.
 */

/** The product-layer types that already have an instance directory in the manager. */
const INSTANCE_DIRECTORIES = {
  "platform:SDKComponent": { path: "/ontology/components", nameKey: "cm.dirComponents" },
  "platform:ProductProjection": { path: "/ontology/projections", nameKey: "cm.dirProjections" },
  "platform:ProductPanel": { path: "/ontology/panels", nameKey: "cm.dirPanels" },
  "platform:Application": { path: "/ontology/applications", nameKey: "cm.dirApplications" },
  "platform:AgentDefinition": { path: "/ontology/agents", nameKey: "cm.dirAgents" },
};

const LAYERS = ["fact", "capability", "governance", "product"];

const MODE_OPTIONS = [
  { value: "type", labelKey: "cm.modeType" },
  { value: "instance", labelKey: "cm.modeInstance" },
];

const VIEW_OPTIONS = [
  { value: "graph", labelKey: "cm.viewGraph" },
  { value: "list", labelKey: "cm.viewList" },
];

/** An object identity, as the state and the graph carry it. */
function identity(value) {
  return value && typeof value === "object" && typeof value.className === "string" && typeof value.primaryKey === "string"
    ? { className: value.className, primaryKey: value.primaryKey }
    : null;
}

function identityKey(value) {
  const ref = identity(value);
  return ref ? `${ref.className}\u0000${ref.primaryKey}` : "";
}

/** The types the schema names as a relation's far end. */
function relationTargets(relation) {
  return Array.isArray(relation.to) ? relation.to : [relation.to];
}

const CapabilityMap = {
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const mode = computed(() => (values.value.mode === "type" ? "type" : "instance"));
    const view = computed(() => (values.value.view === "list" ? "list" : "graph"));
    const start = computed(() => identity(values.value.start));
    const selected = computed(() => identity(values.value.selected));
    const selectedType = computed(() => (typeof values.value.selectedType === "string" ? values.value.selectedType : null));
    const query = computed(() => (typeof values.value.query === "string" ? values.value.query : ""));

    const schemaState = usePanelData("classes", "schema");
    const countsState = usePanelData("classes", "counts");
    const neighborsState = usePanelData("relations", "neighbors");

    const schema = computed(() => (schemaState.value.status === "ready" ? schemaState.value.value : null));
    const schemaFailure = computed(() => {
      const status = schemaState.value.status;
      if (status === "ready" || status === "loading") return null;
      return { status, message: schemaState.value.message ?? "" };
    });

    const countByType = computed(() => {
      const counts = countsState.value.status === "ready" ? countsState.value.value.counts ?? [] : [];
      return new Map(counts.map((entry) => [entry.type, entry]));
    });

    /** What a type's instance count reads as: a number only when the owner counted it for this reader. */
    function countOf(typeId) {
      const entry = countByType.value.get(typeId);
      if (!entry) return { status: "loading" };
      return { status: entry.status, count: entry.count, reason: entry.reason };
    }

    const typeById = computed(() => new Map((schema.value?.objectTypes ?? []).map((spec) => [spec.id, spec])));

    function typeLabelKey(typeId) {
      const spec = typeById.value.get(typeId);
      if (spec?.labelKey) return spec.labelKey;
      return `platformOntology.types.${String(typeId).replace(/^platform:/u, "").replace(/^./u, (c) => c.toLowerCase())}`;
    }

    function layerLabelKey(layer) {
      return `platformOntology.layers.${layer}`;
    }

    function relationLabelKey(relationKind) {
      const declared = (schema.value?.relationKinds ?? []).find((relation) => relation.id === relationKind);
      return declared?.labelKey ?? relationKind;
    }

    function relationIsDerived(relationKind) {
      return (schema.value?.relationKinds ?? []).some((relation) => relation.id === relationKind && relation.derived);
    }

    // ---- Type mode: the layer-grouped list and the read-only class detail ----

    const declaredLayers = computed(() => {
      const fromSchema = schema.value?.layers ?? [];
      const known = LAYERS.filter((layer) => fromSchema.length === 0 || fromSchema.includes(layer));
      return known.length ? known : LAYERS;
    });

    const layerGroups = computed(() =>
      declaredLayers.value.map((layer) => ({
        layer,
        labelKey: layerLabelKey(layer),
        types: (schema.value?.objectTypes ?? [])
          .filter((spec) => spec.layer === layer)
          .map((spec) => ({
            id: spec.id,
            labelKey: spec.labelKey ?? typeLabelKey(spec.id),
            definition: spec.definition,
            count: countOf(spec.id),
          }))
          .sort((left, right) => String(left.labelKey).localeCompare(String(right.labelKey))),
      })),
    );

    const typeOptions = computed(() =>
      layerGroups.value.map((group) => ({
        labelKey: group.labelKey,
        options: group.types.map((type) => ({ value: type.id, labelKey: type.labelKey })),
      })),
    );

    const detail = computed(() => {
      const id = selectedType.value;
      const spec = id ? typeById.value.get(id) : undefined;
      if (!spec) return null;
      const relations = schema.value?.relationKinds ?? [];
      const outgoing = relations
        .filter((relation) => relation.from === spec.id)
        .flatMap((relation) => relationTargets(relation).map((peer) => ({
          key: `${relation.id}->${peer}`,
          relationKind: relation.id,
          labelKey: relationLabelKey(relation.id),
          peer,
          peerLabelKey: typeLabelKey(peer),
          derived: Boolean(relation.derived),
        })));
      const incoming = relations
        .filter((relation) => relationTargets(relation).includes(spec.id))
        .map((relation) => ({
          key: `${relation.from}->${relation.id}`,
          relationKind: relation.id,
          labelKey: relationLabelKey(relation.id),
          peer: relation.from,
          peerLabelKey: typeLabelKey(relation.from),
          derived: Boolean(relation.derived),
        }));
      const labelKey = spec.labelKey ?? typeLabelKey(spec.id);
      const detailSlug = labelKey.startsWith("platformOntology.types.")
        ? labelKey.slice("platformOntology.types.".length)
        : "";
      return {
        id: spec.id,
        labelKey,
        layer: spec.layer,
        layerLabelKey: layerLabelKey(spec.layer),
        definition: spec.definition,
        definitionKey: detailSlug ? `platformOntology.typeDetails.${detailSlug}.definition` : "",
        rules: spec.rules,
        rulesKey: detailSlug ? `platformOntology.typeDetails.${detailSlug}.rules` : "",
        properties: (spec.properties ?? []).map((property) => ({
          name: property.name,
          type: property.type,
          optional: Boolean(property.optional),
          description: property.description,
          descriptionKey: detailSlug ? `platformOntology.typeDetails.${detailSlug}.properties.${property.name}` : "",
        })),
        reads: Object.entries(spec.reads ?? {}).map(([name, declaration]) => ({
          name,
          parameters: declaration.parameterMode === "fixed"
            ? Object.keys(declaration.params ?? {})
            : [declaration.parameter?.id ?? declaration.parameter ?? ""],
          required: declaration.requiredParams ?? [],
          result: declaration.result,
          source: declaration.source,
        })),
        operations: (spec.operations ?? []).map((operation) => ({
          id: operation.id,
          kind: operation.kind,
          effect: operation.effect,
          // A form save's input is the owner's form, carried as one object schema: its fields are what a caller supplies.
          inputs: Object.keys(operation.inputSchema?.properties ?? operation.inputSchema ?? {}),
          batch: Boolean(operation.batch),
        })),
        outgoing,
        incoming,
        count: countOf(spec.id),
        directory: INSTANCE_DIRECTORIES[spec.id] ?? null,
      };
    });

    const pickType = computed({
      get: () => selectedType.value,
      set: (next) => state.set("selectedType", typeof next === "string" && next ? next : null),
    });

    function selectType(typeId) {
      state.set("selectedType", typeId ?? null);
      pickingStart.value = false;
    }

    const notice = ref(null);

    /** Opens the product-layer instance directory; a directory this deployment has not connected says so in place. */
    async function openInstances(type) {
      const entry = type?.directory;
      if (!entry) return;
      notice.value = null;
      try {
        await navigate(entry.path);
      } catch (reason) {
        notice.value = {
          name: t(entry.nameKey),
          reason: reason instanceof Error ? reason.message : String(reason),
        };
      }
    }

    // ---- Instance mode: the start, the type picker and the node relations ----

    const pickingStart = ref(false);
    const showUserPicker = ref(false);
    const relationFilter = computed({
      get: () => {
        const held = values.value.relationKinds;
        if (!Array.isArray(held)) return [];
        return held
          .map((entry) => (entry && typeof entry.primaryKey === "string" ? entry.primaryKey : null))
          .filter(Boolean);
      },
      set: (ids) => {
        const list = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.length > 0) : [];
        state.set(
          "relationKinds",
          list.length ? list.map((id) => ({ className: "platform:OntologyRelationKind", primaryKey: id })) : null,
        );
      },
    });

    const hasCustomStart = computed(() => start.value !== null);
    const canUseSelectedAsStart = computed(() =>
      Boolean(selected.value) && identityKey(selected.value) !== identityKey(start.value));

    function startFrom(ref) {
      const next = identity(ref);
      if (!next) return;
      showUserPicker.value = false;
      pickingStart.value = false;
      state.setState({ start: next, selected: next, mode: "instance" });
    }

    function useSelectedAsStart() {
      if (!canUseSelectedAsStart.value) return;
      state.setState({ start: { ...selected.value } });
    }

    function resetStart() {
      showUserPicker.value = false;
      pickingStart.value = false;
      state.setState({ mode: "instance", start: null, selected: null });
    }

    function toggleUserPicker() {
      showUserPicker.value = !showUserPicker.value;
    }

    /** The object picker sits under a long class detail; opening it brings it into view instead of leaving it below. */
    const pickerSection = ref(null);
    watch(pickingStart, (open) => {
      if (!open) return;
      void nextTick(() => pickerSection.value?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });

    function togglePickingStart() {
      pickingStart.value = !pickingStart.value;
      if (pickingStart.value && !selectedType.value) {
        const first = layerGroups.value.find((group) => group.types.length)?.types[0];
        if (first) state.set("selectedType", first.id);
      }
    }

    function selectPeer(ref) {
      const next = identity(ref);
      if (next) state.set("selected", next);
    }

    // A start chosen anywhere — the user picker, the type picker, the relations pane — always opens instance mode from it.
    watch(
      () => identityKey(values.value.start),
      (nextKey, previousKey) => {
        if (!nextKey || nextKey === previousKey) return;
        const nextStart = identity(values.value.start);
        if (!nextStart) return;
        showUserPicker.value = false;
        pickingStart.value = false;
        if (values.value.mode !== "instance") state.set("mode", "instance");
        if (identityKey(values.value.selected) !== nextKey) state.set("selected", { ...nextStart });
      },
    );

    watch(mode, (next, previous) => {
      if (next === previous) return;
      showUserPicker.value = false;
      if (next === "instance") pickingStart.value = false;
    });

    const relationState = computed(() => {
      const current = neighborsState.value;
      if (current.status === "ready") return { status: "ready", value: current.value };
      return { status: current.status, message: current.message ?? "" };
    });

    const relationGroups = computed(() => {
      const current = relationState.value;
      if (current.status !== "ready") return [];
      const data = current.value;
      const nodes = new Map();
      nodes.set(identityKey(data.node), data.node);
      for (const neighbor of data.neighbors) nodes.set(identityKey(neighbor), neighbor);

      const edgesByKind = new Map();
      for (const edge of data.edges) {
        const bucket = edgesByKind.get(edge.relationKind) ?? [];
        bucket.push(edge);
        edgesByKind.set(edge.relationKind, bucket);
      }

      const toRow = (edge) => {
        const peer = edge.direction === "outgoing" ? edge.to : edge.from;
        const peerNode = nodes.get(identityKey(peer));
        return {
          id: edge.id,
          direction: edge.direction,
          derived: Boolean(edge.derived) || relationIsDerived(edge.relationKind),
          peer: { className: peer.className, primaryKey: peer.primaryKey },
          peerLabel: peerNode?.label ?? peer.primaryKey,
          peerTypeLabelKey: typeLabelKey(peer.className),
          peerTypeId: peer.className,
          binding: edge.binding ?? null,
        };
      };

      const groups = [];
      const seen = new Set();
      for (const status of data.relations) {
        seen.add(status.relationKind);
        const rows = (edgesByKind.get(status.relationKind) ?? []).map(toRow);
        groups.push({
          relationKind: status.relationKind,
          labelKey: relationLabelKey(status.relationKind),
          status: status.status,
          reason: status.reason,
          derived: rows.length ? rows[0].derived : relationIsDerived(status.relationKind),
          rows,
        });
      }
      for (const [relationKind, edges] of edgesByKind) {
        if (seen.has(relationKind)) continue;
        const rows = edges.map(toRow);
        groups.push({
          relationKind,
          labelKey: relationLabelKey(relationKind),
          status: "ok",
          derived: rows.length ? rows[0].derived : relationIsDerived(relationKind),
          rows,
        });
      }
      const order = { refused: 0, failed: 1, unavailable: 2, ok: 3 };
      return groups.sort((left, right) =>
        (order[left.status] ?? 3) - (order[right.status] ?? 3)
        || String(left.labelKey).localeCompare(String(right.labelKey)));
    });

    const allRelationKinds = computed(() =>
      (schema.value?.relationKinds ?? [])
        .map((relation) => ({ value: relation.id, labelKey: relation.labelKey ?? relation.id }))
        .sort((left, right) => String(left.labelKey).localeCompare(String(right.labelKey))));

    const relationKindsAvailable = computed(() => {
      const byId = new Map(
        relationGroups.value.map((group) => [group.relationKind, { value: group.relationKind, labelKey: group.labelKey }]),
      );
      for (const id of relationFilter.value) {
        if (!byId.has(id)) byId.set(id, { value: id, labelKey: relationLabelKey(id) });
      }
      return [...byId.values()];
    });

    /** The relation kinds the reader kept, before the empty ones are summarized. */
    const filteredRelationGroups = computed(() => {
      const chosen = new Set(relationFilter.value);
      if (!chosen.size) return relationGroups.value;
      return relationGroups.value.filter((group) => chosen.has(group.relationKind));
    });

    /** The kinds worth drawing a group for: those with a relation, or one the owner could not read. */
    const visibleRelationGroups = computed(() =>
      filteredRelationGroups.value.filter((group) => group.rows.length > 0 || group.status !== "ok"));

    /** The declared kinds this node simply has no relation of, counted rather than repeated as empty groups. */
    const emptyRelationGroups = computed(() =>
      filteredRelationGroups.value.filter((group) => group.rows.length === 0 && group.status === "ok"));

    const relationSummary = computed(() => {
      const current = relationState.value;
      if (current.status !== "ready") return null;
      const groups = relationGroups.value;
      const kinds = (status) => groups
        .filter((group) => group.status === status)
        .map((group) => ({ relationKind: group.relationKind, labelKey: group.labelKey }));
      const edgeCount = current.value.edges.length;
      const refused = kinds("refused");
      const failed = kinds("failed");
      const unavailable = kinds("unavailable");
      return {
        edgeCount,
        refused,
        failed,
        unavailable,
        noNeighbors: edgeCount === 0 && !refused.length && !failed.length && !unavailable.length,
      };
    });

    const currentNode = computed(() => (relationState.value.status === "ready" ? relationState.value.value.node : null));

    /** The selected node's type, named by the catalogue rather than by its identifier. */
    const selectedTypeKey = computed(() => (selected.value ? typeLabelKey(selected.value.className) : ""));

    function onQueryInput(event) {
      const text = event.target?.value ?? "";
      state.set("query", text || null);
    }

    function clearQuery() {
      state.set("query", null);
    }

    function setMode(value) {
      state.set("mode", value === "type" ? "type" : "instance");
    }

    function setView(value) {
      state.set("view", value === "list" ? "list" : "graph");
    }

    return {
      mode,
      view,
      modeOptions: MODE_OPTIONS,
      viewOptions: VIEW_OPTIONS,
      setMode,
      setView,
      start,
      selected,
      selectedType,
      query,
      notice,
      schema,
      schemaFailure,
      layerGroups,
      typeOptions,
      detail,
      pickType,
      selectType,
      openInstances,
      countOf,
      pickerSection,
      pickingStart,
      togglePickingStart,
      showUserPicker,
      toggleUserPicker,
      hasCustomStart,
      canUseSelectedAsStart,
      useSelectedAsStart,
      resetStart,
      startFrom,
      selectPeer,
      relationState,
      relationGroups,
      visibleRelationGroups,
      emptyRelationGroups,
      selectedTypeKey,
      allRelationKinds,
      relationKindsAvailable,
      relationFilter,
      relationSummary,
      currentNode,
      onQueryInput,
      clearQuery,
    };
  },
};

await mountPanel(CapabilityMap);
