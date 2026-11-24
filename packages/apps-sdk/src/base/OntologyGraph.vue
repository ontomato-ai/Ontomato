<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { matchesObjectType, type PanelObjectRef } from "@ontomato/contracts/panel-manifest";
import type {
  PanelGraphConnections,
  PanelGraphOverview,
  PlatformOntologyCountsResponse,
  PlatformOntologyStartResponse,
} from "@ontomato/contracts/platform-ontology";
import { platformObjectTypes, platformRelationKinds } from "@ontomato/contracts/platform-object-types";
import {
  G6GraphCanvas,
  G6_LABEL_SIZE,
  G6_LABEL_WIDTH,
  graphCategorySlot,
  readGraphPalette,
  type GraphCanvasEdge,
  type GraphCanvasElement,
  type GraphCanvasNode,
  type GraphCanvasPoint,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
import { usePanelContext } from "../panel/context";
import type { MemberDataState } from "../panel/direct";
import { useMember, useMemberOutput, useMemberParam, useMemberRead, type PanelMemberContext } from "../panel/member";
import { savePanelFile } from "../panel/save-file";
import type {
  PlatformGraphEdge,
  PlatformGraphNeighborsQuery,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphRelationStatus,
  PlatformGraphSchema,
  PlatformGraphTypeCount,
  PlatformObjectGraph,
} from "../panel/platform-objects";
import {
  encodeGraphNodeId,
  layoutInstanceRadial,
  layoutTypeColumns,
  placeExpandedNeighbors,
  summarizeGraphRelations,
} from "./ontology-graph-layout";
import {
  buildAggregatedOverviewEdges,
  isLargeGraph,
  isOverviewGroupAnchorId,
  layoutGrid,
  layoutGroupedOverview,
  mergeNodePositions,
  placeGroupHeadings,
  placeRadialNeighbor,
  sanitizeSavedPositions,
  type OverviewEdgeInput,
  type OverviewHeadingInput,
  type OverviewHeadingPlacement,
  type OverviewNodeInput,
  type OverviewRect,
} from "./ontology-graph-overview";

type PanelObjectValue = PanelObjectRef;
type NeighborDirection = "both" | "incoming" | "outgoing";

interface NeighborPageState {
  readonly nextOffset: number | null;
  readonly total: number | null;
  readonly loaded: number;
}

const ZOOM_STEP = 1.2;

/**
 * Projection-level interactive graph powered by G6 (`@ontomato/foundation-ui/graph/g6`).
 *
 * Supports three modes:
 * - `"type"`: arranges declared types and relation kinds in layer columns with per-type counts and access statuses.
 * - `"overview"`: renders a sampled grouped graph overview (`overview` and optional deferred `connections` ports) with
 *   per-group spiral clusters, obstacle-avoiding group headings, toggleable inter-group aggregated edges, generation /
 *   empty / truncation notices, and snapshot version-conflict recovery.
 * - `"instance"`: explores one-hop neighbors around a node with optional paginated loading (`offset`, `limit`) and
 *   direction / target-group / relation-kind filtering.
 *
 * Syncs `visibleLayers`, `visibleRelationKinds`, `expandedNodes`, and personal node `positions` (`json`) through
 * bidirectional member parameters without using browser `localStorage`, publishes read-only summary outputs, and
 * exposes `#toolbar` and `#overlay` slots for host panels.
 */
const props = withDefaults(
  defineProps<{
    /** `"type"` draws types & relation kinds; `"overview"` draws sampled grouped overview; `"instance"` explores neighbors. */
    mode?: "type" | "instance" | "overview";
    /** Starting node identity for instance mode; when omitted/null, reads `overview` (when bound) or `start()`. */
    start?: PanelObjectValue | null;
    /** Currently selected node identity. */
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
    /** Show floating graph toolbar. */
    showToolbar?: boolean;
    /** Aggregate inter-group edges in overview mode (enabled by default). */
    aggregateEdges?: boolean;
    /** Draw labels on graph edges (enabled by default). */
    showEdgeLabels?: boolean;
    /** Show the aggregated-edges toggle button in overview mode. */
    showAggregateToggle?: boolean;
    /** Show the edge-labels toggle button in the toolbar. */
    showEdgeLabelToggle?: boolean;
    /** Show zoom-in and zoom-out buttons in the toolbar. */
    showZoomControls?: boolean;
    /** Show refresh button in the toolbar. */
    showRefreshControl?: boolean;
    /** Show neighbor pagination and direction/target-group filter controls when supported by the neighbors port. */
    showNeighborControls?: boolean;
    /** Initial neighbor traversal direction filter (`both` | `outgoing` | `incoming`). */
    neighborDirection?: NeighborDirection;
    /** Initial neighbor target group filter (`className`). */
    neighborTargetClass?: string | null;
    /** Page size (`limit`) used when the bound `neighbors` port supports paginated loading. */
    neighborPageSize?: number;
    /** Optional max height in CSS pixels forwarded to `G6GraphCanvas`. */
    maxHeight?: number;
  }>(),
  {
    mode: undefined,
    start: null,
    selected: null,
    selectedType: null,
    query: "",
    label: undefined,
    layers: undefined,
    showLayerFilter: true,
    showLegend: true,
    showToolbar: true,
    aggregateEdges: true,
    showEdgeLabels: true,
    showAggregateToggle: true,
    showEdgeLabelToggle: true,
    showZoomControls: true,
    showRefreshControl: true,
    showNeighborControls: true,
    neighborDirection: "both",
    neighborTargetClass: null,
    neighborPageSize: 50,
    maxHeight: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted in overview or instance mode when a reader selects a node (full identity) or clears selection. */
  "update:selected": [node: PanelObjectValue | null];
  /** Emitted in type mode when a reader selects a type node or clears selection. */
  "update:selectedType": [typeId: string | null];
  /** Emitted when the aggregated-edges toolbar toggle changes. */
  "update:aggregateEdges": [value: boolean];
  /** Emitted when the edge-labels toolbar toggle changes. */
  "update:showEdgeLabels": [value: boolean];
}>();

class MemberReadForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberReadForbiddenError";
  }
}

class MemberVersionChangedError extends Error {
  readonly code = "GRAPH_VERSION_CHANGED";
  constructor(message: string) {
    super(message);
    this.name = "MemberVersionChangedError";
  }
}

function isVersionChangedError(reason: unknown): boolean {
  if (reason instanceof MemberVersionChangedError) return true;
  if (reason && typeof reason === "object") {
    const record = reason as { code?: unknown; status?: unknown; message?: unknown };
    if (record.code === "GRAPH_VERSION_CHANGED" || record.status === 409) return true;
    if (typeof record.message === "string" && record.message.includes("GRAPH_VERSION_CHANGED")) return true;
  }
  return false;
}

const { t, te } = useI18n();
const panel = usePanelContext();
const member = useMember();

const hasOverviewPort = Boolean(member.projection.data.overview);

const neighborSupportedParams = computed<ReadonlySet<string>>(() => {
  const datum = member.projection.data.neighbors;
  if (!datum) return new Set(["node"]);
  const declared = new Set<string>(Object.keys(datum.params ?? {}));
  if ("type" in datum.source && datum.source.type.kind === "PlatformObjectType") {
    const readDecl = platformObjectTypes[datum.source.type.id]?.reads?.[datum.read];
    if (readDecl && "params" in readDecl && readDecl.params) {
      for (const key of Object.keys(readDecl.params)) declared.add(key);
    }
  }
  return declared;
});

const supportsDirectionFilter = computed(() => neighborSupportedParams.value.has("direction"));
const supportsTargetGroupFilter = computed(() => neighborSupportedParams.value.has("targetClass"));
const supportsRelationKindsParam = computed(() => neighborSupportedParams.value.has("relationKinds"));
const supportsNeighborPaging = computed(
  () => neighborSupportedParams.value.has("limit") || neighborSupportedParams.value.has("offset"),
);

/**
 * The relation kinds the graph shows: its `visibleRelationKinds`, a list of relation kinds (`platform:OntologyRelationKind`,
 * keyed by the kind's ID) bound to the panel's state, read as well as written — so a page's own kind filter and the graph
 * follow one choice. Holding nothing, every kind is shown.
 */
const visibleKindsParam = useMemberParam("visibleRelationKinds");
const shownKinds = computed<ReadonlySet<string> | null>(() => {
  const held = visibleKindsParam.value.value;
  if (held === null) return null;
  if (!Array.isArray(held)) throw new Error("visibleRelationKinds holds a list of relation kinds");
  return new Set(
    held.map((kind) =>
      typeof kind === "string" ? kind : (kind as { primaryKey: string }).primaryKey,
    ),
  );
});
const kindShown = (relationKind: string) => shownKinds.value === null || shownKinds.value.has(relationKind);

/**
 * Bidirectional layer visibility state (`visibleLayers`, a list of layer IDs). When `null`/omitted, all available
 * layers (or explicit `props.layers` when provided) are enabled.
 */
const visibleLayersParam = useMemberParam("visibleLayers");
const paramVisibleLayers = computed<readonly string[] | null>(() => {
  const held = visibleLayersParam.value.value;
  if (held === null) return null;
  if (!Array.isArray(held)) throw new Error("visibleLayers holds a list of layer identifiers");
  return held.filter((item): item is string => typeof item === "string");
});

/**
 * Bidirectional expanded instance nodes state (`expandedNodes`, a list of `{ className, primaryKey }` refs).
 * Expanding a node writes back here; setting it externally expands the listed nodes in instance mode.
 */
