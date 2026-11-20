<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { matchesObjectType, type PanelStateValue } from "@ontomato/contracts/panel-manifest";
import type {
  PlatformOntologyCountsResponse,
  PlatformOntologyStartResponse,
} from "@ontomato/contracts/platform-ontology";
import { platformObjectTypes, platformRelationKinds } from "@ontomato/contracts/platform-object-types";
import {
  G6GraphCanvas,
  graphCategorySlot,
  readGraphPalette,
  type GraphCanvasEdge,
  type GraphCanvasNode,
  type GraphCanvasPoint,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
import {
  slotInputState,
  slotOutputState,
  usePanelContext,
  useProjectionGraph,
  useProjectionSlot,
} from "../panel/context";
import type { MemberDataState } from "../panel/direct";
import { useMember, useMemberRead, type PanelMemberContext } from "../panel/member";
import type {
  PlatformGraphEdge,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphRelationStatus,
  PlatformGraphSchema,
  PlatformGraphTypeCount,
  PlatformObjectGraph,
} from "../panel/platform-objects";

type PanelObjectValue = Extract<PanelStateValue, { className: string }>;
import {
  encodeGraphNodeId,
  layoutInstanceRadial,
  layoutTypeColumns,
  placeExpandedNeighbors,
  summarizeGraphRelations,
} from "./ontology-graph-layout";

/**
 * Projection-level interactive graph powered by G6 (`@ontomato/foundation-ui/graph/g6`), shared by the four-layer
 * platform capability map (M3: type mode + instance mode) and the object browser instance graph (M4: instance mode).
 *
 * In a directly rendered projection, reads `schema`, `counts`, `start`, and `neighbors` through the member's named
 * data port; in a legacy frame projection, reads through the bound resource adapter's `graph` port. Keeps layer
 * filters, expanded nodes, dragged coordinates and viewport as internal view state rather than panel state. Node
 * selection always writes complete `{ className, primaryKey }` identities.
 */
const props = withDefaults(
  defineProps<{
    /** `"type"` draws declared types & relation kinds in layer columns; `"instance"` explores 1-hop neighbors. */
    mode?: "type" | "instance";
    /** Starting node identity for instance mode; when omitted/null, reads the resource's `start()` node. */
    start?: PanelObjectValue | null;
    /** Currently selected instance node identity. */
    selected?: PanelObjectValue | null;
    /** Currently selected type ID in type mode (e.g. `"platform:Action"`). */
    selectedType?: string | null;
    /** Search string that highlights drawn matches without hiding other nodes or querying upstream. */
    query?: string | null;
    /** Accessible graph label; falls back to the projection's name. */
    label?: string;
    /** Initial enabled layers; defaults to all layers present in schema or loaded nodes. */
    layers?: readonly string[] | null;
    /** Show layer filter pills when multiple layers exist. */
    showLayerFilter?: boolean;
    /** Show legend strip. */
    showLegend?: boolean;
    /** Show floating fit/relayout toolbar. */
    showToolbar?: boolean;
    /** Optional max height in CSS pixels forwarded to `G6GraphCanvas`. */
    maxHeight?: number;
  }>(),
  {
    mode: "instance",
    start: null,
    selected: null,
    selectedType: null,
    query: "",
    label: undefined,
    layers: undefined,
    showLayerFilter: true,
    showLegend: true,
    showToolbar: true,
    maxHeight: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted in instance mode when a reader selects a node (full identity) or clears selection. */
  "update:selected": [node: PanelObjectValue | null];
  /** Emitted in type mode when a reader selects a type node or clears selection. */
  "update:selectedType": [typeId: string | null];
}>();

class MemberReadForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberReadForbiddenError";
  }
}

const { t, te } = useI18n();
const panel = usePanelContext();
const slot = useProjectionSlot();
const member = useMember();

