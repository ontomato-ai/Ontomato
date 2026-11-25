<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElCheckbox } from "element-plus/es/components/checkbox/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElPopover } from "element-plus/es/components/popover/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { ElSwitch } from "element-plus/es/components/switch/index";
import { ElTooltip } from "element-plus/es/components/tooltip/index";
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
  G6_NODE_SIZE,
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

export interface GraphNeighborFilter {
  readonly targetClass?: string | null;
  readonly relationKind?: string | null;
  readonly direction?: NeighborDirection;
  readonly fitAfterExpand?: boolean;
}

interface NeighborPageState {
  readonly nextOffset: number | null;
  readonly total: number | null;
  readonly loaded: number;
}

const ZOOM_STEP = 1.2;
const GENERATION_POLL_INTERVAL_MS = 2000;

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
    /** Active highlighted group ID in overview mode (e.g. synced with a group/type filter). */
    selectedGroup?: string | null;
    /** Search string that highlights drawn matches without hiding other nodes or querying upstream. */
    query?: string | null;
    /** Accessible graph label; falls back to the projection's name. */
    label?: string;
    /** Initial enabled layers; defaults to all layers present in schema or loaded nodes. */
    layers?: readonly string[] | null;
    /** Viewport fitting & label scaling mode: `"fit"` shows the whole graph in panorama without forced zoom-in; `"readable"` holds labels at screen size. Defaults to `"fit"` when `overview` is bound, `"readable"` otherwise. */
    fitMode?: "fit" | "readable";
    /** Neighbor expansion trigger in instance mode: `"activate"` selects on single click and expands on double click; `"select"` expands unexpanded nodes on click. Defaults to `"activate"` when `overview` is bound, `"select"` otherwise. */
    expandOn?: "activate" | "select";
    /** Show layer filter pills when multiple layers exist. */
    showLayerFilter?: boolean;
    /** Show legend strip. */
    showLegend?: boolean;
    /** Show floating graph toolbar. */
    showToolbar?: boolean;
    /** Show bottom-right interaction hint strip. */
    showHint?: boolean;
    /** Aggregate inter-group edges in overview mode (enabled by default). */
    aggregateEdges?: boolean;
    /** Draw labels on graph edges (enabled by default). */
    showEdgeLabels?: boolean;
    /** Show the aggregated-edges toggle inside display settings in overview mode. */
    showAggregateToggle?: boolean;
    /** Show the edge-labels toggle inside display settings. */
    showEdgeLabelToggle?: boolean;
    /** Show zoom-in and zoom-out buttons in the toolbar. */
    showZoomControls?: boolean;
    /** Show refresh button in the toolbar. */
    showRefreshControl?: boolean;
    /** Show built-in neighbor filter popover controls when supported by the neighbors port. */
    showNeighborControls?: boolean;
    /** Applied neighbor filter configuration (`direction`, `targetClass`, `relationKind`, `fitAfterExpand`). Updating this applies the filter; unapplied edits in the toolbar popover stay internal until submitted. */
    neighborFilter?: GraphNeighborFilter | null;
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
    selectedGroup: null,
    query: "",
    label: undefined,
    layers: undefined,
    fitMode: undefined,
    expandOn: undefined,
    showLayerFilter: true,
    showLegend: true,
    showToolbar: true,
    showHint: true,
    aggregateEdges: true,
    showEdgeLabels: true,
    showAggregateToggle: true,
    showEdgeLabelToggle: true,
    showZoomControls: true,
    showRefreshControl: true,
    showNeighborControls: true,
    neighborFilter: null,
    neighborPageSize: 50,
    maxHeight: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted in overview or instance mode when a reader selects a node (full identity) or clears selection. */
  "update:selected": [node: PanelObjectValue | null];
  /** Emitted in type mode when a reader selects a type node or clears selection. */
  "update:selectedType": [typeId: string | null];
  /** Emitted in overview mode when a reader selects a cluster group heading. */
  "update:selectedGroup": [groupId: string | null];
  /** Emitted in overview mode when a reader clicks a cluster group heading to filter by that group. */
  "select-group": [groupId: string];
  /** Emitted when the aggregated-edges display setting changes. */
  "update:aggregateEdges": [value: boolean];
  /** Emitted when the edge-labels display setting changes. */
  "update:showEdgeLabels": [value: boolean];
  /** Emitted when the applied neighbor filter changes via the graph toolbar popover. */
  "update:neighborFilter": [value: GraphNeighborFilter];
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

/**
 * Bidirectional selected overview group (`selectedGroup`, scalar string) for cluster heading highlight and filtering.
 */
const selectedGroupParam = useMemberParam("selectedGroup");
const localSelectedGroup = ref<string | null>(null);
const activeSelectedGroup = computed<string | null>(() => {
  if (typeof props.selectedGroup === "string" && props.selectedGroup) return props.selectedGroup;
  const paramVal = selectedGroupParam.value.value;
  if (typeof paramVal === "string" && paramVal) return paramVal;
  return localSelectedGroup.value;
});

const effectiveFitMode = computed<"fit" | "readable">(() =>
  props.fitMode ?? (hasOverviewPort ? "fit" : "readable"),
);
const useReadableLabels = computed(() => effectiveFitMode.value === "readable");
const effectiveExpandOn = computed<"activate" | "select">(() =>
  props.expandOn ?? (hasOverviewPort ? "activate" : "select"),
);

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
const drawing = ref({ drawn: 0, total: 0 });
const rendering = computed(() => drawing.value.total > 0 && drawing.value.drawn < drawing.value.total);
let generationTimer: ReturnType<typeof setTimeout> | undefined;