const expandedNodesParam = useMemberParam("expandedNodes");
const isExpandedNodesBound = computed(() => {
  const memberDecl = panel.manifest.members[member.key];
  return Boolean(memberDecl?.inputs?.expandedNodes || memberDecl?.outputs?.expandedNodes);
});
const paramExpandedNodes = computed<readonly PanelObjectValue[]>(() => {
  const held = expandedNodesParam.value.value;
  if (held === null) return [];
  if (!Array.isArray(held)) throw new Error("expandedNodes holds a list of object references");
  const list: PanelObjectValue[] = [];
  const seen = new Set<string>();
  for (const item of held) {
    if (
      item
      && typeof item === "object"
      && typeof (item as { className?: unknown }).className === "string"
      && typeof (item as { primaryKey?: unknown }).primaryKey === "string"
    ) {
      const refItem: PanelObjectValue = {
        className: (item as { className: string }).className,
        primaryKey: (item as { primaryKey: string }).primaryKey,
      };
      const id = encodeGraphNodeId(refItem);
      if (!seen.has(id)) {
        seen.add(id);
        list.push(refItem);
      }
    }
  }
  return list;
});

/**
 * Per-person saved node coordinates (`positions`, personal `json` panel state).
 * Dragged node coordinates are written here and restored on re-entry; relayout clears this state to `null`.
 */
const positionsParam = useMemberParam("positions");
const isPositionsBound = computed(() => {
  const memberDecl = panel.manifest.members[member.key];
  return Boolean(memberDecl?.inputs?.positions || memberDecl?.outputs?.positions);
});
const savedPositions = computed<Map<string, GraphCanvasPoint>>(() => sanitizeSavedPositions(positionsParam.value.value));

function nameNodes(nodes: readonly PlatformGraphNode[]) {
  const byType = new Map<string, { primaryKey: string; label: string }[]>();
  for (const node of nodes) {
    let bucket = byType.get(node.className);
    if (!bucket) {
      bucket = [];
      byType.set(node.className, bucket);
    }
    bucket.push({ primaryKey: node.primaryKey, label: node.label });
  }
  for (const [className, items] of byType) panel.instance.nameObjects(className, items);
}

function createMemberGraphSource(ctx: PanelMemberContext): PlatformObjectGraph {
  const unwrap = <T>(state: MemberDataState): T => {
    if (state.status === "ready") return state.value as unknown as T;
    if (state.status === "forbidden") throw new MemberReadForbiddenError(t("platform.dataForbidden"));
    if (state.status === "error") {
      if (state.code === "GRAPH_VERSION_CHANGED" || state.message.includes("GRAPH_VERSION_CHANGED")) {
        throw new MemberVersionChangedError(state.message);
      }
      throw new Error(state.message);
    }
    throw new Error(t("platform.dataAwaiting"));
  };
  if (!ctx.projection.data.neighbors) throw new Error(`Member '${ctx.key}' declares no 'neighbors' datum`);
  const readSchema = ctx.projection.data.schema ? useMemberRead("schema") : undefined;
  const readCounts = ctx.projection.data.counts ? useMemberRead("counts") : undefined;
  const readStart = ctx.projection.data.start ? useMemberRead("start") : undefined;
  const readOverview = ctx.projection.data.overview ? useMemberRead("overview") : undefined;
  const readConnections = ctx.projection.data.connections ? useMemberRead("connections") : undefined;
  const readNeighbors = useMemberRead("neighbors");
  return {
    ...(readSchema ? { schema: async () => unwrap<PlatformGraphSchema>(await readSchema({})) } : {}),
    ...(readCounts ? {
      counts: async () => {
        const state = await readCounts({});
        return state.status === "empty" ? [] : unwrap<PlatformOntologyCountsResponse>(state).counts;
      },
    } : {}),
    ...(readStart ? {
      start: async () => {
        const state = await readStart({});
        if (state.status === "empty") return null;
        const node = unwrap<PlatformOntologyStartResponse>(state).node;
        if (node) nameNodes([node]);
        return node;
      },
    } : {}),
    ...(readOverview ? {
      overview: async () => {
        const result = unwrap<PanelGraphOverview>(await readOverview({}));
        if (result.nodes.length > 0) nameNodes(result.nodes);
        return result;
      },
    } : {}),
    ...(readConnections ? {
      connections: async (query) => {
        const params: Record<string, RuntimeJsonValue> = { version: query.version };
        if (query.sampleToken) params.sampleToken = query.sampleToken;
        return unwrap<PanelGraphConnections>(await readConnections(params));
      },
    } : {}),
    neighbors: async (query: PlatformGraphNeighborsQuery) => {
      const params: Record<string, RuntimeJsonValue> = {
        node: { className: query.node.className, primaryKey: query.node.primaryKey },
      };
      if (query.layers) params.layers = [...query.layers];
      if (query.relationKinds) params.relationKinds = [...query.relationKinds];
      if (query.targetClass) params.targetClass = query.targetClass;
      if (query.direction) params.direction = query.direction;
      if (typeof query.limit === "number") params.limit = query.limit;
      if (typeof query.offset === "number") params.offset = query.offset;
      const result = unwrap<PlatformGraphNeighborsResult>(await readNeighbors(params));
      nameNodes([result.node, ...result.neighbors]);
      return result;
    },
  };
}

const graphSource = createMemberGraphSource(member);
const relationLabelKeyById = new Map(platformRelationKinds.map((kind) => [kind.id, kind.labelKey]));

const rootEl = ref<HTMLElement | null>(null);
const canvas = ref<InstanceType<typeof G6GraphCanvas> | null>(null);
const partial = ref(false);
const moved = ref(false);
let fitted = false;
let fitting = false;

const paletteSize = ref(0);
const loading = ref(false);
const loadingConnections = ref(false);
const expanding = ref(false);
const forbidden = ref(false);
const errorMessage = ref<string | null>(null);
const versionChanged = ref(false);

// Toolbar toggles (synced with props)
const aggregateEdgesEnabled = ref(props.aggregateEdges);
watch(() => props.aggregateEdges, (next) => { aggregateEdgesEnabled.value = next; });
const edgeLabelsEnabled = ref(props.showEdgeLabels);
watch(() => props.showEdgeLabels, (next) => { edgeLabelsEnabled.value = next; });

function toggleAggregateEdges() {
  aggregateEdgesEnabled.value = !aggregateEdgesEnabled.value;
  emit("update:aggregateEdges", aggregateEdgesEnabled.value);
}

function toggleEdgeLabels() {
  edgeLabelsEnabled.value = !edgeLabelsEnabled.value;
  emit("update:showEdgeLabels", edgeLabelsEnabled.value);
}

// Mode transitions between sampled overview and neighborhood exploration
const explorationRoot = ref<PanelObjectValue | null>(null);
const returnedToOverview = ref(false);

watch(
  () => [props.start?.className ?? "", props.start?.primaryKey ?? ""] as const,
  ([className, primaryKey]) => {
    returnedToOverview.value = false;
    if (className && primaryKey) {
      explorationRoot.value = null;
    }
  },
);

const effectiveStart = computed<PanelObjectValue | null>(() => {
  if (explorationRoot.value) return explorationRoot.value;
  if (props.start && !returnedToOverview.value) return props.start;
  return null;
});

const activeMode = computed<"type" | "overview" | "instance">(() => {
  if (props.mode === "type") return "type";
  if (hasOverviewPort) {
    if (effectiveStart.value) return "instance";
    return "overview";
  }
  if (props.mode === "overview") return "overview";
  return "instance";
});

const canReturnToOverview = computed(() => hasOverviewPort && activeMode.value === "instance");

// Type-mode state
const typeSchema = shallowRef<PlatformGraphSchema | null>(null);
const typeCounts = shallowRef<readonly PlatformGraphTypeCount[]>([]);

// Overview-mode state
const overviewData = shallowRef<PanelGraphOverview | null>(null);
const overviewNodes = shallowRef<Map<string, PlatformGraphNode>>(new Map());
const overviewEdges = shallowRef<readonly PlatformGraphEdge[]>([]);
const overviewEdgesTruncated = ref(false);
const overviewBasePositions = shallowRef<Map<string, GraphCanvasPoint>>(new Map());
const localSelectedOverviewId = ref<string | null>(null);

// Instance-mode state (accumulated drawn subgraph + pagination & filters)
const rootNodeId = ref<string | null>(null);
const instanceNodes = shallowRef<Map<string, PlatformGraphNode>>(new Map());
const instanceEdges = shallowRef<Map<string, PlatformGraphEdge>>(new Map());
const expandedNodes = shallowRef<Set<string>>(new Set());
const expandingNodeIds = new Set<string>();
const fetchedLayersByNode = shallowRef<Map<string, Set<string> | null>>(new Map());
const relationStatusesByNode = shallowRef<Map<string, readonly PlatformGraphRelationStatus[]>>(new Map());
const neighborPagesByNode = shallowRef<Map<string, NeighborPageState>>(new Map());
const instancePositions = shallowRef<Map<string, GraphCanvasPoint>>(new Map());
const lastNeighborVersion = ref<string | null>(null);

const neighborDirection = ref<NeighborDirection>(props.neighborDirection);
watch(() => props.neighborDirection, (next) => { neighborDirection.value = next; });
const neighborTargetGroup = ref<string>(props.neighborTargetClass ?? "");
watch(() => props.neighborTargetClass, (next) => { neighborTargetGroup.value = next ?? ""; });

// Local canvas viewport and focus
const hasExplicitLayers = Array.isArray(props.layers) && props.layers.length > 0;
const currentViewport = shallowRef<GraphCanvasViewport | null>(null);
const focusedNodeId = ref<string | null>(null);