function createMemberGraphSource(ctx: PanelMemberContext): PlatformObjectGraph {
  const unwrap = <T>(state: MemberDataState): T => {
    if (state.status === "ready") return state.value as unknown as T;
    if (state.status === "forbidden") throw new MemberReadForbiddenError(t("platform.dataForbidden"));
    if (state.status === "error") throw new Error(state.message);
    throw new Error(t("platform.dataAwaiting"));
  };
  if (!ctx.projection.data.neighbors) throw new Error(`Member '${ctx.key}' declares no 'neighbors' datum`);
  const readSchema = ctx.projection.data.schema ? useMemberRead("schema") : undefined;
  const readCounts = ctx.projection.data.counts ? useMemberRead("counts") : undefined;
  const readStart = ctx.projection.data.start ? useMemberRead("start") : undefined;
  const readNeighbors = useMemberRead("neighbors");
  return {
    ...(readSchema ? { schema: async () => unwrap<PlatformGraphSchema>(await readSchema({})) } : {}),
    ...(readCounts ? { counts: async () => unwrap<PlatformOntologyCountsResponse>(await readCounts({})).counts } : {}),
    ...(readStart ? { start: async () => unwrap<PlatformOntologyStartResponse>(await readStart({})).node } : {}),
    neighbors: async (query) =>
      unwrap<PlatformGraphNeighborsResult>(await readNeighbors({
        node: { className: query.node.className, primaryKey: query.node.primaryKey },
        ...(query.layers ? { layers: [...query.layers] } : {}),
        ...(query.relationKinds ? { relationKinds: [...query.relationKinds] } : {}),
      })),
  };
}

const graphSource = member ? createMemberGraphSource(member) : useProjectionGraph();

const relationLabelKeyById = new Map(platformRelationKinds.map((kind) => [kind.id, kind.labelKey]));

const rootEl = ref<HTMLElement | null>(null);
const canvas = ref<InstanceType<typeof G6GraphCanvas> | null>(null);
const paletteSize = ref(0);

const loading = ref(false);
const expanding = ref(false);
const forbidden = ref(false);
const errorMessage = ref<string | null>(null);

function recordFailure(reason: unknown) {
  if (reason instanceof MemberReadForbiddenError) {
    forbidden.value = true;
    errorMessage.value = null;
    return;
  }
  forbidden.value = false;
  errorMessage.value = reason instanceof Error ? reason.message : String(reason);
}

// Type-mode state
const typeSchema = shallowRef<PlatformGraphSchema | null>(null);
const typeCounts = shallowRef<readonly PlatformGraphTypeCount[]>([]);

// Instance-mode state (accumulated drawn subgraph)
const rootNodeId = ref<string | null>(null);
const instanceNodes = shallowRef<Map<string, PlatformGraphNode>>(new Map());
const instanceEdges = shallowRef<Map<string, PlatformGraphEdge>>(new Map());
const expandedNodes = shallowRef<Set<string>>(new Set());
const expandingNodeIds = new Set<string>();
const fetchedLayersByNode = shallowRef<Map<string, Set<string> | null>>(new Map());
const relationStatusesByNode = shallowRef<Map<string, readonly PlatformGraphRelationStatus[]>>(new Map());
const instancePositions = shallowRef<Map<string, GraphCanvasPoint>>(new Map());

// Internal view state (deliberately excluded from panel state)
const initialLayers = Array.isArray(props.layers) ? props.layers : [];
const enabledLayers = shallowRef<Set<string>>(new Set(initialLayers));
const layersInitialized = ref(initialLayers.length > 0);
const manualPositions = shallowRef<Map<string, GraphCanvasPoint>>(new Map());
const currentViewport = shallowRef<GraphCanvasViewport | null>(null);
const focusedNodeId = ref<string | null>(null);

let loadGeneration = 0;

const activeMode = computed<"type" | "instance">(() => (props.mode === "type" ? "type" : "instance"));
const accessibleLabel = computed(() => props.label ?? slot.projection.name);

const declaredNodeIdentity = computed(() => {
  if (slot.projection.graph?.nodeIdentity) return slot.projection.graph.nodeIdentity;
  if (!member) return undefined;
  const candidate =
    member.projection.outputs.selectedNode
    ?? member.projection.outputs.selected
    ?? member.projection.inputs.selected
    ?? member.projection.inputs.start;
  return candidate && (candidate.kind === "object" || candidate.kind === "object-union") ? candidate : undefined;
});

function resolveKey(key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  if (te(key)) return t(key);
  const fromPanel = panel.t(key);
  return fromPanel !== key ? fromPanel : fallback;
}

function typeDisplayName(typeId: string, labelKey?: string, explicitLabel?: string): string {
  if (explicitLabel) return explicitLabel;
  return resolveKey(labelKey ?? platformObjectTypes[typeId]?.labelKey, typeId);
}

function layerDisplayName(layer: string): string {
  return resolveKey(`platformOntology.layers.${layer}`, layer);
}

function relationDisplayName(relationKind: string, explicitLabel?: string, labelKey?: string): string {
  if (explicitLabel) return resolveKey(explicitLabel, explicitLabel);
  const fromSchema = typeSchema.value?.relationKinds.find((item) => item.id === relationKind);
  const key = labelKey ?? fromSchema?.labelKey ?? relationLabelKeyById.get(relationKind);
  return resolveKey(key, fromSchema?.label ?? relationKind);
}