function clearGenerationTimer() {
  if (generationTimer !== undefined) {
    clearTimeout(generationTimer);
    generationTimer = undefined;
  }
}

// Toolbar toggles (synced with props)
const aggregateEdgesEnabled = ref(props.aggregateEdges);
watch(() => props.aggregateEdges, (next) => { aggregateEdgesEnabled.value = next; });
const edgeLabelsEnabled = ref(props.showEdgeLabels);
watch(() => props.showEdgeLabels, (next) => { edgeLabelsEnabled.value = next; });

function setAggregateEdges(next: string | number | boolean) {
  const enabled = Boolean(next);
  if (aggregateEdgesEnabled.value === enabled) return;
  aggregateEdgesEnabled.value = enabled;
  emit("update:aggregateEdges", enabled);
}

function setEdgeLabels(next: string | number | boolean) {
  const enabled = Boolean(next);
  if (edgeLabelsEnabled.value === enabled) return;
  edgeLabelsEnabled.value = enabled;
  emit("update:showEdgeLabels", enabled);
}

function toggleAggregateEdges() {
  setAggregateEdges(!aggregateEdgesEnabled.value);
}

function toggleEdgeLabels() {
  setEdgeLabels(!edgeLabelsEnabled.value);
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
const overviewRelations = shallowRef<readonly PlatformGraphRelationStatus[]>([]);
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

/**
 * Bidirectional applied neighbor filter (`neighborFilter`, `json` panel state).
 * Changing this public state applies the filter immediately; unapplied edits inside the popover remain local draft state.
 */
const neighborFilterParam = useMemberParam("neighborFilter");

interface NormalizedNeighborFilter {
  readonly direction: NeighborDirection;
  readonly targetClass: string;
  readonly relationKind: string;
  readonly fitAfterExpand: boolean;
}

function normalizeNeighborFilter(raw: unknown): NormalizedNeighborFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { direction: "both", targetClass: "", relationKind: "", fitAfterExpand: false };
  }
  const record = raw as Record<string, unknown>;
  const direction: NeighborDirection =
    record.direction === "incoming" || record.direction === "outgoing" || record.direction === "both"
      ? record.direction
      : "both";
  const targetClass = typeof record.targetClass === "string" ? record.targetClass : "";
  const relationKind = typeof record.relationKind === "string" ? record.relationKind : "";
  const fitAfterExpand = Boolean(record.fitAfterExpand);
  return { direction, targetClass, relationKind, fitAfterExpand };
}

const externalNeighborFilter = computed<GraphNeighborFilter | null>(() => {
  if (props.neighborFilter !== null && props.neighborFilter !== undefined) {
    return props.neighborFilter;
  }
  const paramVal = neighborFilterParam.value.value;
  if (paramVal && typeof paramVal === "object" && !Array.isArray(paramVal)) {
    return paramVal as GraphNeighborFilter;
  }
  return null;
});

// Draft & applied neighbor filters (unapplied edits stay internal until submitted; applied filter syncs with `neighborFilter`)
const initialNeighborFilter = normalizeNeighborFilter(externalNeighborFilter.value);
const draftNeighborDirection = ref<NeighborDirection>(initialNeighborFilter.direction);
const appliedNeighborDirection = ref<NeighborDirection>(initialNeighborFilter.direction);
const draftNeighborTargetGroup = ref<string>(initialNeighborFilter.targetClass);
const appliedNeighborTargetGroup = ref<string>(initialNeighborFilter.targetClass);
const draftNeighborRelationKind = ref<string>(initialNeighborFilter.relationKind);
const appliedNeighborRelationKind = ref<string>(initialNeighborFilter.relationKind);
const draftFitAfterExpand = ref<boolean>(initialNeighborFilter.fitAfterExpand);
const appliedFitAfterExpand = ref<boolean>(initialNeighborFilter.fitAfterExpand);
const neighborFiltersDirty = computed(
  () =>
    draftNeighborDirection.value !== appliedNeighborDirection.value
    || draftNeighborTargetGroup.value !== appliedNeighborTargetGroup.value
    || draftNeighborRelationKind.value !== appliedNeighborRelationKind.value,
);
const neighborPopoverVisible = ref(false);
const neighborPopoverRef = ref<{ hide?: () => void } | null>(null);
const displaySettingsVisible = ref(false);

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