let loadGeneration = 0;

function focusAnchor(): string | undefined {
  if (activeMode.value === "type") return props.selectedType ?? undefined;
  if (activeMode.value === "overview") return activeOverviewSelectedId.value ?? undefined;
  const chosen = props.selected ? encodeGraphNodeId(props.selected) : null;
  if (chosen && instanceNodes.value.has(chosen)) return chosen;
  return rootNodeId.value ?? undefined;
}

/** Opens the graph at a zoom where node names stay readable, centering the chosen/start node when the graph overflows. */
function fitReadable(target = canvas.value) {
  if (!target) return;
  fitting = true;
  const padding: number | [number, number, number, number] = activeMode.value === "overview" ? [64, 48, 48, 48] : 36;
  void target
    .fit({ maxZoom: 1.15, keepNames: true, padding, around: focusAnchor() })
    .then((whole) => {
      partial.value = whole === false;
      moved.value = false;
      fitted = true;
    })
    .finally(() => {
      fitting = false;
    });
}

// The canvas is there only while something is drawn: one that appears after an empty or loading view opens at a
// readable zoom around its start rather than in the corner.
watch(canvas, (shown, before) => {
  if (shown && !before) fitReadable(shown);
});

function recordFailure(reason: unknown) {
  if (isVersionChangedError(reason)) {
    versionChanged.value = true;
    forbidden.value = false;
    errorMessage.value = null;
    return;
  }
  if (reason instanceof MemberReadForbiddenError) {
    forbidden.value = true;
    errorMessage.value = null;
    return;
  }
  forbidden.value = false;
  errorMessage.value = reason instanceof Error ? reason.message : String(reason);
}

const accessibleLabel = computed(() => props.label ?? member.projection.name);

const declaredNodeIdentity = computed(() => {
  const candidate =
    member.projection.outputs.selectedNode
    ?? member.projection.outputs.selected
    ?? member.projection.inputs.start
    ?? member.projection.inputs.selected
    ?? member.projection.inputs.node;
  return candidate && (candidate.kind === "object" || candidate.kind === "object-union") ? candidate : undefined;
});

function resolveKey(key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  if (te(key)) return t(key);
  const fromPanel = panel.t(key);
  return fromPanel !== key ? fromPanel : fallback;
}

const overviewGroupLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const group of overviewData.value?.groups ?? []) {
    map.set(group.id, group.label);
  }
  return map;
});

function typeDisplayName(typeId: string, labelKey?: string, explicitLabel?: string): string {
  if (explicitLabel) return explicitLabel;
  const fromOverview = overviewGroupLabelById.value.get(typeId);
  if (fromOverview) return fromOverview;
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
  if (activeMode.value === "overview") {
    const discovered = new Set<string>();
    for (const node of overviewNodes.value.values()) {
      if (node.layer) discovered.add(node.layer);
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

const hasDeclaredLayerSet = computed(() =>
  Boolean(
    hasExplicitLayers
    || (activeMode.value === "type" && typeSchema.value?.layers?.length)
    || (activeMode.value === "instance" && declaredNodeIdentity.value && "layers" in declaredNodeIdentity.value),
  ),
);

const enabledLayers = computed<ReadonlySet<string>>(() => {
  const param = paramVisibleLayers.value;
  if (param !== null) return new Set(param);
  if (hasExplicitLayers) return new Set(props.layers!);
  return new Set(availableLayers.value);
});

watch(enabledLayers, (next, prev) => {
  if (activeMode.value !== "instance" || !prev) return;
  const added: string[] = [];
  for (const layer of next) {
    if (!prev.has(layer)) added.push(layer);
  }
  if (added.length === 0) return;
  for (const nodeId of expandedNodes.value) {
    const fetched = fetchedLayersByNode.value.get(nodeId);
    if (fetched !== null && fetched !== undefined && added.some((layer) => !fetched.has(layer))) {
      const node = instanceNodes.value.get(nodeId);
      if (node) void expandInstanceNode({ className: node.className, primaryKey: node.primaryKey }, loadGeneration, { force: true });
    }
  }
});

function toggleLayer(layer: string) {
  const next = new Set(enabledLayers.value);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);

  const ordered = availableLayers.value.filter((entry) => next.has(entry));
  for (const entry of next) {
    if (!ordered.includes(entry)) ordered.push(entry);
  }
  const allEnabled = availableLayers.value.length > 0 && availableLayers.value.every((entry) => next.has(entry));
  visibleLayersParam.set(allEnabled && !hasExplicitLayers ? null : ordered);
}

// ---- Computed overview selection & groups ----
const activeOverviewSelectedId = computed<string | null>(() => {
  if (props.selected) {
    const id = encodeGraphNodeId(props.selected);
    return overviewNodes.value.has(id) ? id : null;
  }
  return localSelectedOverviewId.value && overviewNodes.value.has(localSelectedOverviewId.value)
    ? localSelectedOverviewId.value
    : null;
});

const selectedOverviewNode = computed<PlatformGraphNode | null>(() =>
  activeOverviewSelectedId.value ? (overviewNodes.value.get(activeOverviewSelectedId.value) ?? null) : null,
);

const overviewGroups = computed(() => overviewData.value?.groups ?? []);

const availableTargetGroups = computed<Array<{ id: string; label: string }>>(() => {
  const byId = new Map<string, string>();
  for (const group of overviewGroups.value) {
    byId.set(group.id, group.label);
  }
  for (const node of instanceNodes.value.values()) {
    if (!byId.has(node.className)) {
      byId.set(node.className, typeDisplayName(node.className, undefined, node.typeLabel));
    }
  }
  return [...byId.entries()].map(([id, label]) => ({ id, label }));
});

// ---- Read-only projection outputs ----
const startNode = computed<PlatformGraphNode | null>(() =>
  activeMode.value === "instance" && rootNodeId.value ? (instanceNodes.value.get(rootNodeId.value) ?? null) : null,
);

useMemberOutput("startLabel", () => startNode.value?.label || null);
useMemberOutput("startDetail", () =>
  startNode.value
    ? `${typeDisplayName(startNode.value.className, undefined, startNode.value.typeLabel)} · ${startNode.value.primaryKey}`
    : null,
);

const visibleRelationKindLabels = computed<string[]>(() => {
  const held = visibleKindsParam.value.value;
  if (!Array.isArray(held) || held.length === 0) return [];
  const byId = new Map((typeSchema.value?.relationKinds ?? []).map((item) => [item.id, item]));
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of held) {
    const id =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { primaryKey?: unknown }).primaryKey === "string"
          ? (item as { primaryKey: string }).primaryKey
          : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const spec = byId.get(id);
    labels.push(relationDisplayName(id, spec?.label, spec?.labelKey));
  }
  return labels;
});
useMemberOutput("visibleRelationKindLabels", () => visibleRelationKindLabels.value);

const graphStatus = computed<string | null>(() => {
  if (activeMode.value === "overview") return overviewData.value?.status ?? null;
  return loading.value ? null : "READY";
});

const graphVersion = computed<string | null>(() =>
  overviewData.value?.version ?? lastNeighborVersion.value ?? null,
);

const sampleToken = computed<string | null>(() => overviewData.value?.sampleToken ?? null);

const currentNeighborPage = computed<NeighborPageState | null>(() => {
  if (activeMode.value !== "instance") return null;
  const targetId = focusedNodeId.value ?? (props.selected ? encodeGraphNodeId(props.selected) : null) ?? rootNodeId.value;
  if (!targetId) return null;
  return neighborPagesByNode.value.get(targetId) ?? null;
});

const hasMoreNeighbors = computed<boolean>(() => {
  if (activeMode.value !== "instance") return false;
  if (currentNeighborPage.value && currentNeighborPage.value.nextOffset !== null) return true;
  for (const page of neighborPagesByNode.value.values()) {
    if (page.nextOffset !== null) return true;
  }
  return false;
});

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
    const position = savedPositions.value.get(spec.id) ?? typePositions.value.get(spec.id) ?? { x: 0, y: 0 };
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
    if (!visibleIds.has(relation.from) || !kindShown(relation.id)) continue;
    const targets = typeof relation.to === "string" ? [relation.to] : relation.to;
    const label = edgeLabelsEnabled.value ? relationDisplayName(relation.id, relation.label, relation.labelKey) : undefined;
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

// ---- Overview-mode computed graph ----
const visibleOverviewNodes = computed<readonly PlatformGraphNode[]>(() =>
  [...overviewNodes.value.values()].filter((node) => isLayerVisible(node.layer)),
);

const visibleOverviewNodeIds = computed(() => new Set(visibleOverviewNodes.value.map((node) => encodeGraphNodeId(node))));

const visibleOverviewEdges = computed<readonly PlatformGraphEdge[]>(() =>
  overviewEdges.value.filter(
    (edge) => kindShown(edge.relationKind)
      && visibleOverviewNodeIds.value.has(encodeGraphNodeId(edge.from))
      && visibleOverviewNodeIds.value.has(encodeGraphNodeId(edge.to)),
  ),
);

const overviewCategories = computed<readonly string[]>(() => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const group of overviewGroups.value) {
    if (!seen.has(group.id)) {
      seen.add(group.id);
      ordered.push(group.id);
    }
  }
  for (const node of visibleOverviewNodes.value) {
    if (!seen.has(node.className)) {
      seen.add(node.className);
      ordered.push(node.className);
    }
  }
  return ordered;
});