const availableLayers = computed<readonly string[]>(() => {
  if (activeMode.value === "type" && typeSchema.value) {
    if (typeSchema.value.layers?.length) return typeSchema.value.layers;
    const discovered = new Set<string>();
    for (const spec of typeSchema.value.objectTypes) {
      if (spec.layer) discovered.add(spec.layer);
    }
    return [...discovered];
  }
  const declaredIdentity = declaredNodeIdentity.value;
  if (declaredIdentity && "layers" in declaredIdentity) {
    return declaredIdentity.layers;
  }
  const discovered = new Set<string>();
  for (const node of instanceNodes.value.values()) {
    if (node.layer) discovered.add(node.layer);
  }
  return [...discovered];
});

watch(
  availableLayers,
  (layers) => {
    if (!layersInitialized.value && layers.length > 0) {
      enabledLayers.value = new Set(layers);
      layersInitialized.value = true;
    }
  },
  { immediate: true },
);

function toggleLayer(layer: string) {
  const next = new Set(enabledLayers.value);
  const adding = !next.has(layer);
  if (adding) next.add(layer);
  else next.delete(layer);
  enabledLayers.value = next;

  if (adding && activeMode.value === "instance") {
    for (const nodeId of expandedNodes.value) {
      const fetched = fetchedLayersByNode.value.get(nodeId);
      if (fetched !== null && fetched !== undefined && !fetched.has(layer)) {
        const node = instanceNodes.value.get(nodeId);
        if (node) void expandInstanceNode({ className: node.className, primaryKey: node.primaryKey }, loadGeneration, false, true);
      }
    }
  }
}

function isLayerVisible(layer: string | undefined): boolean {
  if (!layer || availableLayers.value.length === 0) return true;
  return enabledLayers.value.has(layer);
}

const queryNeedle = computed(() => (props.query ?? "").trim().toLowerCase());

// ---- Type-mode computed graph ----
const countByType = computed(() => new Map(typeCounts.value.map((entry) => [entry.type, entry])));

const visibleTypeSpecs = computed(() => {
  const schema = typeSchema.value;
  if (!schema) return [];
  return schema.objectTypes.filter((spec) => isLayerVisible(spec.layer));
});

const typePositions = computed(() => layoutTypeColumns(visibleTypeSpecs.value, availableLayers.value));

const typeCanvasNodes = computed<GraphCanvasNode[]>(() => {
  const needle = queryNeedle.value;
  return visibleTypeSpecs.value.map((spec) => {
    const baseName = typeDisplayName(spec.id, spec.labelKey, spec.label);
    const countEntry = countByType.value.get(spec.id);
    let label = baseName;
    let title = baseName;
    if (countEntry) {
      if (countEntry.status === "ok" && countEntry.count !== undefined) {
        label = `${baseName} (${countEntry.count})`;
        title = label;
      } else if (countEntry.status === "refused") {
        label = `${baseName} · ${t("platform.graphStatusRefused")}`;
        title = countEntry.reason ? `${label} (${countEntry.reason})` : label;
      } else if (countEntry.status === "failed") {
        label = `${baseName} · ${t("platform.graphStatusFailed")}`;
        title = countEntry.reason ? `${label} (${countEntry.reason})` : label;
      } else if (countEntry.status === "unavailable") {
        label = `${baseName} · ${t("platform.graphStatusUnavailable")}`;
        title = countEntry.reason ? `${label} (${countEntry.reason})` : label;
      }
    }
    const position = manualPositions.value.get(spec.id) ?? typePositions.value.get(spec.id) ?? { x: 0, y: 0 };
    const matches = !needle || baseName.toLowerCase().includes(needle) || spec.id.toLowerCase().includes(needle);
    return {
      id: spec.id,
      label,
      title,
      category: spec.layer ?? spec.id,
      tone: needle ? (matches ? "accent" : "muted") : "default",
      x: position.x,
      y: position.y,
    };
  });
});