/** Fits the graph to the canvas according to `fitMode` (panoramic `"fit"` or screen-sized `"readable"`). */
function fitGraph(target = canvas.value) {
  if (!target) return;
  fitting = true;
  if (effectiveFitMode.value === "fit") {
    const padding: number | [number, number, number, number] = activeMode.value === "overview" ? [64, 48, 48, 48] : 48;
    void target
      .fit({ maxZoom: 1, padding })
      .then(() => {
        partial.value = false;
        moved.value = false;
        fitted = true;
      })
      .finally(() => {
        fitting = false;
      });
    return;
  }
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

// The canvas is there only while something is drawn: one that appears after an empty or loading view opens cleanly fitted.
watch(canvas, (shown, before) => {
  if (shown && !before) fitGraph(shown);
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

const availableRelationKinds = computed<Array<{ id: string; label: string }>>(() => {
  const byId = new Map<string, string>();
  for (const kind of overviewData.value?.relationTypes ?? []) {
    if (!byId.has(kind)) byId.set(kind, relationDisplayName(kind));
  }
  for (const spec of typeSchema.value?.relationKinds ?? []) {
    byId.set(spec.id, relationDisplayName(spec.id, spec.label, spec.labelKey));
  }
  for (const edge of overviewEdges.value) {
    if (!byId.has(edge.relationKind)) {
      byId.set(edge.relationKind, relationDisplayName(edge.relationKind, edge.label));
    }
  }
  for (const edge of instanceEdges.value.values()) {
    if (!byId.has(edge.relationKind)) {
      byId.set(edge.relationKind, relationDisplayName(edge.relationKind, edge.label));
    }
  }
  for (const statuses of relationStatusesByNode.value.values()) {
    for (const status of statuses) {
      if (!byId.has(status.relationKind)) {
        byId.set(status.relationKind, relationDisplayName(status.relationKind, status.label));
      }
    }
  }
  return [...byId.entries()].map(([id, label]) => ({ id, label }));
});

const hasAnyNeighborFilter = computed(
  () =>
    supportsDirectionFilter.value
    || (supportsTargetGroupFilter.value && availableTargetGroups.value.length > 0)
    || (supportsRelationKindsParam.value && availableRelationKinds.value.length > 0),
);

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

const drawnEdgeCount = computed(() => {
  if (activeMode.value === "overview") return visibleOverviewEdges.value.length;
  if (activeMode.value === "instance") return visibleInstanceEdges.value.length;
  return canvasEdges.value.length;
});

const reportedNodeCount = computed(() => {
  if (activeMode.value === "overview") return overviewData.value?.nodeCount ?? visibleOverviewNodes.value.length;
  return drawnNodeCount.value;
});

const reportedEdgeCount = computed(() => {
  if (activeMode.value === "overview") return overviewData.value?.edgeCount ?? visibleOverviewEdges.value.length;
  return canvasEdges.value.length;
});

const overviewComplete = computed<boolean>(() => overviewData.value?.complete ?? true);
const overviewFailures = computed<readonly string[]>(() => overviewData.value?.failures ?? []);

const activeSelectedNode = computed<PanelObjectValue | null>(() => {
  if (activeMode.value === "overview") {
    const node = selectedOverviewNode.value;
    return node ? { className: node.className, primaryKey: node.primaryKey } : null;
  }
  return props.selected ?? null;
});

const activeSelectedNodeId = computed<string | null>(() => {
  if (activeMode.value === "overview") return activeOverviewSelectedId.value;
  if (activeMode.value === "instance") {
    const chosen = props.selected ? encodeGraphNodeId(props.selected) : null;
    if (chosen && instanceNodes.value.has(chosen)) return chosen;
    return null;
  }
  return null;
});

const activeSelectedNodeLabel = computed<string>(() => {
  if (activeMode.value === "overview") return selectedOverviewNode.value?.label ?? "";
  if (activeMode.value === "instance" && activeSelectedNodeId.value) {
    return instanceNodes.value.get(activeSelectedNodeId.value)?.label ?? "";
  }
  return "";
});

const selectedNodeNeighborPage = computed<NeighborPageState | null>(() => {
  if (activeMode.value !== "instance" || !activeSelectedNodeId.value) return null;
  return neighborPagesByNode.value.get(activeSelectedNodeId.value) ?? null;
});

const currentNeighborProgress = computed<{ loaded: number; total: number | null; hasMore: boolean } | null>(() => {
  const page = selectedNodeNeighborPage.value ?? currentNeighborPage.value;
  if (!page) return null;
  return {
    loaded: page.loaded,
    total: page.total,
    hasMore: page.nextOffset !== null,
  };
});

/** Screen coordinates directly above the currently selected node for the floating `.node-actions` toolbar. */
const nodeActionPosition = computed<{ x: number; y: number } | null>(() => {
  if (activeMode.value === "type") return null;
  const view = currentViewport.value;
  const nodeId = activeSelectedNodeId.value;
  if (!view || !nodeId) return null;
  const pos = activeMode.value === "overview"
    ? overviewResolvedPositions.value.get(nodeId)
    : (savedPositions.value.get(nodeId) ?? instancePositions.value.get(nodeId));
  if (!pos) return null;
  const x = (pos.x - view.x) * view.zoom;
  const y = (pos.y - view.y) * view.zoom;
  const viewWidth = view.width * view.zoom;
  const viewHeight = view.height * view.zoom;
  if (x < 0 || x > viewWidth || y < 0 || y > viewHeight) return null;
  const nodeRadius = (G6_NODE_SIZE / 2 + 2.5) * view.zoom;
  return {
    x: Math.max(48, Math.min(viewWidth - 48, x)),
    y: Math.max(44, y - nodeRadius - 12),
  };
});

const canExpandSelectedNode = computed<boolean>(() => {
  if (!activeSelectedNodeId.value || rendering.value || expanding.value || versionChanged.value) return false;
  if (activeMode.value === "overview") return true;
  if (neighborFiltersDirty.value) return false;
  const page = selectedNodeNeighborPage.value;
  return !page || page.nextOffset !== null;
});

useMemberOutput("activeMode", () => activeMode.value);
useMemberOutput("graphStatus", () => graphStatus.value);
useMemberOutput("graphVersion", () => graphVersion.value);
useMemberOutput("sampleToken", () => sampleToken.value);
useMemberOutput("nodeCount", () => reportedNodeCount.value);
useMemberOutput("edgeCount", () => reportedEdgeCount.value);
useMemberOutput("drawnNodeCount", () => drawnNodeCount.value);
useMemberOutput("drawnEdgeCount", () => drawnEdgeCount.value);
useMemberOutput("overviewEdgesTruncated", () => overviewEdgesTruncated.value);
useMemberOutput("complete", () => overviewComplete.value);
useMemberOutput("failures", () => [...overviewFailures.value]);
useMemberOutput("groups", () =>
  overviewGroups.value.map((group) => ({
    id: group.id,
    label: group.label,
    totalCount: group.totalCount,
    sampleCount: group.sampleCount,
  })),
);
useMemberOutput("relationKinds", () => availableRelationKinds.value);
useMemberOutput("hasMoreNeighbors", () => hasMoreNeighbors.value);
useMemberOutput("neighborProgress", () => currentNeighborProgress.value);
useMemberOutput("drawingProgress", () =>
  rendering.value ? { drawn: drawing.value.drawn, total: drawing.value.total } : null,
);
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

const overviewOmittedRelations = computed<readonly PlatformGraphRelationStatus[]>(() =>
  activeMode.value === "overview"
    ? overviewRelations.value.filter((entry) => entry.status !== "ok")
    : [],
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

function selectOverviewGroup(groupId: string) {
  const next = activeSelectedGroup.value === groupId ? null : groupId;
  localSelectedGroup.value = next;
  selectedGroupParam.set(next);
  void panel.instance.output(member.key, "selectedGroup", next);
  emit("update:selectedGroup", next);
  emit("select-group", groupId);
}

// ---- Data loading & incremental 1-hop expansion ----
async function loadTypeMode(generation: number) {
  clearGenerationTimer();
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
    fitGraph();
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
  clearGenerationTimer();
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
  overviewRelations.value = [];
  try {
    const result = await graphSource.overview();
    if (generation !== loadGeneration) return;
    overviewData.value = result;

    if (result.status !== "READY") {
      overviewNodes.value = new Map();
      overviewEdges.value = [];
      overviewRelations.value = [];
      overviewBasePositions.value = new Map();
      loading.value = false;
      if (result.status === "GENERATING") {
        generationTimer = setTimeout(() => {
          if (generation === loadGeneration && activeMode.value === "overview") {
            void loadOverviewMode(generation);
          }
        }, GENERATION_POLL_INTERVAL_MS);
      }
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
      overviewRelations.value = result.relations ?? [];
      loading.value = false;
      await nextTick();
      fitGraph();
      return;
    }

    overviewEdges.value = [];
    overviewRelations.value = result.relations ?? [];
    loading.value = false;
    await nextTick();
    fitGraph();

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
        if (connections.relations !== undefined) {
          overviewRelations.value = connections.relations;
        }
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

  const activeRelationKinds = (() => {
    if (!supportsRelationKindsParam.value) return undefined;
    if (appliedNeighborRelationKind.value) return [appliedNeighborRelationKind.value];
    if (shownKinds.value && shownKinds.value.size > 0) return [...shownKinds.value];
    return undefined;
  })();

  const query: PlatformGraphNeighborsQuery = {
    node: refValue,
    ...(activeLayers ? { layers: activeLayers } : {}),
    ...(activeRelationKinds ? { relationKinds: activeRelationKinds } : {}),
    ...(supportsDirectionFilter.value ? { direction: appliedNeighborDirection.value } : {}),
    ...(supportsTargetGroupFilter.value && appliedNeighborTargetGroup.value ? { targetClass: appliedNeighborTargetGroup.value } : {}),
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

    if (isRoot || resetSubgraph || appliedFitAfterExpand.value) {
      await nextTick();
      fitGraph();
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
  clearGenerationTimer();
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
      fitGraph();
    }
  } catch (reason: unknown) {
    if (generation !== loadGeneration) return;
    recordFailure(reason);
    loading.value = false;
  }
}

function reload() {
  clearGenerationTimer();
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

function focusDirectNeighbors(node: PlatformGraphNode | PanelObjectValue) {
  const refValue: PanelObjectValue = { className: node.className, primaryKey: node.primaryKey };
  if (activeMode.value !== "instance") {
    exploreNode(refValue);
    return;
  }
  const generation = ++loadGeneration;
  expandingNodeIds.clear();
  writeSelectedNode(refValue);
  void expandInstanceNode(refValue, generation, { resetSubgraph: true, offset: 0 });
}

function loadMoreNeighbors(explicitNodeId?: string | null) {
  if (activeMode.value !== "instance" || expanding.value) return;
  const targetId = explicitNodeId ?? focusedNodeId.value ?? (props.selected ? encodeGraphNodeId(props.selected) : null) ?? rootNodeId.value;
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

function expandSelectedNodeAction() {
  if (!activeSelectedNode.value || !canExpandSelectedNode.value) return;
  if (activeMode.value === "overview") {
    exploreNode(activeSelectedNode.value);
    return;
  }
  const targetId = activeSelectedNodeId.value;
  if (!targetId) return;
  const page = selectedNodeNeighborPage.value;
  if (page && page.nextOffset !== null) {
    loadMoreNeighbors(targetId);
    return;
  }
  void expandInstanceNode(activeSelectedNode.value, loadGeneration);
}

function runFilteredNeighborReload() {
  if (activeMode.value !== "instance") return;
  const targetId = activeSelectedNodeId.value ?? focusedNodeId.value ?? rootNodeId.value;
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

function applyNeighborFilters() {
  appliedNeighborDirection.value = draftNeighborDirection.value;
  appliedNeighborTargetGroup.value = draftNeighborTargetGroup.value;
  appliedNeighborRelationKind.value = draftNeighborRelationKind.value;
  appliedFitAfterExpand.value = draftFitAfterExpand.value;
  const nextPublic: GraphNeighborFilter = {
    direction: appliedNeighborDirection.value,
    targetClass: appliedNeighborTargetGroup.value || null,
    relationKind: appliedNeighborRelationKind.value || null,
    fitAfterExpand: appliedFitAfterExpand.value,
  };
  neighborFilterParam.set(nextPublic as unknown as RuntimeJsonValue);
  emit("update:neighborFilter", nextPublic);
  neighborPopoverRef.value?.hide?.();
  neighborPopoverVisible.value = false;
  runFilteredNeighborReload();
}

watch(
  externalNeighborFilter,
  (next) => {
    const normalized = normalizeNeighborFilter(next);
    const queryChanged =
      normalized.direction !== appliedNeighborDirection.value
      || normalized.targetClass !== appliedNeighborTargetGroup.value
      || normalized.relationKind !== appliedNeighborRelationKind.value;
    const fitChanged = normalized.fitAfterExpand !== appliedFitAfterExpand.value;
    if (!queryChanged && !fitChanged) return;
    draftNeighborDirection.value = normalized.direction;
    appliedNeighborDirection.value = normalized.direction;
    draftNeighborTargetGroup.value = normalized.targetClass;
    appliedNeighborTargetGroup.value = normalized.targetClass;
    draftNeighborRelationKind.value = normalized.relationKind;
    appliedNeighborRelationKind.value = normalized.relationKind;
    draftFitAfterExpand.value = normalized.fitAfterExpand;
    appliedFitAfterExpand.value = normalized.fitAfterExpand;
    if (queryChanged) {
      runFilteredNeighborReload();
    }
  },
  { deep: true },
);

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
    if (effectiveExpandOn.value === "select" && instanceNodes.value.has(id) && !expandedNodes.value.has(id)) {
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
  if (effectiveExpandOn.value === "select" && !expandedNodes.value.has(pickedId)) {
    void expandInstanceNode(fullRef, loadGeneration);
  }
}

function handleActivate(element: GraphCanvasElement) {
  if (element.kind !== "node" || isOverviewGroupAnchorId(element.id)) return;
  if (activeMode.value === "overview") {
    const node = overviewNodes.value.get(element.id);
    if (node) exploreNode(node);
    return;
  }
  if (activeMode.value === "instance") {
    const node = instanceNodes.value.get(element.id);
    if (!node || expanding.value || rendering.value || versionChanged.value) return;
    const fullRef: PanelObjectValue = { className: node.className, primaryKey: node.primaryKey };
    focusedNodeId.value = element.id;
    writeSelectedNode(fullRef);
    const page = neighborPagesByNode.value.get(element.id);
    if (page && page.nextOffset !== null) {
      loadMoreNeighbors(element.id);
    } else if (!expandedNodes.value.has(element.id)) {
      void expandInstanceNode(fullRef, loadGeneration);
    }
  }
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

function handleProgress(drawn: number, total: number) {
  drawing.value = { drawn, total };
}

/** Re-fits the graph once its container settles at a new size (e.g. a side panel toggling or composer resizing). */
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
function handleResized() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitGraph();
  }, 200);
}
onBeforeUnmount(() => {
  clearTimeout(resizeTimer);
  clearGenerationTimer();
});

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
  const padding: number | [number, number, number, number] = activeMode.value === "overview" ? [64, 48, 48, 48] : 48;
  void canvas.value?.fit({ maxZoom: effectiveFitMode.value === "fit" ? 1 : 1.2, padding });
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
  fitGraph();
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
    <div
      v-if="activeMode === 'overview' && overviewData?.status === 'READY' && overviewOmittedRelations.length > 0 && !loading && !loadingConnections"
      class="sdk-ontology-graph-notice is-muted"
      role="status"
      data-graph-state="overview-relations-omitted"
    >
      {{ t("platform.graphOverviewRelationsOmitted", { count: overviewOmittedRelations.length, relations: formatRelationNames(overviewOmittedRelations) }) }}
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
    >
      <el-button type="primary" data-graph-action="refresh" @click="reload">
        {{ t("platform.graphRefresh") }}
      </el-button>
    </el-empty>
    <el-empty
      v-else-if="!loading && !forbidden && !errorMessage && drawnNodeCount === 0"
      :description="t('platform.graphEmpty')"
      :image-size="48"
    />
    <div v-else class="sdk-ontology-graph-frame" :class="{ 'is-bordered': effectiveFitMode === 'readable' }">
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
        :readable-labels="useReadableLabels"
        :max-height="maxHeight"
        @update:selected="handleSelect"
        @activate="handleActivate"
        @blank="handleBlank"
        @move="handleMove"
        @viewport="handleViewport"
        @progress="handleProgress"
        @resized="handleResized"
      />
      <div
        v-if="overviewGroupHeadings.length > 0"
        class="sdk-ontology-graph-headings"
        data-graph-group-headings
        role="group"
        :aria-label="t('platform.graphTargetGroup')"
      >
        <div
          v-for="heading in overviewGroupHeadings"
          :key="heading.id"
          class="sdk-ontology-graph-heading-wrap"
          :style="{
            left: `${heading.x}px`,
            top: `${heading.y}px`,
            maxWidth: `${heading.width}px`,
            '--group-color': categoryColor(heading.id),
          }"
        >
          <el-tooltip placement="top" :content="`${heading.label} (${heading.countText})`">
            <button
              type="button"
              class="sdk-ontology-graph-heading"
              :class="{ 'is-selected': activeSelectedGroup === heading.id }"
              :aria-pressed="activeSelectedGroup === heading.id"
              :data-graph-group-heading="heading.id"
              @click.stop="selectOverviewGroup(heading.id)"
            >
              <span class="sdk-ontology-graph-heading-label">{{ heading.label }}</span>
              <span class="sdk-ontology-graph-heading-count">{{ heading.countText }}</span>
            </button>
          </el-tooltip>
        </div>
      </div>

      <el-button
        v-if="canReturnToOverview"
        class="sdk-ontology-graph-back-btn"
        size="small"
        :disabled="loading || rendering || expanding"
        data-graph-action="back-to-overview"
        @click="backToOverview"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" style="margin-inline-end: 4px">
          <path d="M10 3.5 5.5 8 10 12.5" />
        </svg>
        {{ t("platform.graphBackToOverview") }}
      </el-button>

      <div
        v-if="activeMode !== 'type' && activeSelectedNode && nodeActionPosition"
        class="sdk-ontology-graph-node-actions"
        :style="{ left: `${nodeActionPosition.x}px`, top: `${nodeActionPosition.y}px` }"
        role="toolbar"
        :aria-label="activeSelectedNodeLabel"
        data-graph-node-actions
      >
        <button
          v-if="activeMode === 'instance' && selectedNodeNeighborPage && selectedNodeNeighborPage.nextOffset !== null"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="load-more-neighbors"
          :disabled="!canExpandSelectedNode"
          :title="selectedNodeNeighborPage.total != null ? `${t('platform.graphLoadMoreNeighbors')} (${t('platform.graphNeighborsProgress', { loaded: selectedNodeNeighborPage.loaded, total: selectedNodeNeighborPage.total })})` : t('platform.graphLoadMoreNeighbors')"
          :aria-label="t('platform.graphLoadMoreNeighbors')"
          @click.stop="expandSelectedNodeAction"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="4" cy="4" r="1.5" />
            <circle cx="12" cy="4" r="1.5" />
            <circle cx="8" cy="12" r="1.5" />
            <path d="M4 5.5v1a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-1M8 8.5v2" />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="explore-neighbors"
          :disabled="!canExpandSelectedNode"
          :title="t('platform.graphExploreNeighbors')"
          :aria-label="t('platform.graphExploreNeighbors')"
          @click.stop="expandSelectedNodeAction"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="4" cy="4" r="1.5" />
            <circle cx="12" cy="4" r="1.5" />
            <circle cx="8" cy="12" r="1.5" />
            <path d="M4 5.5v1a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-1M8 8.5v2" />
          </svg>
        </button>
        <button
          v-if="activeMode === 'instance'"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="direct-neighbors"
          :disabled="expanding || rendering || versionChanged"
          :title="t('platform.graphDirectNeighbors')"
          :aria-label="t('platform.graphDirectNeighbors')"
          @click.stop="focusDirectNeighbors(activeSelectedNode)"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
            <path d="M6.8 4.2 4.2 6.8M9.2 4.2l2.6 2.6M4.2 9.2l2.6 2.6M11.8 9.2l-2.6 2.6" />
          </svg>
        </button>
      </div>

      <p v-if="partial" class="sdk-ontology-graph-hint" :class="{ quiet: moved }" role="status" data-graph-hint>
        {{ t("platform.graphLargerThanCanvas") }}
      </p>

      <div v-if="showToolbar" class="sdk-ontology-graph-tools" role="toolbar" :aria-label="accessibleLabel" data-graph-toolbar>
        <button
          v-if="showZoomControls"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="zoom-in"
          :title="t('platform.graphZoomIn')"
          :aria-label="t('platform.graphZoomIn')"
          @click="zoomIn"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
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
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
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
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
          </svg>
        </button>

        <span class="sdk-ontology-graph-tool-sep" aria-hidden="true" />

        <el-popover
          v-if="(showAggregateToggle && activeMode === 'overview') || showEdgeLabelToggle"
          trigger="click"
          :width="260"
          placement="top-start"
          :teleported="false"
          @show="displaySettingsVisible = true"
          @hide="displaySettingsVisible = false"
        >
          <template #reference>
            <button
              type="button"
              class="sdk-ontology-graph-tool"
              :aria-expanded="displaySettingsVisible"
              data-graph-action="display-settings"
              :title="t('platform.graphDisplaySettings')"
              :aria-label="t('platform.graphDisplaySettings')"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M2.5 5h4.5M10.5 5h3M2.5 11h3M9 11h4.5" />
                <circle cx="8.75" cy="5" r="1.75" />
                <circle cx="7.25" cy="11" r="1.75" />
              </svg>
            </button>
          </template>
          <div class="sdk-ontology-graph-popover" data-graph-display-settings>
            <strong>{{ t("platform.graphDisplaySettings") }}</strong>
            <label v-if="showEdgeLabelToggle" class="sdk-ontology-graph-setting-row">
              <span>{{ t("platform.graphShowEdgeLabels") }}</span>
              <el-switch
                :model-value="edgeLabelsEnabled"
                :aria-label="t('platform.graphShowEdgeLabels')"
                :disabled="loading || rendering || expanding"
                size="small"
                data-graph-action="toggle-edge-labels"
                @update:model-value="setEdgeLabels"
              />
            </label>
            <label
              v-if="showAggregateToggle && activeMode === 'overview'"
              class="sdk-ontology-graph-setting-row"
              :title="t('platform.graphAggregateHint')"
            >
              <span>{{ t("platform.graphAggregateEdges") }}</span>
              <el-switch
                :model-value="aggregateEdgesEnabled"
                :aria-label="t('platform.graphAggregateEdges')"
                :disabled="loading || rendering || expanding"
                size="small"
                data-graph-action="toggle-aggregate"
                @update:model-value="setAggregateEdges"
              />
            </label>
            <p v-if="showAggregateToggle && activeMode === 'overview'" class="sdk-ontology-graph-popover-hint">
              {{ t("platform.graphAggregateHint") }}
            </p>
          </div>
        </el-popover>

        <el-popover
          v-if="showNeighborControls && activeMode === 'instance' && hasAnyNeighborFilter"
          ref="neighborPopoverRef"
          trigger="click"
          :width="290"
          placement="top-start"
          :teleported="false"
          :persistent="false"
          @before-enter="neighborPopoverVisible = true"
          @after-leave="neighborPopoverVisible = false"
        >
          <template #reference>
            <button
              type="button"
              class="sdk-ontology-graph-tool"
              :class="{ 'is-active': neighborFiltersDirty || Boolean(appliedNeighborTargetGroup || appliedNeighborRelationKind || appliedNeighborDirection !== 'both') }"
              :aria-expanded="neighborPopoverVisible"
              data-graph-action="neighbor-filters"
              :title="t('platform.graphNeighborFilters')"
              :aria-label="t('platform.graphNeighborFilters')"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M2.5 3.5h11l-4.2 4.8v4l-2.6 1.2V8.3L2.5 3.5Z" />
              </svg>
            </button>
          </template>
          <div class="sdk-ontology-graph-popover sdk-ontology-graph-neighbor-popover" data-graph-neighbor-controls>
            <strong>{{ t("platform.graphNeighborFilters") }}</strong>
            <div v-if="supportsDirectionFilter" class="sdk-ontology-graph-filter-field">
              <span class="sdk-ontology-graph-filter-label">{{ t("platform.graphDirection") }}</span>
              <el-select
                v-model="draftNeighborDirection"
                size="small"
                :teleported="false"
                data-graph-filter="direction"
              >
                <el-option value="both" :label="t('platform.graphDirectionBoth')" />
                <el-option value="outgoing" :label="t('platform.graphDirectionOutgoing')" />
                <el-option value="incoming" :label="t('platform.graphDirectionIncoming')" />
              </el-select>
            </div>
            <div v-if="supportsTargetGroupFilter && availableTargetGroups.length > 0" class="sdk-ontology-graph-filter-field">
              <span class="sdk-ontology-graph-filter-label">{{ t("platform.graphTargetGroup") }}</span>
              <el-select
                v-model="draftNeighborTargetGroup"
                size="small"
                clearable
                :placeholder="t('platform.graphAllGroups')"
                :teleported="false"
                data-graph-filter="target-group"
              >
                <el-option value="" :label="t('platform.graphAllGroups')" />
                <el-option v-for="group in availableTargetGroups" :key="group.id" :value="group.id" :label="group.label" />
              </el-select>
            </div>
            <div v-if="supportsRelationKindsParam && availableRelationKinds.length > 0" class="sdk-ontology-graph-filter-field">
              <span class="sdk-ontology-graph-filter-label">{{ t("platform.graphRelationKind") }}</span>
              <el-select
                v-model="draftNeighborRelationKind"
                size="small"
                clearable
                :placeholder="t('platform.graphAllRelations')"
                :teleported="false"
                data-graph-filter="relation-kind"
              >
                <el-option value="" :label="t('platform.graphAllRelations')" />
                <el-option v-for="kind in availableRelationKinds" :key="kind.id" :value="kind.id" :label="kind.label" />
              </el-select>
            </div>
            <el-checkbox v-model="draftFitAfterExpand" size="small" data-graph-filter="fit-after-expand">
              {{ t("platform.graphFitAfterExpand") }}
            </el-checkbox>
            <el-button
              type="primary"
              size="small"
              :disabled="expanding || rendering"
              data-graph-action="apply-filters"
              @click="applyNeighborFilters"
            >
              {{ t("platform.graphApplyFilters") }}
            </el-button>
          </div>
        </el-popover>

        <button
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="relayout"
          :disabled="loading || rendering || expanding"
          :title="t('platform.graphRelayout')"
          :aria-label="t('platform.graphRelayout')"
          @click="relayout"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.55M13.5 2.5v2.75h-2.75" />
          </svg>
        </button>

        <span class="sdk-ontology-graph-tool-sep" aria-hidden="true" />

        <button
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="download"
          :title="t('common.download')"
          :aria-label="t('common.download')"
          @click="downloadPng"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
          </svg>
        </button>
        <button
          v-if="showRefreshControl"
          type="button"
          class="sdk-ontology-graph-tool"
          data-graph-action="refresh"
          :disabled="expanding"
          :title="t('platform.graphRefresh')"
          :aria-label="t('platform.graphRefresh')"
          @click="reload"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.75L13.5 5.5M13.5 2.5v3h-3M13.5 8a5.5 5.5 0 0 1-9.5 3.75L2.5 10.5M2.5 13.5v-3h3" />
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
          :drawn-node-count="drawnNodeCount"
          :drawn-edge-count="drawnEdgeCount"
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
          :relation-kinds="availableRelationKinds"
          :selected-group="activeSelectedGroup"
          :selected-node="activeSelectedNode"
          :node-count="reportedNodeCount"
          :edge-count="reportedEdgeCount"
          :drawn-node-count="drawnNodeCount"
          :drawn-edge-count="drawnEdgeCount"
          :overview-edges-truncated="overviewEdgesTruncated"
          :complete="overviewComplete"
          :failures="overviewFailures"
          :has-more-neighbors="hasMoreNeighbors"
          :neighbor-progress="currentNeighborProgress"
          :drawing-progress="rendering ? drawing : null"
          :version-changed="versionChanged"
          :refresh="reload"
          :back-to-overview="backToOverview"
          :explore-node="exploreNode"
          :focus-direct-neighbors="focusDirectNeighbors"
          :select-group="selectOverviewGroup"
        />
      </div>

      <span v-if="rendering" class="sdk-ontology-graph-busy" role="status" data-graph-state="rendering">
        {{ t("platform.graphRenderProgress", { drawn: drawing.drawn, total: drawing.total }) }}
      </span>
      <span v-else-if="loadingConnections" class="sdk-ontology-graph-busy" role="status" data-graph-state="connections-loading">
        {{ t("platform.graphConnectionsLoading") }}
      </span>
      <span v-else-if="expanding" class="sdk-ontology-graph-busy" role="status">
        {{ t("platform.graphExpanding") }}
      </span>
      <div
        v-else-if="showHint && !partial"
        class="sdk-ontology-graph-interaction-hint"
        data-graph-interaction-hint
      >
        <span class="sdk-ontology-graph-interaction-dot" aria-hidden="true" />
        {{ t("platform.graphInteractionHint") }}
      </div>
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
  border: 0;
  border-radius: 0;
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 20px 20px;
}

.sdk-ontology-graph-frame.is-bordered {
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
}

.sdk-ontology-graph-canvas {
  width: 100%;
  height: 100%;
  background: transparent;
}

.sdk-ontology-graph-headings {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
}

.sdk-ontology-graph-heading-wrap {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}

.sdk-ontology-graph-heading {
  pointer-events: auto;
  display: inline-flex;
  box-sizing: border-box;
  align-items: center;
  max-width: 100%;
  height: 26px;
  padding: 4px 9px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--group-color, var(--el-color-primary)) 8%, var(--el-bg-color));
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.sdk-ontology-graph-heading:hover {
  background: color-mix(in srgb, var(--group-color, var(--el-color-primary)) 26%, var(--el-bg-color));
}

.sdk-ontology-graph-heading.is-selected {
  background: color-mix(in srgb, var(--group-color, var(--el-color-primary)) 32%, var(--el-bg-color));
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}

.sdk-ontology-graph-heading:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.sdk-ontology-graph-heading-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--el-text-color-primary);
}

.sdk-ontology-graph-heading-count {
  flex: 0 0 auto;
  margin-inline-start: 6px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}

.sdk-ontology-graph-back-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 3;
  margin: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.sdk-ontology-graph-node-actions {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay, 0 4px 16px rgba(0, 0, 0, 0.12));
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
  bottom: 16px;
  left: 16px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  max-width: calc(100% - 32px);
  padding: var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay, 0 4px 16px rgba(0, 0, 0, 0.12));
}