const overviewResolvedPositions = computed<Map<string, GraphCanvasPoint>>(() => {
  const nodeIds = visibleOverviewNodes.value.map((node) => encodeGraphNodeId(node));
  return mergeNodePositions(overviewBasePositions.value, savedPositions.value, nodeIds);
});

const overviewNodeInputs = computed<OverviewNodeInput[]>(() =>
  visibleOverviewNodes.value.map((node) => ({
    id: encodeGraphNodeId(node),
    groupId: node.className,
    label: node.label,
  })),
);

const overviewEdgeInputs = computed<OverviewEdgeInput[]>(() =>
  visibleOverviewEdges.value.map((edge) => ({
    id: edge.id,
    source: encodeGraphNodeId(edge.from),
    target: encodeGraphNodeId(edge.to),
    relationKind: edge.relationKind,
    label: edge.label,
    derived: edge.derived,
  })),
);

const aggregatedOverview = computed(() => {
  if (activeMode.value !== "overview" || !aggregateEdgesEnabled.value) return null;
  return buildAggregatedOverviewEdges(
    overviewNodeInputs.value,
    overviewEdgeInputs.value,
    overviewResolvedPositions.value,
    {
      selectedNodeId: activeOverviewSelectedId.value,
      formatAggregatedLabel: (relationKind, count, sampleLabel) => {
        if (!edgeLabelsEnabled.value) return undefined;
        const baseLabel = relationDisplayName(relationKind, sampleLabel);
        return count > 1 ? t("platform.graphAggregatedEdgeLabel", { label: baseLabel, count }) : baseLabel;
      },
      formatDirectLabel: (edge) =>
        edgeLabelsEnabled.value ? relationDisplayName(edge.relationKind, edge.label) : undefined,
    },
  );
});

const overviewCanvasNodes = computed<GraphCanvasNode[]>(() => {
  const needle = queryNeedle.value;
  const positions = overviewResolvedPositions.value;
  const nodes: GraphCanvasNode[] = visibleOverviewNodes.value.map((node) => {
    const id = encodeGraphNodeId(node);
    const position = positions.get(id) ?? { x: 0, y: 0 };
    const matches =
      !needle
      || node.label.toLowerCase().includes(needle)
      || node.primaryKey.toLowerCase().includes(needle)
      || (node.detail?.toLowerCase().includes(needle) ?? false);
    return {
      id,
      label: node.label,
      title: node.detail
        ? `${node.label} — ${node.detail}`
        : `${typeDisplayName(node.className, undefined, node.typeLabel)}: ${node.label}`,
      category: node.className,
      tone: needle ? (matches ? "accent" : "muted") : "default",
      x: position.x,
      y: position.y,
    };
  });
  if (aggregatedOverview.value) {
    nodes.push(...aggregatedOverview.value.anchors);
  }
  return nodes;
});

const overviewCanvasEdges = computed<GraphCanvasEdge[]>(() => {
  if (aggregatedOverview.value) {
    return aggregatedOverview.value.edges;
  }
  const needle = queryNeedle.value;
  const matchedIds = needle
    ? new Set(overviewCanvasNodes.value.filter((node) => !node.anchor && node.tone === "accent").map((node) => node.id))
    : null;
  const selectedId = activeOverviewSelectedId.value;
  return visibleOverviewEdges.value.map((edge) => {
    const source = encodeGraphNodeId(edge.from);
    const target = encodeGraphNodeId(edge.to);
    const tone = matchedIds
      ? (matchedIds.has(source) || matchedIds.has(target) ? "default" : "muted")
      : selectedId
        ? (source === selectedId || target === selectedId ? "default" : "muted")
        : "default";
    return {
      id: edge.id,
      source,
      target,
      label: edgeLabelsEnabled.value ? relationDisplayName(edge.relationKind, edge.label) : undefined,
      line: edge.derived ? "dashed" : "solid",
      tone,
    };
  });
});

/** Screen-space group headings that track pan, zoom, and dragged nodes while avoiding overlaps. */
const overviewGroupHeadings = computed<OverviewHeadingPlacement[]>(() => {
  const view = currentViewport.value;
  if (activeMode.value !== "overview" || overviewData.value?.status !== "READY" || !view || visibleOverviewNodes.value.length === 0) {
    return [];
  }
  const viewWidth = view.width * view.zoom;
  const viewHeight = view.height * view.zoom;
  if (!(viewWidth > 0 && viewHeight > 0)) return [];

  const positions = overviewResolvedPositions.value;
  const pointsByGroup = new Map<string, Array<{ x: number; y: number }>>();
  const obstacles: OverviewRect[] = [];

  const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  const fontFamily = rootEl.value && typeof getComputedStyle === "function"
    ? getComputedStyle(rootEl.value).fontFamily
    : "sans-serif";
  const textWidth = (text: string, size: number) => {
    if (!measureCtx) return Array.from(text).length * size * 0.65;
    measureCtx.font = `600 ${size}px ${fontFamily}`;
    return measureCtx.measureText(text).width;
  };

  for (const node of visibleOverviewNodes.value) {
    const id = encodeGraphNodeId(node);
    const pos = positions.get(id);
    if (!pos) continue;
    const screenX = (pos.x - view.x) * view.zoom;
    const screenY = (pos.y - view.y) * view.zoom;
    let bucket = pointsByGroup.get(node.className);
    if (!bucket) {
      bucket = [];
      pointsByGroup.set(node.className, bucket);
    }
    bucket.push({ x: screenX, y: screenY });

    const halfWidth = Math.max(18, Math.min(G6_LABEL_WIDTH, textWidth(node.label || "—", G6_LABEL_SIZE)) / 2) * view.zoom;
    obstacles.push({
      x: screenX - halfWidth,
      y: screenY - 18 * view.zoom,
      width: halfWidth * 2,
      height: 58 * view.zoom,
    });
  }

  const toolbarRect = rootEl.value?.querySelector(".sdk-ontology-graph-tools")?.getBoundingClientRect();
  const frameRect = rootEl.value?.querySelector(".sdk-ontology-graph-frame")?.getBoundingClientRect();
  if (frameRect && toolbarRect && toolbarRect.width > 0 && toolbarRect.height > 0) {
    obstacles.push({
      x: toolbarRect.left - frameRect.left,
      y: toolbarRect.top - frameRect.top,
      width: toolbarRect.width,
      height: toolbarRect.height,
    });
  }

  const groupMetaById = new Map(overviewGroups.value.map((group) => [group.id, group]));
  const headingInputs: OverviewHeadingInput[] = [...pointsByGroup.entries()].map(([groupId, points]) => {
    const meta = groupMetaById.get(groupId);
    const label = meta?.label ?? typeDisplayName(groupId);
    const countText = meta && meta.totalCount !== points.length
      ? `${points.length} / ${meta.totalCount}`
      : `${points.length}`;
    const width = Math.min(
      Math.max(64, textWidth(label, 12) + textWidth(countText, 12) + 32),
      240,
      Math.max(80, viewWidth - 32),
    );
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y)) - 18 * view.zoom;
    const bottom = Math.max(...points.map((point) => point.y)) + 40 * view.zoom;
    return {
      id: groupId,
      label,
      countText,
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
      width,
      height: 26,
    };
  });

  return placeGroupHeadings(headingInputs, obstacles, {
    x: 8,
    y: 8,
    width: Math.max(0, viewWidth - 16),
    height: Math.max(0, viewHeight - 16),
  });
});

// ---- Instance-mode computed graph ----
const layerInstanceNodes = computed<readonly PlatformGraphNode[]>(() =>
  [...instanceNodes.value.values()].filter((node) => isLayerVisible(node.layer)),
);
const layerInstanceNodeIds = computed(() => new Set(layerInstanceNodes.value.map((node) => encodeGraphNodeId(node))));

/** The edges drawn: between nodes of the layers shown, of the relation kinds shown. */
const visibleInstanceEdges = computed<readonly PlatformGraphEdge[]>(() =>
  [...instanceEdges.value.values()].filter(
    (edge) => kindShown(edge.relationKind)
      && layerInstanceNodeIds.value.has(encodeGraphNodeId(edge.from)) && layerInstanceNodeIds.value.has(encodeGraphNodeId(edge.to)),
  ),
);

/**
 * The nodes drawn: those of the layers shown; with only some relation kinds shown, a neighbor stays only while an edge
 * of a kind shown reaches it — the start and every node the reader expanded stay regardless.
 */
const visibleInstanceNodes = computed<readonly PlatformGraphNode[]>(() => {
  if (shownKinds.value === null) return layerInstanceNodes.value;
  const reached = new Set(visibleInstanceEdges.value.flatMap((edge) => [encodeGraphNodeId(edge.from), encodeGraphNodeId(edge.to)]));
  return layerInstanceNodes.value.filter((node) => {
    const id = encodeGraphNodeId(node);
    return reached.has(id) || expandedNodes.value.has(id) || id === rootNodeId.value;
  });
});

const instanceCategories = computed<readonly string[]>(() => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const node of visibleInstanceNodes.value) {
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
    const position = savedPositions.value.get(id) ?? instancePositions.value.get(id) ?? { x: 0, y: 0 };
    const matches =
      !needle
      || node.label.toLowerCase().includes(needle)
      || node.primaryKey.toLowerCase().includes(needle)
      || (node.detail?.toLowerCase().includes(needle) ?? false);
    return {
      id,
      label: node.label,
      title: node.detail
        ? `${node.label} — ${node.detail}`
        : `${typeDisplayName(node.className, undefined, node.typeLabel)}: ${node.label}`,
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
      label: edgeLabelsEnabled.value ? relationDisplayName(edge.relationKind, edge.label) : undefined,
      line: edge.derived ? "dashed" : "solid",
      tone: matchedIds ? (matchedIds.has(source) || matchedIds.has(target) ? "default" : "muted") : "default",
    };
  });
});