const typeCanvasEdges = computed<GraphCanvasEdge[]>(() => {
  const schema = typeSchema.value;
  if (!schema) return [];
  const visibleIds = new Set(visibleTypeSpecs.value.map((spec) => spec.id));
  const needle = queryNeedle.value;
  const matchedIds = needle
    ? new Set(typeCanvasNodes.value.filter((node) => node.tone === "accent").map((node) => node.id))
    : null;
  const edges: GraphCanvasEdge[] = [];
  for (const relation of schema.relationKinds) {
    if (!visibleIds.has(relation.from)) continue;
    const targets = typeof relation.to === "string" ? [relation.to] : relation.to;
    const label = relationDisplayName(relation.id, relation.label, relation.labelKey);
    for (const target of targets) {
      if (!visibleIds.has(target)) continue;
      edges.push({
        id: `${relation.id}:${relation.from}->${target}`,
        source: relation.from,
        target,
        label,
        line: relation.derived ? "dashed" : "solid",
        tone: matchedIds ? (matchedIds.has(relation.from) || matchedIds.has(target) ? "default" : "muted") : "default",
      });
    }
  }
  return edges;
});

// ---- Instance-mode computed graph ----
const visibleInstanceNodes = computed<readonly PlatformGraphNode[]>(() =>
  [...instanceNodes.value.values()].filter((node) => isLayerVisible(node.layer)),
);

const visibleInstanceNodeIds = computed(() => new Set(visibleInstanceNodes.value.map((node) => encodeGraphNodeId(node))));

const visibleInstanceEdges = computed<readonly PlatformGraphEdge[]>(() =>
  [...instanceEdges.value.values()].filter(
    (edge) => visibleInstanceNodeIds.value.has(encodeGraphNodeId(edge.from)) && visibleInstanceNodeIds.value.has(encodeGraphNodeId(edge.to)),
  ),
);

const instanceCategories = computed<readonly string[]>(() => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const node of instanceNodes.value.values()) {
    if (!seen.has(node.className)) {
      seen.add(node.className);
      ordered.push(node.className);
    }
  }
  return ordered;
});

const instanceCanvasNodes = computed<GraphCanvasNode[]>(() => {
  const needle = queryNeedle.value;
  return visibleInstanceNodes.value.map((node) => {
    const id = encodeGraphNodeId(node);
    const position = manualPositions.value.get(id) ?? instancePositions.value.get(id) ?? { x: 0, y: 0 };
    const matches =
      !needle
      || node.label.toLowerCase().includes(needle)
      || node.primaryKey.toLowerCase().includes(needle)
      || (node.detail?.toLowerCase().includes(needle) ?? false);
    return {
      id,
      label: node.label,
      title: node.detail ? `${node.label} — ${node.detail}` : `${typeDisplayName(node.className)}: ${node.label}`,
      category: node.className,
      tone: needle ? (matches ? "accent" : "muted") : "default",
      x: position.x,
      y: position.y,
    };
  });
});

const instanceCanvasEdges = computed<GraphCanvasEdge[]>(() => {
  const needle = queryNeedle.value;
  const matchedIds = needle
    ? new Set(instanceCanvasNodes.value.filter((node) => node.tone === "accent").map((node) => node.id))
    : null;
  return visibleInstanceEdges.value.map((edge) => {
    const source = encodeGraphNodeId(edge.from);
    const target = encodeGraphNodeId(edge.to);
    return {
      id: edge.id,
      source,
      target,
      label: relationDisplayName(edge.relationKind, edge.label),
      line: edge.derived ? "dashed" : "solid",
      tone: matchedIds ? (matchedIds.has(source) || matchedIds.has(target) ? "default" : "muted") : "default",
    };
  });
});

// ---- Active canvas bindings ----
const canvasNodes = computed(() => (activeMode.value === "type" ? typeCanvasNodes.value : instanceCanvasNodes.value));
const canvasEdges = computed(() => (activeMode.value === "type" ? typeCanvasEdges.value : instanceCanvasEdges.value));
const canvasCategories = computed(() => (activeMode.value === "type" ? availableLayers.value : instanceCategories.value));
const canvasSelectedIds = computed<readonly string[]>(() => {
  if (activeMode.value === "type") {
    return props.selectedType ? [props.selectedType] : [];
  }
  return props.selected ? [encodeGraphNodeId(props.selected)] : [];
});

const queryMatchCount = computed(() => {
  if (!queryNeedle.value) return null;
  return canvasNodes.value.filter((node) => node.tone === "accent").length;
});

// ---- Legend ----
const instanceLegend = computed(() => {
  const counts = new Map<string, number>();
  for (const node of visibleInstanceNodes.value) {
    counts.set(node.className, (counts.get(node.className) ?? 0) + 1);
  }
  return [...counts.entries()].map(([className, count]) => ({
    className,
    label: typeDisplayName(className),
    count,
    color: categoryColor(className),
  }));
});