.sdk-ontology-graph-tool-sep {
  flex: 0 0 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--el-border-color-light);
}

.sdk-ontology-graph-tool {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.sdk-ontology-graph-tool:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.sdk-ontology-graph-tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sdk-ontology-graph-tool[aria-expanded="true"],
.sdk-ontology-graph-tool[aria-pressed="true"],
.sdk-ontology-graph-tool.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.sdk-ontology-graph-popover {
  display: grid;
  gap: var(--spacing-sm);
}

.sdk-ontology-graph-popover > strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}

.sdk-ontology-graph-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  min-height: 28px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}

.sdk-ontology-graph-popover-hint {
  margin: 0;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.sdk-ontology-graph-neighbor-popover :deep(.el-select) {
  width: 100%;
}

.sdk-ontology-graph-filter-field {
  display: grid;
  gap: var(--spacing-xs);
}

.sdk-ontology-graph-filter-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.sdk-ontology-graph-hint {
  position: absolute;
  inset-block-end: 64px;
  inset-inline-start: 16px;
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

.sdk-ontology-graph-interaction-hint {
  position: absolute;
  right: 18px;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  pointer-events: none;
}

.sdk-ontology-graph-interaction-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--el-color-success);
}

.sdk-ontology-graph-busy {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 2;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border-radius: var(--radius-xs);
  background: var(--el-bg-color);
  border: 1px solid var(--ui-divider);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
</style>