// ---- Active canvas bindings ----
const canvasNodes = computed(() => {
  if (activeMode.value === "type") return typeCanvasNodes.value;
  if (activeMode.value === "overview") return overviewCanvasNodes.value;
  return instanceCanvasNodes.value;
});

const canvasEdges = computed(() => {
  if (activeMode.value === "type") return typeCanvasEdges.value;
  if (activeMode.value === "overview") return overviewCanvasEdges.value;
  return instanceCanvasEdges.value;
});

const canvasCategories = computed(() => {
  if (activeMode.value === "type") return availableLayers.value;
  if (activeMode.value === "overview") return overviewCategories.value;
  return instanceCategories.value;
});

const canvasSelectedIds = computed<readonly string[]>(() => {
  if (activeMode.value === "type") {
    return props.selectedType ? [props.selectedType] : [];
  }
  if (activeMode.value === "overview") {
    return activeOverviewSelectedId.value ? [activeOverviewSelectedId.value] : [];
  }
  return props.selected ? [encodeGraphNodeId(props.selected)] : [];
});

const drawnNodeCount = computed(() => {
  if (activeMode.value === "overview") return visibleOverviewNodes.value.length;
  return canvasNodes.value.length;
});

const reportedNodeCount = computed(() => {
  if (activeMode.value === "overview") return overviewData.value?.nodeCount ?? visibleOverviewNodes.value.length;
  return drawnNodeCount.value;
});

const reportedEdgeCount = computed(() => {
  if (activeMode.value === "overview") return overviewData.value?.edgeCount ?? visibleOverviewEdges.value.length;
  return canvasEdges.value.length;
});

const activeSelectedNode = computed<PanelObjectValue | null>(() => {
  if (activeMode.value === "overview") {
    const node = selectedOverviewNode.value;
    return node ? { className: node.className, primaryKey: node.primaryKey } : null;
  }
  return props.selected ?? null;
});

useMemberOutput("activeMode", () => activeMode.value);
useMemberOutput("graphStatus", () => graphStatus.value);
useMemberOutput("graphVersion", () => graphVersion.value);
useMemberOutput("sampleToken", () => sampleToken.value);
useMemberOutput("nodeCount", () => reportedNodeCount.value);
useMemberOutput("edgeCount", () => reportedEdgeCount.value);
useMemberOutput("hasMoreNeighbors", () => hasMoreNeighbors.value);
useMemberOutput("versionChanged", () => versionChanged.value);

const queryMatchCount = computed(() => {
  if (!queryNeedle.value) return null;
  return canvasNodes.value.filter((node) => !node.anchor && node.tone === "accent").length;
});

// ---- Legend ----
const instanceLegend = computed(() => {
  const counts = new Map<string, number>();
  const sourceNodes = activeMode.value === "overview" ? visibleOverviewNodes.value : visibleInstanceNodes.value;
  for (const node of sourceNodes) {
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
      const name = relationDisplayName(entry.relationKind, entry.label);
      return entry.reason ? `${name} (${entry.reason})` : name;
    })
    .join(", ");
}

// ---- Panel state output writers ----
function writeSelectedNode(refValue: PanelObjectValue | null) {
  const declaredIdentity = declaredNodeIdentity.value;
  const allowsAny = declaredIdentity?.kind === "object" && declaredIdentity.objectType === "@any";
  if (refValue && declaredIdentity && !allowsAny && !matchesObjectType(declaredIdentity, refValue.className)) {
    throw new TypeError(`Graph node '${refValue.className}' is outside the projection's declared nodeIdentity`);
  }
  const next = refValue ? { className: refValue.className, primaryKey: refValue.primaryKey } : null;
  const memberDecl = panel.manifest.members[member.key];
  const outputName = memberDecl?.outputs?.selectedNode
    ? "selectedNode"
    : memberDecl?.outputs?.selected
      ? "selected"
      : member.projection.outputs.selectedNode
        ? "selectedNode"
        : member.projection.outputs.selected
          ? "selected"
          : "selectedNode";
  void panel.instance.output(member.key, outputName, next);
  emit("update:selected", refValue);
}

function writeSelectedType(typeId: string | null) {
  void panel.instance.output(member.key, "selectedType", typeId);
  emit("update:selectedType", typeId);
}