const typeLegend = computed(() => {
  const counts = new Map<string, number>();
  for (const spec of visibleTypeSpecs.value) {
    const layer = spec.layer ?? "";
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  return availableLayers.value
    .filter((layer) => enabledLayers.value.has(layer))
    .map((layer) => ({
      layer,
      label: layerDisplayName(layer),
      count: counts.get(layer) ?? 0,
      color: categoryColor(layer),
    }));
});

function categoryColor(category: string): string | undefined {
  if (!paletteSize.value) return undefined;
  return `var(--chart-${graphCategorySlot(category, canvasCategories.value, paletteSize.value) + 1})`;
}

// ---- Three-state relation summary for focused instance node ----
const activeRelationStatuses = computed<readonly PlatformGraphRelationStatus[] | null>(() => {
  if (activeMode.value !== "instance") return null;
  const targetId = focusedNodeId.value ?? (props.selected ? encodeGraphNodeId(props.selected) : null) ?? rootNodeId.value;
  if (!targetId) return null;
  return relationStatusesByNode.value.get(targetId) ?? null;
});

const relationSummary = computed(() =>
  activeRelationStatuses.value ? summarizeGraphRelations(activeRelationStatuses.value) : null,
);

const focusedNodeLabel = computed(() => {
  const targetId = focusedNodeId.value ?? (props.selected ? encodeGraphNodeId(props.selected) : null) ?? rootNodeId.value;
  if (!targetId) return "";
  return instanceNodes.value.get(targetId)?.label ?? "";
});

function formatRelationNames(statuses: readonly PlatformGraphRelationStatus[]): string {
  return statuses
    .map((entry) => {
      const name = relationDisplayName(entry.relationKind);
      return entry.reason ? `${name} (${entry.reason})` : name;
    })
    .join(", ");
}

// ---- Panel state output writers ----
function resolveInstanceSelectionState(): string | null {
  return (
    slotOutputState(panel.manifest, slot.slot, "selectedNode")
    ?? slotOutputState(panel.manifest, slot.slot, "selected")
    ?? slotInputState(panel.manifest, slot.slot, "selected")
  );
}

function resolveTypeSelectionState(): string | null {
  return (
    slotOutputState(panel.manifest, slot.slot, "selectedType")
    ?? slotInputState(panel.manifest, slot.slot, "selectedType")
  );
}

function writeSelectedNode(refValue: PanelObjectValue | null) {
  const declaredIdentity = declaredNodeIdentity.value;
  if (refValue && declaredIdentity && !matchesObjectType(declaredIdentity, refValue.className)) {
    throw new TypeError(`Graph node '${refValue.className}' is outside the projection's declared nodeIdentity`);
  }
  const stateName = resolveInstanceSelectionState();
  if (stateName) {
    panel.instance.state.set(stateName, refValue ? { className: refValue.className, primaryKey: refValue.primaryKey } : null);
  }
  emit("update:selected", refValue);
}

function writeSelectedType(typeId: string | null) {
  const stateName = resolveTypeSelectionState();
  if (stateName) panel.instance.state.set(stateName, typeId);
  emit("update:selectedType", typeId);
}

// ---- Data loading & incremental 1-hop expansion ----
async function loadTypeMode(generation: number) {
  loading.value = true;
  forbidden.value = false;
  errorMessage.value = null;
  try {
    const schemaPromise = graphSource.schema!();
    const countsPromise = graphSource.counts ? graphSource.counts() : Promise.resolve<readonly PlatformGraphTypeCount[]>([]);
    const [schema, counts] = await Promise.all([schemaPromise, countsPromise]);
    if (generation !== loadGeneration) return;
    typeSchema.value = schema;
    typeCounts.value = counts;
    manualPositions.value = new Map();
    if (!layersInitialized.value && schema.layers?.length) {
      enabledLayers.value = new Set(schema.layers);
      layersInitialized.value = true;
    }
    await nextTick();
    void canvas.value?.fit({ maxZoom: 1.15, padding: 36 });
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

async function expandInstanceNode(refValue: PanelObjectValue, generation: number, isRoot = false, force = false) {
  const nodeId = encodeGraphNodeId(refValue);
  if ((!force && expandedNodes.value.has(nodeId)) || expandingNodeIds.has(nodeId)) return;
  expandingNodeIds.add(nodeId);

  if (isRoot) loading.value = true;
  else expanding.value = true;
  forbidden.value = false;
  errorMessage.value = null;

  const activeLayers = availableLayers.value.length > 0 ? [...enabledLayers.value] : undefined;
  const allLayersActive = activeLayers !== undefined && activeLayers.length === availableLayers.value.length;

  try {
    const result = await graphSource.neighbors({
      node: refValue,
      ...(activeLayers ? { layers: activeLayers } : {}),
    });
    if (generation !== loadGeneration) return;

    const nextNodes = new Map(instanceNodes.value);
    const centerId = encodeGraphNodeId(result.node);
    nextNodes.set(centerId, result.node);
    const addedIds: string[] = [];
    for (const neighbor of result.neighbors) {
      const id = encodeGraphNodeId(neighbor);
      if (!nextNodes.has(id)) addedIds.push(id);
      nextNodes.set(id, neighbor);
    }

    const nextEdges = new Map(instanceEdges.value);
    for (const edge of result.edges) {
      nextEdges.set(edge.id, edge);
    }

    const nextPositions = new Map(instancePositions.value);
    if (!nextPositions.has(centerId)) {
      nextPositions.set(centerId, { x: 0, y: 0 });
    }
    const anchor = manualPositions.value.get(centerId) ?? nextPositions.get(centerId)!;
    const origin = (rootNodeId.value && nextPositions.get(rootNodeId.value)) || { x: 0, y: 0 };
    const placed = placeExpandedNeighbors(anchor, origin, addedIds, nextPositions);

    const nextExpanded = new Set(expandedNodes.value);
    nextExpanded.add(centerId);
    const nextFetched = new Map(fetchedLayersByNode.value);
    nextFetched.set(centerId, !activeLayers || allLayersActive ? null : new Set(activeLayers));
    const nextStatuses = new Map(relationStatusesByNode.value);
    nextStatuses.set(centerId, result.relations);

    instanceNodes.value = nextNodes;
    instanceEdges.value = nextEdges;
    instancePositions.value = placed;
    expandedNodes.value = nextExpanded;
    fetchedLayersByNode.value = nextFetched;
    relationStatusesByNode.value = nextStatuses;
    focusedNodeId.value = centerId;
    if (isRoot) rootNodeId.value = centerId;

    if (isRoot) {
      await nextTick();
      void canvas.value?.fit({ maxZoom: 1.15, padding: 36 });
    }
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
  } finally {
    expandingNodeIds.delete(nodeId);
    if (generation === loadGeneration) {
      loading.value = false;
      expanding.value = false;
    }
  }
}

async function loadInstanceMode(generation: number) {
  loading.value = true;
  forbidden.value = false;
  errorMessage.value = null;
  instanceNodes.value = new Map();
  instanceEdges.value = new Map();
  expandedNodes.value = new Set();
  expandingNodeIds.clear();
  fetchedLayersByNode.value = new Map();
  relationStatusesByNode.value = new Map();
  instancePositions.value = new Map();
  manualPositions.value = new Map();
  rootNodeId.value = null;
  focusedNodeId.value = null;

  try {
    let startRef: PanelObjectValue | null = props.start ? { className: props.start.className, primaryKey: props.start.primaryKey } : null;
    if (!startRef) {
      const startNode = await graphSource.start?.();
      if (generation !== loadGeneration) return;
      if (!startNode) {
        loading.value = false;
        return;
      }
      startRef = { className: startNode.className, primaryKey: startNode.primaryKey };
      const seeded = new Map<string, PlatformGraphNode>();
      const startId = encodeGraphNodeId(startNode);
      seeded.set(startId, startNode);
      instanceNodes.value = seeded;
      instancePositions.value = new Map([[startId, { x: 0, y: 0 }]]);
      rootNodeId.value = startId;
    }
    await expandInstanceNode(startRef, generation, true);
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
    loading.value = false;
  }
}

function reload() {
  const generation = ++loadGeneration;
  if (activeMode.value === "type") void loadTypeMode(generation);
  else void loadInstanceMode(generation);
}

watch(
  () => [activeMode.value, props.start?.className ?? "", props.start?.primaryKey ?? ""] as const,
  () => reload(),
  { immediate: true },
);

watch(
  () => [props.selected?.className ?? "", props.selected?.primaryKey ?? ""] as const,
  ([className, primaryKey]) => {
    if (activeMode.value !== "instance" || !className || !primaryKey) return;
    const id = encodeGraphNodeId({ className, primaryKey });
    focusedNodeId.value = id;
    if (instanceNodes.value.has(id) && !expandedNodes.value.has(id)) {
      void expandInstanceNode({ className, primaryKey }, loadGeneration, false);
    }
  },
);

// ---- Canvas event handlers ----
function handleSelect(ids: string[]) {
  const pickedId = ids[0] ?? null;
  if (activeMode.value === "type") {
    writeSelectedType(pickedId);
    return;
  }
  if (!pickedId) {
    focusedNodeId.value = rootNodeId.value;
    writeSelectedNode(null);
    return;
  }
  const node = instanceNodes.value.get(pickedId);
  if (!node) return;
  const fullRef: PanelObjectValue = { className: node.className, primaryKey: node.primaryKey };
  focusedNodeId.value = pickedId;
  writeSelectedNode(fullRef);
  if (!expandedNodes.value.has(pickedId)) {
    void expandInstanceNode(fullRef, loadGeneration, false);
  }
}

function handleBlank() {
  if (activeMode.value === "type") {
    writeSelectedType(null);
  } else {
    focusedNodeId.value = rootNodeId.value;
    writeSelectedNode(null);
  }
}

function handleMove(id: string, position: GraphCanvasPoint) {
  const next = new Map(manualPositions.value);
  next.set(id, position);
  manualPositions.value = next;
}

function handleViewport(viewport: GraphCanvasViewport) {
  currentViewport.value = viewport;
}

// ---- Toolbar actions ----
function fitView() {
  void canvas.value?.fit({ maxZoom: 1.2, padding: 36 });
}

async function relayout() {
  manualPositions.value = new Map();
  if (activeMode.value === "instance" && rootNodeId.value) {
    const nodeIds = [...instanceNodes.value.keys()];
    const edgeLinks = [...instanceEdges.value.values()].map((edge) => ({
      source: encodeGraphNodeId(edge.from),
      target: encodeGraphNodeId(edge.to),
    }));
    instancePositions.value = layoutInstanceRadial(rootNodeId.value, nodeIds, edgeLinks);
  }
  await nextTick();
  await canvas.value?.relayout();
  await canvas.value?.fit({ maxZoom: 1.2, padding: 36 });
}

onMounted(() => {
  if (rootEl.value) paletteSize.value = readGraphPalette(rootEl.value).length;
});
</script>

<template>
  <section ref="rootEl" class="sdk-ontology-graph" :data-graph-mode="activeMode">
    <div v-if="(showLayerFilter && availableLayers.length > 1) || queryMatchCount !== null" class="sdk-ontology-graph-bar">
      <div v-if="showLayerFilter && availableLayers.length > 1" class="sdk-ontology-graph-layers" role="group" :aria-label="t('platform.graphLayers')">
        <button
          v-for="layer in availableLayers"
          :key="layer"
          type="button"
          class="sdk-ontology-graph-layer-pill"
          :class="{ 'is-active': enabledLayers.has(layer) }"
          :aria-pressed="enabledLayers.has(layer)"
          :data-graph-layer="layer"
          @click="toggleLayer(layer)"
        >
          {{ layerDisplayName(layer) }}
        </button>
      </div>
      <div class="sdk-ontology-graph-meta">
        <span v-if="queryMatchCount !== null" class="sdk-ontology-graph-matches" data-graph-matches>
          {{ t("platform.graphMatches", { count: queryMatchCount }) }}
        </span>
        <span class="sdk-ontology-graph-totals">
          {{ t("platform.graphCounts", { nodes: canvasNodes.length, edges: canvasEdges.length }) }}
        </span>
      </div>
    </div>

    <div v-if="showLegend && (activeMode === 'type' ? typeLegend.length : instanceLegend.length)" class="sdk-ontology-graph-legend">
      <template v-if="activeMode === 'type'">
        <span v-for="item in typeLegend" :key="item.layer" class="sdk-ontology-graph-legend-item" :data-graph-legend-layer="item.layer">
          <i class="sdk-ontology-graph-dot" :style="{ background: item.color }" />
          {{ item.label }}
          <b>{{ item.count }}</b>
        </span>
      </template>
      <template v-else>
        <span v-for="item in instanceLegend" :key="item.className" class="sdk-ontology-graph-legend-item" :data-graph-legend-type="item.className">
          <i class="sdk-ontology-graph-dot" :style="{ background: item.color }" />
          {{ item.label }}
          <b>{{ item.count }}</b>
        </span>
      </template>
      <span class="sdk-ontology-graph-sep" />
      <span class="sdk-ontology-graph-legend-item">
        <i class="sdk-ontology-graph-line" />{{ t("platform.graphEdgeStored") }}
      </span>
      <span class="sdk-ontology-graph-legend-item">
        <i class="sdk-ontology-graph-line is-dashed" />{{ t("platform.graphEdgeDerived") }}
      </span>
    </div>

    <div v-if="forbidden" class="sdk-ontology-graph-notice is-warning" role="status" data-graph-state="forbidden">
      {{ t("platform.dataForbidden") }}
    </div>
    <div v-else-if="errorMessage" class="sdk-ontology-graph-notice is-error" role="alert" data-graph-state="error">
      {{ errorMessage }}
    </div>

    <template v-if="relationSummary && !loading">
      <div v-if="relationSummary.noNeighbors" class="sdk-ontology-graph-notice is-info" role="status" data-graph-state="no-neighbors">
        {{ t("platform.graphNoNeighbors", { name: focusedNodeLabel }) }}
      </div>
      <div v-if="relationSummary.refused.length" class="sdk-ontology-graph-notice is-warning" role="status" data-graph-state="refused">
        {{ t("platform.graphRelationsRefused", { count: relationSummary.refused.length, relations: formatRelationNames(relationSummary.refused) }) }}
      </div>
      <div v-if="relationSummary.failed.length" class="sdk-ontology-graph-notice is-error" role="alert" data-graph-state="failed">
        {{ t("platform.graphRelationsFailed", { count: relationSummary.failed.length, relations: formatRelationNames(relationSummary.failed) }) }}
      </div>
      <div v-if="relationSummary.unavailable.length" class="sdk-ontology-graph-notice is-muted" role="status" data-graph-state="unavailable">
        {{ t("platform.graphRelationsUnavailable", { count: relationSummary.unavailable.length, relations: formatRelationNames(relationSummary.unavailable) }) }}
      </div>
    </template>

    <el-skeleton v-if="loading && canvasNodes.length === 0" :rows="6" animated class="sdk-ontology-graph-skeleton" />
    <el-empty v-else-if="!loading && !forbidden && !errorMessage && canvasNodes.length === 0" :description="t('platform.graphEmpty')" :image-size="48" />
    <div v-else class="sdk-ontology-graph-frame">
      <G6GraphCanvas
        ref="canvas"
        class="sdk-ontology-graph-canvas"
        :label="accessibleLabel"
        :nodes="canvasNodes"
        :edges="canvasEdges"
        :selected="canvasSelectedIds"
        :selection="'single'"
        :layout="{ type: 'preset' }"
        :categories="canvasCategories"
        :max-height="maxHeight"
        @update:selected="handleSelect"
        @blank="handleBlank"
        @move="handleMove"
        @viewport="handleViewport"
      />
      <div v-if="showToolbar" class="sdk-ontology-graph-tools" data-graph-toolbar>
        <button
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="fit"
          :title="t('platform.graphFit')"
          :aria-label="t('platform.graphFit')"
          @click="fitView"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
          </svg>
        </button>
        <button
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="relayout"
          :title="t('platform.graphRelayout')"
          :aria-label="t('platform.graphRelayout')"
          @click="relayout"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.55M13.5 2.5v2.75h-2.75" />
          </svg>
        </button>
      </div>
      <span v-if="expanding" class="sdk-ontology-graph-busy" role="status">
        {{ t("platform.graphExpanding") }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.sdk-ontology-graph {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
}

.sdk-ontology-graph-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}

.sdk-ontology-graph-layers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sdk-ontology-graph-layer-pill {
  padding: 3px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}

.sdk-ontology-graph-layer-pill.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.sdk-ontology-graph-meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-matches {
  color: var(--el-color-primary);
  font-weight: 500;
}

.sdk-ontology-graph-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sdk-ontology-graph-legend-item b {
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.sdk-ontology-graph-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.sdk-ontology-graph-line {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top: 1.5px solid var(--el-text-color-secondary);
}

.sdk-ontology-graph-line.is-dashed {
  border-top-style: dashed;
}

.sdk-ontology-graph-sep {
  width: 1px;
  height: 14px;
  background: var(--el-border-color);
}

.sdk-ontology-graph-notice {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--el-border-color-lighter);
}

.sdk-ontology-graph-notice.is-info {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}

.sdk-ontology-graph-notice.is-warning {
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning-light-7);
  color: var(--el-color-warning-dark-2);
}

.sdk-ontology-graph-notice.is-error {
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger-light-7);
  color: var(--el-color-danger);
}

.sdk-ontology-graph-notice.is-muted {
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-skeleton {
  padding: 16px;
}

.sdk-ontology-graph-frame {
  position: relative;
  flex: 1;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background-color: var(--el-fill-color-blank);
}

.sdk-ontology-graph-canvas {
  width: 100%;
  height: 100%;
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 18px 18px;
}

.sdk-ontology-graph-tools {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 4px;
}

.sdk-ontology-graph-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  cursor: pointer;
}

.sdk-ontology-graph-tool:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.sdk-ontology-graph-busy {
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