// ---- Data loading & incremental 1-hop expansion ----
async function loadTypeMode(generation: number) {
  loading.value = true;
  forbidden.value = false;
  errorMessage.value = null;
  versionChanged.value = false;
  try {
    const schemaPromise = graphSource.schema!();
    const countsPromise = graphSource.counts ? graphSource.counts() : Promise.resolve<readonly PlatformGraphTypeCount[]>([]);
    const [schema, counts] = await Promise.all([schemaPromise, countsPromise]);
    if (generation !== loadGeneration) return;
    typeSchema.value = schema;
    typeCounts.value = counts;
    if (!isPositionsBound.value) positionsParam.set(null);
    await nextTick();
    fitReadable();
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

function computeOverviewBaseLayout(
  nodes: readonly PlatformGraphNode[],
  edgeCount: number,
  groupOrder: readonly string[],
): Map<string, GraphCanvasPoint> {
  if (isLargeGraph(nodes.length, edgeCount)) {
    return layoutGrid(nodes.map((node) => encodeGraphNodeId(node)));
  }
  return layoutGroupedOverview(
    nodes.map((node) => ({
      id: encodeGraphNodeId(node),
      groupId: node.className,
      label: node.label,
    })),
    groupOrder,
  );
}

async function loadOverviewMode(generation: number) {
  if (!graphSource.overview) {
    loading.value = false;
    return;
  }
  loading.value = true;
  loadingConnections.value = false;
  forbidden.value = false;
  errorMessage.value = null;
  versionChanged.value = false;
  overviewEdgesTruncated.value = false;
  try {
    const result = await graphSource.overview();
    if (generation !== loadGeneration) return;
    overviewData.value = result;

    if (result.status !== "READY") {
      overviewNodes.value = new Map();
      overviewEdges.value = [];
      overviewBasePositions.value = new Map();
      loading.value = false;
      return;
    }

    const nextNodes = new Map<string, PlatformGraphNode>();
    for (const node of result.nodes) {
      nextNodes.set(encodeGraphNodeId(node), node);
    }
    overviewNodes.value = nextNodes;
    overviewBasePositions.value = computeOverviewBaseLayout(
      result.nodes,
      result.edges?.length ?? result.edgeCount ?? 0,
      result.groups.map((group) => group.id),
    );

    if (result.edges !== undefined) {
      overviewEdges.value = result.edges;
      overviewEdgesTruncated.value = Boolean(result.edgesTruncated);
      loading.value = false;
      await nextTick();
      fitReadable();
      return;
    }

    overviewEdges.value = [];
    loading.value = false;
    await nextTick();
    fitReadable();

    if (graphSource.connections && result.version) {
      loadingConnections.value = true;
      try {
        const connections = await graphSource.connections({
          version: result.version,
          ...(result.sampleToken ? { sampleToken: result.sampleToken } : {}),
        });
        if (generation !== loadGeneration) return;
        overviewEdges.value = connections.edges;
        overviewEdgesTruncated.value = Boolean(connections.truncated);
      } catch (reason: unknown) {
        if (generation !== loadGeneration) return;
        recordFailure(reason);
      } finally {
        if (generation === loadGeneration) loadingConnections.value = false;
      }
    }
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
    loading.value = false;
  }
}

interface ExpandOptions {
  readonly isRoot?: boolean;
  readonly force?: boolean;
  readonly append?: boolean;
  readonly offset?: number;
  readonly resetSubgraph?: boolean;
}

async function expandInstanceNode(refValue: PanelObjectValue, generation: number, options: ExpandOptions = {}) {
  const { isRoot = false, force = false, append = false, offset, resetSubgraph = false } = options;
  const nodeId = encodeGraphNodeId(refValue);
  if ((!force && !append && !resetSubgraph && expandedNodes.value.has(nodeId)) || expandingNodeIds.has(nodeId)) return;
  expandingNodeIds.add(nodeId);

  if (isRoot) loading.value = true;
  else expanding.value = true;
  forbidden.value = false;
  errorMessage.value = null;

  const allLayersActive = availableLayers.value.length > 0
    && availableLayers.value.every((layer) => enabledLayers.value.has(layer));
  const activeLayers =
    neighborSupportedParams.value.has("layers")
    && availableLayers.value.length > 0
    && (hasDeclaredLayerSet.value || !allLayersActive)
      ? [...enabledLayers.value]
      : undefined;

  const activeRelationKinds =
    supportsRelationKindsParam.value && shownKinds.value && shownKinds.value.size > 0
      ? [...shownKinds.value]
      : undefined;

  const query: PlatformGraphNeighborsQuery = {
    node: refValue,
    ...(activeLayers ? { layers: activeLayers } : {}),
    ...(activeRelationKinds ? { relationKinds: activeRelationKinds } : {}),
    ...(supportsDirectionFilter.value ? { direction: neighborDirection.value } : {}),
    ...(supportsTargetGroupFilter.value && neighborTargetGroup.value ? { targetClass: neighborTargetGroup.value } : {}),
    ...(supportsNeighborPaging.value && props.neighborPageSize > 0 ? { limit: props.neighborPageSize } : {}),
    ...(supportsNeighborPaging.value ? { offset: offset ?? 0 } : {}),
  };

  try {
    const result = await graphSource.neighbors(query);
    if (generation !== loadGeneration) return;

    if (result.version) {
      lastNeighborVersion.value = result.version;
    }

    const baseNodes = resetSubgraph ? new Map<string, PlatformGraphNode>() : new Map(instanceNodes.value);
    const centerId = encodeGraphNodeId(result.node);
    baseNodes.set(centerId, result.node);
    const addedIds: string[] = [];
    for (const neighbor of result.neighbors) {
      const id = encodeGraphNodeId(neighbor);
      if (!baseNodes.has(id)) addedIds.push(id);
      baseNodes.set(id, neighbor);
    }

    const baseEdges = resetSubgraph ? new Map<string, PlatformGraphEdge>() : new Map(instanceEdges.value);
    for (const edge of result.edges) {
      baseEdges.set(edge.id, edge);
    }

    const basePositions = resetSubgraph
      ? new Map<string, GraphCanvasPoint>([[centerId, savedPositions.value.get(centerId) ?? instancePositions.value.get(centerId) ?? { x: 0, y: 0 }]])
      : new Map(instancePositions.value);
    if (!basePositions.has(centerId)) {
      basePositions.set(centerId, { x: 0, y: 0 });
    }
    const anchor = savedPositions.value.get(centerId) ?? basePositions.get(centerId)!;
    const prevPage = neighborPagesByNode.value.get(centerId);
    const priorLoaded = append ? (prevPage?.loaded ?? 0) : 0;

    let placed: Map<string, GraphCanvasPoint>;
    if (append && priorLoaded > 0) {
      placed = new Map(basePositions);
      addedIds.forEach((addedId, idx) => {
        placed.set(addedId, placeRadialNeighbor(priorLoaded + idx, anchor));
      });
    } else {
      const origin = (rootNodeId.value && basePositions.get(rootNodeId.value)) || { x: 0, y: 0 };
      placed = placeExpandedNeighbors(anchor, origin, addedIds, basePositions);
    }

    const nextExpanded = resetSubgraph ? new Set<string>([centerId]) : new Set(expandedNodes.value);
    nextExpanded.add(centerId);
    const fetchedSet = !activeLayers || allLayersActive ? null : new Set(activeLayers);
    const nextFetched = resetSubgraph ? new Map<string, Set<string> | null>() : new Map(fetchedLayersByNode.value);
    nextFetched.set(centerId, fetchedSet);
    const nextStatuses = resetSubgraph ? new Map<string, readonly PlatformGraphRelationStatus[]>() : new Map(relationStatusesByNode.value);
    nextStatuses.set(centerId, result.relations);

    const nextPages = resetSubgraph ? new Map<string, NeighborPageState>() : new Map(neighborPagesByNode.value);
    nextPages.set(centerId, {
      nextOffset: result.nextOffset ?? null,
      total: result.total ?? null,
      loaded: priorLoaded + result.neighbors.length,
    });

    instanceNodes.value = baseNodes;
    instanceEdges.value = baseEdges;
    instancePositions.value = placed;
    expandedNodes.value = nextExpanded;
    fetchedLayersByNode.value = nextFetched;
    relationStatusesByNode.value = nextStatuses;
    neighborPagesByNode.value = nextPages;
    focusedNodeId.value = centerId;
    if (isRoot || resetSubgraph) rootNodeId.value = centerId;

    if (!isRoot && !append && !resetSubgraph && centerId !== rootNodeId.value) {
      const alreadyDeclared = paramExpandedNodes.value.some((item) => encodeGraphNodeId(item) === centerId);
      if (!alreadyDeclared) {
        expandedNodesParam.set([
          ...paramExpandedNodes.value,
          { className: result.node.className, primaryKey: result.node.primaryKey },
        ]);
      }
    }

    if (isRoot || resetSubgraph) {
      await nextTick();
      fitReadable();
    }

    // If additional layers were enabled while this request was in flight, backfill them once unlocked.
    const needsBackfill =
      activeMode.value === "instance"
      && fetchedSet !== null
      && [...enabledLayers.value].some((layer) => !fetchedSet.has(layer));
    if (needsBackfill) {
      expandingNodeIds.delete(nodeId);
      void expandInstanceNode({ className: result.node.className, primaryKey: result.node.primaryKey }, generation, { force: true });
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
  versionChanged.value = false;
  instanceNodes.value = new Map();
  instanceEdges.value = new Map();
  expandedNodes.value = new Set();
  expandingNodeIds.clear();
  fetchedLayersByNode.value = new Map();
  relationStatusesByNode.value = new Map();
  neighborPagesByNode.value = new Map();
  instancePositions.value = new Map();
  if (!isPositionsBound.value) positionsParam.set(null);
  rootNodeId.value = null;
  focusedNodeId.value = null;
  if (!isExpandedNodesBound.value && paramExpandedNodes.value.length > 0) {
    expandedNodesParam.set(null);
  }

  try {
    let startRef: PanelObjectValue | null = effectiveStart.value
      ? { className: effectiveStart.value.className, primaryKey: effectiveStart.value.primaryKey }
      : null;
    if (!startRef) {
      const resolvedStart = await graphSource.start?.();
      if (generation !== loadGeneration) return;
      if (!resolvedStart) {
        loading.value = false;
        return;
      }
      startRef = { className: resolvedStart.className, primaryKey: resolvedStart.primaryKey };
      const seeded = new Map<string, PlatformGraphNode>();
      const startId = encodeGraphNodeId(resolvedStart);
      seeded.set(startId, resolvedStart);
      instanceNodes.value = seeded;
      instancePositions.value = new Map([[startId, { x: 0, y: 0 }]]);
      rootNodeId.value = startId;
    }
    await expandInstanceNode(startRef, generation, { isRoot: true });
    if (generation !== loadGeneration) return;

    let expandedExtra = false;
    for (const extraRef of paramExpandedNodes.value) {
      if (generation !== loadGeneration) return;
      const extraId = encodeGraphNodeId(extraRef);
      if (!expandedNodes.value.has(extraId)) {
        await expandInstanceNode(extraRef, generation);
        expandedExtra = true;
      }
    }
    if (generation !== loadGeneration) return;
    const selectedId = props.selected ? encodeGraphNodeId(props.selected) : null;
    focusedNodeId.value = selectedId && instanceNodes.value.has(selectedId) ? selectedId : rootNodeId.value;
    if (expandedExtra) {
      await nextTick();
      fitReadable();
    }
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
    loading.value = false;
  }
}

function reload() {
  const generation = ++loadGeneration;
  if (activeMode.value === "type") void loadTypeMode(generation);
  else if (activeMode.value === "overview") void loadOverviewMode(generation);
  else void loadInstanceMode(generation);
}

function recoverFromVersionChange() {
  versionChanged.value = false;
  const currentMode = (): "type" | "instance" | "overview" => activeMode.value;
  if (hasOverviewPort && currentMode() === "instance") {
    explorationRoot.value = null;
    returnedToOverview.value = true;
    // If activeMode changed to "overview", the watcher will trigger reload(); otherwise reload directly.
    if (currentMode() === "overview") return;
  }
  reload();
}

function backToOverview() {
  if (!hasOverviewPort) return;
  explorationRoot.value = null;
  returnedToOverview.value = true;
}

function exploreNode(node: PlatformGraphNode | PanelObjectValue) {
  const refValue: PanelObjectValue = { className: node.className, primaryKey: node.primaryKey };
  returnedToOverview.value = false;
  explorationRoot.value = refValue;
  writeSelectedNode(refValue);
}

function loadMoreNeighbors() {
  if (activeMode.value !== "instance" || expanding.value) return;
  const targetId = focusedNodeId.value ?? (props.selected ? encodeGraphNodeId(props.selected) : null) ?? rootNodeId.value;
  if (!targetId) return;
  const page = neighborPagesByNode.value.get(targetId);
  const node = instanceNodes.value.get(targetId);
  if (!page || page.nextOffset === null || !node) return;
  void expandInstanceNode(
    { className: node.className, primaryKey: node.primaryKey },
    loadGeneration,
    { append: true, offset: page.nextOffset },
  );
}

function applyNeighborFilters() {
  if (activeMode.value !== "instance") return;
  const targetId = focusedNodeId.value ?? rootNodeId.value;
  const node = targetId ? instanceNodes.value.get(targetId) : undefined;
  if (!node) return;
  const generation = ++loadGeneration;
  expandingNodeIds.clear();
  void expandInstanceNode(
    { className: node.className, primaryKey: node.primaryKey },
    generation,
    { resetSubgraph: true, offset: 0 },
  );
}

function handleDirectionChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as NeighborDirection;
  neighborDirection.value = value;
  applyNeighborFilters();
}

function handleTargetGroupChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  neighborTargetGroup.value = value;
  applyNeighborFilters();
}

watch(
  () => [activeMode.value, effectiveStart.value?.className ?? "", effectiveStart.value?.primaryKey ?? ""] as const,
  () => reload(),
  { immediate: true },
);

watch(
  () => paramExpandedNodes.value.map((item) => encodeGraphNodeId(item)).join("\u0000"),
  async () => {
    if (activeMode.value !== "instance" || !rootNodeId.value || loading.value) return;
    const generation = loadGeneration;
    const desired = paramExpandedNodes.value;
    const desiredIds = new Set(desired.map((item) => encodeGraphNodeId(item)));
    for (const expandedId of expandedNodes.value) {
      if (expandedId !== rootNodeId.value && !desiredIds.has(expandedId)) {
        reload();
        return;
      }
    }
    for (const extraRef of desired) {
      if (generation !== loadGeneration) return;
      const extraId = encodeGraphNodeId(extraRef);
      if (!expandedNodes.value.has(extraId)) {
        await expandInstanceNode(extraRef, generation);
      }
    }
  },
);

watch(
  () => [props.selected?.className ?? "", props.selected?.primaryKey ?? ""] as const,
  ([className, primaryKey]) => {
    if (!className || !primaryKey) return;
    const id = encodeGraphNodeId({ className, primaryKey });
    if (activeMode.value === "overview") {
      if (overviewNodes.value.has(id)) {
        localSelectedOverviewId.value = id;
        focusedNodeId.value = id;
      }
      return;
    }
    if (activeMode.value !== "instance") return;
    focusedNodeId.value = id;
    if (instanceNodes.value.has(id) && !expandedNodes.value.has(id)) {
      void expandInstanceNode({ className, primaryKey }, loadGeneration);
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
  if (activeMode.value === "overview") {
    if (!pickedId) {
      localSelectedOverviewId.value = null;
      focusedNodeId.value = null;
      writeSelectedNode(null);
      return;
    }
    if (isOverviewGroupAnchorId(pickedId)) return;
    const node = overviewNodes.value.get(pickedId);
    if (!node) return;
    localSelectedOverviewId.value = pickedId;
    focusedNodeId.value = pickedId;
    writeSelectedNode({ className: node.className, primaryKey: node.primaryKey });
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
    void expandInstanceNode(fullRef, loadGeneration);
  }
}

function handleActivate(element: GraphCanvasElement) {
  if (activeMode.value !== "overview" || element.kind !== "node" || isOverviewGroupAnchorId(element.id)) return;
  const node = overviewNodes.value.get(element.id);
  if (node) exploreNode(node);
}

function handleBlank() {
  if (activeMode.value === "type") {
    writeSelectedType(null);
  } else if (activeMode.value === "overview") {
    localSelectedOverviewId.value = null;
    focusedNodeId.value = null;
    writeSelectedNode(null);
  } else {
    focusedNodeId.value = rootNodeId.value;
    writeSelectedNode(null);
  }
}

function handleMove(id: string, position: GraphCanvasPoint) {
  if (isOverviewGroupAnchorId(id)) return;
  const next: Record<string, { x: number; y: number }> = {};
  for (const [key, point] of savedPositions.value) {
    next[key] = { x: point.x, y: point.y };
  }
  next[id] = { x: position.x, y: position.y };
  positionsParam.set(next as unknown as RuntimeJsonValue);
}

function handleViewport(viewport: GraphCanvasViewport) {
  currentViewport.value = viewport;
  if (fitted && !fitting && partial.value) moved.value = true;
}

/** Re-fits the graph once its container settles at a new size (e.g. a side panel toggling or composer resizing). */
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
function handleResized() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitReadable();
  }, 200);
}
onBeforeUnmount(() => clearTimeout(resizeTimer));

// ---- Toolbar actions ----
function zoomIn() {
  void canvas.value?.zoomBy?.(ZOOM_STEP);
}

function zoomOut() {
  void canvas.value?.zoomBy?.(1 / ZOOM_STEP);
}

function fitView() {
  partial.value = false;
  moved.value = false;
  const padding: number | [number, number, number, number] = activeMode.value === "overview" ? [64, 48, 48, 48] : 36;
  void canvas.value?.fit({ maxZoom: 1.2, padding });
}

async function relayout() {
  positionsParam.set(null);
  if (activeMode.value === "overview" && overviewData.value?.status === "READY") {
    overviewBasePositions.value = computeOverviewBaseLayout(
      [...overviewNodes.value.values()],
      overviewEdges.value.length,
      overviewGroups.value.map((group) => group.id),
    );
  } else if (activeMode.value === "instance" && rootNodeId.value) {
    const nodeIds = [...instanceNodes.value.keys()];
    if (isLargeGraph(nodeIds.length, instanceEdges.value.size)) {
      instancePositions.value = layoutGrid(nodeIds);
    } else {
      const edgeLinks = [...instanceEdges.value.values()].map((edge) => ({
        source: encodeGraphNodeId(edge.from),
        target: encodeGraphNodeId(edge.to),
      }));
      instancePositions.value = layoutInstanceRadial(rootNodeId.value, nodeIds, edgeLinks);
    }
  }
  await nextTick();
  await canvas.value?.relayout?.();
  fitReadable();
}

async function downloadPng() {
  if (!canvas.value) return;
  const image = await canvas.value.exportImage();
  const date = new Date().toISOString().slice(0, 10);
  const baseName =
    (accessibleLabel.value || "graph")
      .replace(/[/\\\p{Cc}]+/gu, "-")
      .replace(/^\.+/u, "")
      .trim() || "graph";
  savePanelFile({
    bytes: image,
    mime: "image/png",
    suggestedName: `${baseName}-${date}.png`,
  });
}

const stopRefresh = panel.instance.onObjectChanged((target) => {
  if (target === null) reload();
});

onMounted(() => {
  if (rootEl.value) paletteSize.value = readGraphPalette(rootEl.value).length;
});

onBeforeUnmount(() => {
  stopRefresh();
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
          {{ t("platform.graphCounts", { nodes: drawnNodeCount, edges: canvasEdges.length }) }}
        </span>
      </div>
    </div>

    <div
      v-if="showNeighborControls && activeMode === 'instance' && (canReturnToOverview || supportsDirectionFilter || (supportsTargetGroupFilter && availableTargetGroups.length > 0) || (currentNeighborPage && currentNeighborPage.nextOffset !== null))"
      class="sdk-ontology-graph-controls"
      data-graph-neighbor-controls
    >
      <button
        v-if="canReturnToOverview"
        type="button"
        class="sdk-ontology-graph-pill-btn"
        data-graph-action="back-to-overview"
        @click="backToOverview"
      >
        {{ t("platform.graphBackToOverview") }}
      </button>
      <label v-if="supportsDirectionFilter" class="sdk-ontology-graph-filter">
        <span>{{ t("platform.graphDirection") }}</span>
        <select
          class="sdk-ontology-graph-select"
          data-graph-filter="direction"
          :value="neighborDirection"
          @change="handleDirectionChange"
        >
          <option value="both">{{ t("platform.graphDirectionBoth") }}</option>
          <option value="outgoing">{{ t("platform.graphDirectionOutgoing") }}</option>
          <option value="incoming">{{ t("platform.graphDirectionIncoming") }}</option>
        </select>
      </label>
      <label v-if="supportsTargetGroupFilter && availableTargetGroups.length > 0" class="sdk-ontology-graph-filter">
        <span>{{ t("platform.graphTargetGroup") }}</span>
        <select
          class="sdk-ontology-graph-select"
          data-graph-filter="target-group"
          :value="neighborTargetGroup"
          @change="handleTargetGroupChange"
        >
          <option value="">{{ t("platform.graphAllGroups") }}</option>
          <option v-for="group in availableTargetGroups" :key="group.id" :value="group.id">
            {{ group.label }}
          </option>
        </select>
      </label>
      <div v-if="currentNeighborPage && currentNeighborPage.nextOffset !== null" class="sdk-ontology-graph-paging" data-graph-neighbors-paging>
        <span class="sdk-ontology-graph-paging-text" data-graph-neighbors-progress>
          {{
            currentNeighborPage.total != null
              ? t("platform.graphNeighborsProgress", { loaded: currentNeighborPage.loaded, total: currentNeighborPage.total })
              : t("platform.graphNeighborsLoadedCount", { loaded: currentNeighborPage.loaded })
          }}
        </span>
        <button
          type="button"
          class="sdk-ontology-graph-pill-btn is-primary"
          data-graph-action="load-more-neighbors"
          :disabled="expanding"
          @click="loadMoreNeighbors"
        >
          {{ t("platform.graphLoadMoreNeighbors") }}
        </button>
      </div>
    </div>

    <div
      v-if="showNeighborControls && activeMode === 'overview' && selectedOverviewNode"
      class="sdk-ontology-graph-controls"
      data-graph-overview-selection
    >
      <span class="sdk-ontology-graph-selection-name">{{ selectedOverviewNode.label }}</span>
      <button
        type="button"
        class="sdk-ontology-graph-pill-btn is-primary"
        data-graph-action="explore-neighbors"
        @click="exploreNode(selectedOverviewNode)"
      >
        {{ t("platform.graphExploreNeighbors") }}
      </button>
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

    <div v-if="versionChanged" class="sdk-ontology-graph-notice is-warning is-actionable" role="status" data-graph-state="version-changed">
      <span>{{ t("platform.graphVersionChanged") }}</span>
      <button
        type="button"
        class="sdk-ontology-graph-notice-action"
        data-graph-action="refresh-version"
        @click="recoverFromVersionChange"
      >
        {{ t("platform.graphRefresh") }}
      </button>
    </div>
    <div v-if="forbidden" class="sdk-ontology-graph-notice is-warning" role="status" data-graph-state="forbidden">
      {{ t("platform.dataForbidden") }}
    </div>
    <div v-else-if="errorMessage" class="sdk-ontology-graph-notice is-error" role="alert" data-graph-state="error">
      {{ errorMessage }}
    </div>
    <div
      v-if="activeMode === 'overview' && overviewData?.status === 'READY' && overviewEdgesTruncated"
      class="sdk-ontology-graph-notice is-info"
      role="status"
      data-graph-state="edges-truncated"
    >
      {{ t("platform.graphEdgesTruncated") }}
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

    <el-skeleton v-if="loading && drawnNodeCount === 0" :rows="6" animated class="sdk-ontology-graph-skeleton" />
    <div
      v-else-if="activeMode === 'overview' && overviewData?.status === 'GENERATING'"
      class="sdk-ontology-graph-notice is-info is-actionable"
      role="status"
      data-graph-state="generating"
    >
      <span>{{ t("platform.graphOverviewGenerating") }}</span>
      <button
        type="button"
        class="sdk-ontology-graph-notice-action"
        data-graph-action="refresh"
        @click="reload"
      >
        {{ t("platform.graphRefresh") }}
      </button>
    </div>
    <el-empty
      v-else-if="activeMode === 'overview' && overviewData?.status === 'NOT_GENERATED'"
      :description="t('platform.graphOverviewNotGenerated')"
      :image-size="48"
      data-graph-state="not-generated"
    />
    <el-empty
      v-else-if="!loading && !forbidden && !errorMessage && drawnNodeCount === 0"
      :description="t('platform.graphEmpty')"
      :image-size="48"
    />
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
        readable-labels
        :max-height="maxHeight"
        @update:selected="handleSelect"
        @activate="handleActivate"
        @blank="handleBlank"
        @move="handleMove"
        @viewport="handleViewport"
        @resized="handleResized"
      />
      <div v-if="overviewGroupHeadings.length > 0" class="sdk-ontology-graph-headings" data-graph-group-headings aria-hidden="true">
        <div
          v-for="heading in overviewGroupHeadings"
          :key="heading.id"
          class="sdk-ontology-graph-heading"
          :data-graph-group-heading="heading.id"
          :style="{ left: `${heading.x}px`, top: `${heading.y}px`, maxWidth: `${heading.width}px` }"
        >
          <i class="sdk-ontology-graph-dot" :style="{ background: categoryColor(heading.id) }" />
          <span class="sdk-ontology-graph-heading-label">{{ heading.label }}</span>
          <span class="sdk-ontology-graph-heading-count">{{ heading.countText }}</span>
        </div>
      </div>
      <p v-if="partial" class="sdk-ontology-graph-hint" :class="{ quiet: moved }" role="status" data-graph-hint>
        {{ t("platform.graphLargerThanCanvas") }}
      </p>
      <div v-if="showToolbar" class="sdk-ontology-graph-tools" data-graph-toolbar>
        <button
          v-if="showAggregateToggle && activeMode === 'overview'"
          type="button"
          class="sdk-ontology-graph-tool"
          :class="{ 'is-active': aggregateEdgesEnabled }"
          :aria-pressed="aggregateEdgesEnabled"
          data-graph-action="toggle-aggregate"
          :title="t('platform.graphAggregateEdges')"
          :aria-label="t('platform.graphAggregateEdges')"
          @click="toggleAggregateEdges"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="3.5" cy="4" r="1.5" />
            <circle cx="3.5" cy="12" r="1.5" />
            <circle cx="12.5" cy="8" r="1.5" />
            <path d="M5 4.5 11 7.5M5 11.5 11 8.5" />
          </svg>
        </button>
        <button
          v-if="showEdgeLabelToggle"
          type="button"
          class="sdk-ontology-graph-tool"
          :class="{ 'is-active': edgeLabelsEnabled }"
          :aria-pressed="edgeLabelsEnabled"
          data-graph-action="toggle-edge-labels"
          :title="t('platform.graphShowEdgeLabels')"
          :aria-label="t('platform.graphShowEdgeLabels')"
          @click="toggleEdgeLabels"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 5h11M2.5 11h7M11.5 9.5l2 2-2 2" />
          </svg>
        </button>
        <button
          v-if="showZoomControls"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="zoom-in"
          :title="t('platform.graphZoomIn')"
          :aria-label="t('platform.graphZoomIn')"
          @click="zoomIn"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button
          v-if="showZoomControls"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="zoom-out"
          :title="t('platform.graphZoomOut')"
          :aria-label="t('platform.graphZoomOut')"
          @click="zoomOut"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
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
        <button
          v-if="showRefreshControl"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="refresh"
          :title="t('platform.graphRefresh')"
          :aria-label="t('platform.graphRefresh')"
          @click="reload"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.75L13.5 5.5M13.5 2.5v3h-3M13.5 8a5.5 5.5 0 0 1-9.5 3.75L2.5 10.5M2.5 13.5v-3h3" />
          </svg>
        </button>
        <button
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="download"
          :title="t('common.download')"
          :aria-label="t('common.download')"
          @click="downloadPng"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
          </svg>
        </button>
        <slot
          name="toolbar"
          :mode="activeMode"
          :status="graphStatus"
          :aggregate-edges="aggregateEdgesEnabled"
          :toggle-aggregate-edges="toggleAggregateEdges"
          :show-edge-labels="edgeLabelsEnabled"
          :toggle-edge-labels="toggleEdgeLabels"
          :zoom-in="zoomIn"
          :zoom-out="zoomOut"
          :fit-view="fitView"
          :relayout="relayout"
          :refresh="reload"
          :export-png="downloadPng"
          :back-to-overview="backToOverview"
          :can-return-to-overview="canReturnToOverview"
          :node-count="reportedNodeCount"
          :edge-count="reportedEdgeCount"
        />
      </div>
      <div v-if="$slots.overlay" class="sdk-ontology-graph-overlay" data-graph-overlay>
        <slot
          name="overlay"
          :mode="activeMode"
          :status="graphStatus"
          :version="graphVersion"
          :sample-token="sampleToken"
          :groups="overviewGroups"
          :selected-node="activeSelectedNode"
          :node-count="reportedNodeCount"
          :edge-count="reportedEdgeCount"
          :has-more-neighbors="hasMoreNeighbors"
          :version-changed="versionChanged"
          :refresh="reload"
          :back-to-overview="backToOverview"
          :explore-node="exploreNode"
        />
      </div>
      <span v-if="loadingConnections" class="sdk-ontology-graph-busy" role="status" data-graph-state="connections-loading">
        {{ t("platform.graphConnectionsLoading") }}
      </span>
      <span v-else-if="expanding" class="sdk-ontology-graph-busy" role="status">
        {{ t("platform.graphExpanding") }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.sdk-ontology-graph {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.sdk-ontology-graph-bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm) var(--spacing-md);
}

.sdk-ontology-graph-controls {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-selection-name {
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
}

.sdk-ontology-graph-filter {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.sdk-ontology-graph-select {
  height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
}

.sdk-ontology-graph-paging {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-inline-start: auto;
}

.sdk-ontology-graph-paging-text {
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-pill-btn {
  display: inline-flex;
  align-items: center;
  height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  cursor: pointer;
}

.sdk-ontology-graph-pill-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
}

.sdk-ontology-graph-pill-btn.is-primary {
  border-color: var(--brand-primary, var(--el-color-primary));
  color: var(--brand-link, var(--el-color-primary));
}

.sdk-ontology-graph-pill-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sdk-ontology-graph-layers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.sdk-ontology-graph-layer-pill {
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-full);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  cursor: pointer;
}

.sdk-ontology-graph-layer-pill.is-active {
  border-color: var(--ui-border);
  background: var(--ui-fill-secondary);
  color: var(--el-text-color-primary);
}

.sdk-ontology-graph-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-matches {
  color: var(--brand-link);
  font-weight: var(--font-medium);
}

.sdk-ontology-graph-legend {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs) var(--spacing-md);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.sdk-ontology-graph-legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.sdk-ontology-graph-legend-item b {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-regular);
}

.sdk-ontology-graph-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
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
  flex: 0 0 auto;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 1.5;
  border: 1px solid var(--ui-divider);
}

.sdk-ontology-graph-notice.is-actionable {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.sdk-ontology-graph-notice-action {
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border: 1px solid currentColor;
  border-radius: var(--radius-xs);
  background: transparent;
  color: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.sdk-ontology-graph-notice.is-info {
  background: var(--ui-fill-tertiary);
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
  padding: var(--spacing-lg);
}

.sdk-ontology-graph-frame {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background-color: var(--el-fill-color-blank);
}

.sdk-ontology-graph-canvas {
  width: 100%;
  height: 100%;
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 18px 18px;
}

.sdk-ontology-graph-headings {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.sdk-ontology-graph-heading {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: 26px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-full);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
}

.sdk-ontology-graph-heading-label {
  font-weight: var(--font-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
}

.sdk-ontology-graph-heading-count {
  color: var(--el-text-color-secondary);
  flex: 0 0 auto;
}

.sdk-ontology-graph-overlay {
  position: absolute;
  top: var(--spacing-sm);
  left: var(--spacing-sm);
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-width: calc(100% - 220px);
}

.sdk-ontology-graph-tools {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: calc(var(--spacing-xs) / 2);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
}

.sdk-ontology-graph-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

/* Icon tools are borderless: a quiet fill on hover and press, the group's surface behind them (DESIGN.md). */
.sdk-ontology-graph-tool:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}

.sdk-ontology-graph-tool:active,
.sdk-ontology-graph-tool.is-active {
  background: var(--ui-fill-quaternary);
  color: var(--el-text-color-primary);
}

.sdk-ontology-graph-hint {
  position: absolute;
  inset-block-end: var(--spacing-sm);
  inset-inline-start: var(--spacing-sm);
  margin: 0;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  pointer-events: none;
  transition: opacity 200ms ease-out;
}

.sdk-ontology-graph-hint.quiet {
  opacity: 0.55;
}

.sdk-ontology-graph-busy {
  position: absolute;
  bottom: var(--spacing-sm);
  right: var(--spacing-sm);
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border-radius: var(--radius-xs);
  background: var(--el-bg-color);
  border: 1px solid var(--ui-divider);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
</style>
