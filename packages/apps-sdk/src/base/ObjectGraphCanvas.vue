<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { PageHighlight } from "@ontomato/contracts/page-context";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  G6GraphCanvas,
  layoutByForce,
  layoutByRelations,
  type GraphCanvasEdge,
  type GraphCanvasElement,
  type GraphCanvasNodeViewportBox,
  type GraphCanvasPoint,
  type GraphCanvasStyleOverrides,
  type GraphCanvasTone,
  type GraphCanvasViewport,
  type LayoutRoom,
} from "@ontomato/foundation-ui/graph/g6";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberOutput, useMemberParam } from "../panel/member";
import type { PanelFieldValue } from "../panel/state";
import { savePanelFile } from "../panel/save-file";
import { useGraphRecords, type EdgeEndsConfig } from "./object-graph-data";
import {
  PENDING_GRAPH_EDGE_ID,
  resolveGraphExportFilename,
  type PendingGraphEdge,
} from "./object-graph-export";
import { findDirectedGraphPath } from "./object-graph-path";
import type { ObjectListRef } from "./object-list-types";

/**
 * The graph as a page draws it (the ontology graph, visual modeling): the owner's node and edge records on the platform's
 * G6 canvas. A chosen node or edge is the panel's state of the type its datum reads (`selectedNode`, `selectedEdge`);
 * a click on empty canvas lets both go. Where the reader puts the nodes is the reader's own (`positions`, a personal
 * state), drawn again from there; a node never placed is placed by its relations, the most connected first, and nothing
 * is written for it. What the panel highlights (`pathFrom`/`pathTo` or `highlightedNodes`/`highlightedEdges`) stands
 * out and the rest fades, without being chosen; when neither is active, choosing a node or edge keeps its direct
 * neighbourhood crisp while dimming unrelated elements without showing a highlight bar. The view opens on the chosen
 * node, else the most connected, never smaller than names can be read at: a graph too large for that is panned. On an
 * editable graph a line drawn with Shift from one node to another hands the panel its two ends (`connectFrom`,
 * `connectTo`) for the owner's new edge — the canvas draws no edge of its own and writes nothing to the owner.
 */
const props = withDefaults(defineProps<{
  edgeEnds?: EdgeEndsConfig; editable?: boolean; categories?: readonly string[]; nodeCategory?: string;
  nodeSize?: number; labelSize?: number; layout?: "relations" | "force";
  highlightBanner?: boolean; showFocusButton?: boolean; hint?: string;
  /** Single-page presentation option: background CSS colour composited behind exported PNG layers. */
  exportBackground?: string;
  /** Single-page presentation option: exported PNG filename template (`{date}` expands to local `YYYY-MM-DD`). */
  exportFilename?: string;
  /** Internal style overrides supplied by dedicated platform graph components (never exposed on `ObjectGraph`). */
  styleOverrides?: GraphCanvasStyleOverrides;
  /** Internal toolbar layout supplied by dedicated platform graph components (never exposed on `ObjectGraph`). */
  toolbarPlacement?: "floating" | "top-four";
  /** Internal hover connection-port overlay enabled only by `VisualModelingGraph`. */
  connectPorts?: boolean;
  /** Internal uncommitted visual pending edge preview enabled only by `VisualModelingGraph`. */
  showPendingEdge?: boolean;
  /** Optional explicit visual pending edge preview supplied by `VisualModelingGraph`. */
  pendingEdge?: PendingGraphEdge | null;
}>(), {
  editable: undefined,
  highlightBanner: undefined,
  showFocusButton: undefined,
  exportBackground: undefined,
  exportFilename: undefined,
  styleOverrides: undefined,
  toolbarPlacement: "floating",
  connectPorts: false,
  showPendingEdge: false,
  pendingEdge: null,
});

const emit = defineEmits<{
  /** Emitted when the reader explicitly activates a node or edge by double-clicking it. */
  choose: [value: ObjectListRef];
}>();

const previewMarkerId = `sdk-graph-connect-arrow-${useId().replace(/:/g, "")}`;

const { t } = useI18n();
const panel = usePanelContext();
const { instance } = panel;
const member = useMember();
const nodeCategory = props.nodeCategory ?? member.projection.config.nodeCategory;
if (nodeCategory !== undefined && typeof nodeCategory !== "string") throw new Error(`The projection in member '${member.key}' names nodeCategory with no JSON Pointer`);
const resolved = useGraphRecords(props.edgeEnds, nodeCategory);
/** How large the nodes and their names are drawn, in screen pixels; the canvas's own sizes when the projection sets none. */
function sizeOf(name: "nodeSize" | "labelSize"): number | undefined {
  const size = props[name] ?? member.projection.config[name];
  if (size !== undefined && (typeof size !== "number" || !(size > 0)))
    throw new Error(`The projection in member '${member.key}' names a ${name} that is not a positive number`);
  return size;
}
const look = { nodeSize: sizeOf("nodeSize"), labelSize: sizeOf("labelSize") };
/** The categories in a fixed order: the n-th takes the platform palette's n-th colour. */
const categories = computed(() => {
  const listed = props.categories ?? member.projection.config.categories ?? [];
  if (!Array.isArray(listed) || !listed.every((item) => typeof item === "string"))
    throw new Error(`The projection in member '${member.key}' names categories that are not a list of names`);
  return listed as string[];
});
const editable = computed(() => props.editable ?? member.projection.config.editable === true);
const layoutMode = computed<"relations" | "force">(() => {
  const mode = props.layout ?? member.projection.config.layout;
  return mode === "force" ? "force" : "relations";
});
const showHighlightBanner = computed(() => {
  const value = props.highlightBanner ?? member.projection.config.highlightBanner;
  return value !== false;
});
const showFocusButton = computed(() => {
  const value = props.showFocusButton ?? member.projection.config.showFocusButton;
  return value !== false;
});
const canvasHint = computed(() => {
  const value = props.hint ?? member.projection.config.hint;
  return typeof value === "string" && value.trim() ? value.trim() : "";
});
const exportBackground = computed(() => {
  const value = props.exportBackground ?? member.projection.config.exportBackground;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
});
const exportFilename = computed(() => {
  const value = props.exportFilename ?? member.projection.config.exportFilename;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
});

/** The type each datum reads: a chosen node or edge is an object of that type. */
const typeOf = (datum: "nodes" | "edges") => {
  const source = member.projection.data[datum]?.source;
  if (!source || !("type" in source)) throw new Error(`The projection in member '${member.key}' reads no type for '${datum}'`);
  return source.type.id;
};
const nodeType = typeOf("nodes");
const edgeType = typeOf("edges");

const selectedNode = useMemberParam("selectedNode");
const selectedEdge = useMemberParam("selectedEdge");
const connectFrom = useMemberParam("connectFrom");
const connectTo = useMemberParam("connectTo");
const positions = useMemberParam("positions");
const highlightedNodes = useMemberParam("highlightedNodes");
const highlightedEdges = useMemberParam("highlightedEdges");
const pathFrom = useMemberParam("pathFrom");
const pathTo = useMemberParam("pathTo");
const zoom = useMemberParam("zoom");

type Positions = Record<string, GraphCanvasPoint>;
const saved = computed<Positions>(() => {
  const value = positions.value.value;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as unknown as Positions : {};
});
/** The clear space kept around the graph when it is fitted to the canvas. */
const FIT_PADDING = 56;
/**
 * The room the graph is laid out for: the canvas, less the space a fit keeps clear. Measured once the canvas's box is
 * there and again whenever the canvas takes a new size, so the graph's parts are laid out to the room it is shown in.
 */
const element = ref<HTMLElement | null>(null);
const room = ref<LayoutRoom | null>(null);
const measure = (width: number, height: number) => {
  room.value = { width: Math.max(0, width - 2 * FIT_PADDING), height: Math.max(0, height - 2 * FIT_PADDING) };
};
onMounted(() => {
  const { width, height } = element.value!.getBoundingClientRect();
  measure(width, height);
});
const computedLayout = computed(() =>
  layoutMode.value === "force"
    ? layoutByForce(resolved.value.nodes, resolved.value.links, room.value!, look)
    : layoutByRelations(resolved.value.nodes, resolved.value.links, room.value!, look),
);

/** The chosen object's key, when the state holds one of this type. */
const keyOf = (value: RuntimeJsonValue | null, type: string) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && value.className === type ? [String(value.primaryKey)] : [];
/** A node key from either an object reference of `nodeType` or a plain non-empty node identifier. */
const endpointKeyOf = (value: RuntimeJsonValue | null, type: string): string | null => {
  if (typeof value === "string" && value.length) return value;
  return keyOf(value, type)[0] ?? null;
};
/** The keys of the objects of this type a list state holds. */
const keysOf = (value: RuntimeJsonValue | null, type: string) => new Set(Array.isArray(value) ? value.flatMap((item) => keyOf(item, type)) : []);
const selectedNodes = computed(() => keyOf(selectedNode.value.value, nodeType));
const selectedEdges = computed(() => keyOf(selectedEdge.value.value, edgeType));

// Keep owner labels registered on the panel instance so pageContext names graph selections and endpoints clearly.
watch(
  () => resolved.value.nodes,
  (nodes) => {
    if (nodes.length) instance.nameObjects(nodeType, nodes.map((node) => ({ primaryKey: node.id, label: node.label })));
  },
  { immediate: true },
);
watch(
  () => resolved.value.links,
  (links) => {
    if (links.length) instance.nameObjects(edgeType, links.map((edge) => ({ primaryKey: edge.id, label: edge.label || edge.id })));
  },
  { immediate: true },
);

const searchHighlighted = computed(() => ({
  nodes: keysOf(highlightedNodes.value.value, nodeType),
  edges: keysOf(highlightedEdges.value.value, edgeType),
}));
const pathResult = computed(() =>
  resolved.value.loading || resolved.value.error
    ? { status: "idle" as const }
    : findDirectedGraphPath(
        resolved.value.nodes,
        resolved.value.links,
        endpointKeyOf(pathFrom.value.value, nodeType),
        endpointKeyOf(pathTo.value.value, nodeType),
      ),
);
const pathNodeSet = computed(() => (pathResult.value.status === "idle" ? new Set<string>() : new Set(pathResult.value.nodeIds)));
const pathEdgeSet = computed(() => (pathResult.value.status === "idle" ? new Set<string>() : new Set(pathResult.value.edgeIds)));
/** Distinguishes an active directed path query from search highlights (and from an unhighlighted canvas). */
const highlightKind = computed<"path" | "search" | "none">(() => {
  if (pathResult.value.status !== "idle") return "path";
  if (searchHighlighted.value.nodes.size || searchHighlighted.value.edges.size) return "search";
  return "none";
});
/** Direct neighbourhood of the chosen node or edge on a read-only graph; editable canvases keep all nodes crisp for connecting. */
const selectionFocus = computed(() => {
  const chosenNodes = new Set<string>();
  const chosenEdges = new Set<string>();
  const neighborNodes = new Set<string>();
  const neighborEdges = new Set<string>();
  if (editable.value) return { active: false, chosenNodes, chosenEdges, neighborNodes, neighborEdges };
  const existingNodes = new Set(resolved.value.nodes.map((node) => node.id));
  for (const id of selectedNodes.value) {
    if (existingNodes.has(id)) chosenNodes.add(id);
  }
  if (chosenNodes.size) {
    for (const link of resolved.value.links) {
      if (chosenNodes.has(link.source) || chosenNodes.has(link.target)) {
        neighborEdges.add(link.id);
        if (!chosenNodes.has(link.source)) neighborNodes.add(link.source);
        if (!chosenNodes.has(link.target)) neighborNodes.add(link.target);
      }
    }
  }
  if (selectedEdges.value.length) {
    const selectedEdgeSet = new Set(selectedEdges.value);
    for (const link of resolved.value.links) {
      if (selectedEdgeSet.has(link.id)) {
        chosenEdges.add(link.id);
        if (!chosenNodes.has(link.source)) neighborNodes.add(link.source);
        if (!chosenNodes.has(link.target)) neighborNodes.add(link.target);
      }
    }
  }
  return {
    active: chosenNodes.size > 0 || chosenEdges.size > 0,
    chosenNodes,
    chosenEdges,
    neighborNodes,
    neighborEdges,
  };
});
/**
 * Path queries use the distinct `path` tone when a path is found (and leave nodes plain when none is found so no
 * misleading highlight appears); search hits use `accent`, dimming everything else; when neither is active on a
 * read-only graph, choosing a node or edge highlights its direct neighbourhood with the warm `neighbor` tone while
 * dimming unrelated elements without raising a banner.
 */
const nodeToneOf = (id: string): GraphCanvasTone | undefined => {
  if (highlightKind.value === "path") {
    if (pathResult.value.status === "found" || pathResult.value.status === "same-node") {
      return pathNodeSet.value.has(id) ? "path" : "muted";
    }
    return undefined;
  }
  if (highlightKind.value === "search") return searchHighlighted.value.nodes.has(id) ? "accent" : "muted";
  if (selectionFocus.value.active) {
    if (selectionFocus.value.chosenNodes.has(id)) return undefined;
    if (selectionFocus.value.neighborNodes.has(id)) return "neighbor";
    return "muted";
  }
  return undefined;
};
const edgeToneOf = (id: string): GraphCanvasTone | undefined => {
  if (highlightKind.value === "path") {
    if (pathResult.value.status === "found" || pathResult.value.status === "same-node") {
      return pathEdgeSet.value.has(id) ? "path" : "muted";
    }
    return undefined;
  }
  if (highlightKind.value === "search") return searchHighlighted.value.edges.has(id) ? "accent" : "muted";
  if (selectionFocus.value.active) {
    if (selectionFocus.value.chosenEdges.has(id)) return undefined;
    if (selectionFocus.value.neighborEdges.has(id)) return "neighbor";
    return "muted";
  }
  return undefined;
};

const pathTrail = computed(() =>
  pathResult.value.status === "found" ? pathResult.value.nodes.map((node) => node.label).join(" → ") : "",
);
const pathHopsLabel = computed(() => {
  if (pathResult.value.status !== "found") return "";
  return t("platform.graphPathHops", { n: pathResult.value.hops }, pathResult.value.hops);
});
const pathBannerText = computed(() => {
  const result = pathResult.value;
  if (result.status === "idle") return "";
  if (result.status === "same-node") return t("platform.graphPathSameNode", { node: result.from.label });
  if (result.status === "found") {
    return t("platform.graphPathSummary", {
      from: result.from.label,
      to: result.to.label,
      hops: pathHopsLabel.value,
      path: pathTrail.value,
    });
  }
  return t("platform.graphPathNotFoundVisible", { from: result.from.label, to: result.to.label });
});

const searchHighlightItems = computed(() => {
  const nodeLabels = new Map(resolved.value.nodes.map((node) => [node.id, node.label]));
  const edgeLabels = new Map(resolved.value.links.map((edge) => [edge.id, edge.label || edge.id]));
  return [
    ...[...searchHighlighted.value.nodes].map((id) => ({ kind: nodeType, id, label: nodeLabels.get(id) ?? id })),
    ...[...searchHighlighted.value.edges].map((id) => ({ kind: edgeType, id, label: edgeLabels.get(id) ?? id })),
  ];
});
const searchPreviewText = computed(() => {
  const items = searchHighlightItems.value;
  if (!items.length) return "";
  const preview = items.slice(0, 5).map((item) => item.label).join(", ");
  return items.length > 5 ? `${preview}…` : preview;
});
const searchBannerSummary = computed(() => {
  const items = searchHighlightItems.value;
  if (!items.length) return "";
  return t("platform.graphSearchMatchesSummary", {
    count: items.length,
    items: searchPreviewText.value,
  });
});
const searchBannerTitle = computed(() => {
  const items = searchHighlightItems.value;
  if (!items.length) return "";
  return t("platform.graphSearchMatchesSummary", {
    count: items.length,
    items: items.map((item) => item.label).join(", "),
  });
});
const showGraph = computed(() => !resolved.value.loading && !resolved.value.error && resolved.value.nodes.length > 0 && room.value !== null);

const reportedHighlight = computed<PageHighlight | null>(() => {
  if (resolved.value.loading || resolved.value.error) return null;
  if (highlightKind.value === "path" && pathResult.value.status !== "idle") {
    const result = pathResult.value;
    const partialNotice = resolved.value.edgesNotice;
    return {
      kind: "path",
      summary: pathBannerText.value,
      from: { kind: nodeType, id: result.from.id, label: result.from.label },
      to: { kind: nodeType, id: result.to.id, label: result.to.label },
      found: result.status === "found" || result.status === "same-node",
      ...(result.hops !== null ? { hops: result.hops } : {}),
      nodes: result.nodes.map((node) => ({ kind: nodeType, id: node.id, label: node.label })),
      edges: result.edges.map((edge) => ({ kind: edgeType, id: edge.id, label: edge.label })),
      ...(partialNotice ? { partialEdges: true, partialNotice } : {}),
    };
  }
  if (highlightKind.value === "search" && searchHighlightItems.value.length) {
    return {
      kind: "search",
      summary: searchBannerSummary.value,
      items: searchHighlightItems.value,
      ...(resolved.value.edgesNotice ? { partialEdges: true } : {}),
    };
  }
  return null;
});
const stopReportingHighlight = instance.reportHighlight(member.key, reportedHighlight);
onBeforeUnmount(stopReportingHighlight);

useMemberOutput("status", () =>
  resolved.value.loading
    ? "loading"
    : resolved.value.error
      ? "error"
      : resolved.value.nodes.length > 0
        ? "ready"
        : "empty",
);
useMemberOutput("error", () => resolved.value.error ?? null);
useMemberOutput("pathStatus", () => pathResult.value.status);
useMemberOutput("pathMessage", () => pathBannerText.value || null);
useMemberOutput("pathHops", () =>
  pathResult.value.status === "found" || pathResult.value.status === "same-node"
    ? pathResult.value.hops
    : null,
);
useMemberOutput("nodeCount", () => resolved.value.nodes.length);
useMemberOutput("edgeCount", () => resolved.value.links.length);

/** Every node where the reader put it, else where its relations place it. */
const drawnNodes = computed(() => resolved.value.nodes.map((node) => ({
  ...node, ...computedLayout.value.positions.get(node.id), ...saved.value[node.id], tone: nodeToneOf(node.id),
})));
/** Purely visual uncommitted edge shown while the reader completes a new-relation dialog (never written to the owner). */
const activePendingEdge = computed<PendingGraphEdge | null>(() => {
  if (!props.showPendingEdge) return null;
  const existing = new Set(resolved.value.nodes.map((node) => node.id));
  if (props.pendingEdge && existing.has(props.pendingEdge.source) && existing.has(props.pendingEdge.target)) {
    return props.pendingEdge;
  }
  const source = endpointKeyOf(connectFrom.value.value, nodeType);
  const target = endpointKeyOf(connectTo.value.value, nodeType);
  if (source && target && existing.has(source) && existing.has(target)) {
    return { source, target };
  }
  return null;
});
const drawnEdges = computed<GraphCanvasEdge[]>(() => {
  const base: GraphCanvasEdge[] = resolved.value.links.map((edge) => ({ ...edge, tone: edgeToneOf(edge.id) }));
  const pending = activePendingEdge.value;
  if (pending) {
    base.push({
      id: PENDING_GRAPH_EDGE_ID,
      source: pending.source,
      target: pending.target,
      label: pending.label ?? "",
      line: "dashed",
      tone: "path",
    });
  }
  return base;
});

const graphPlacement = panel.manifest.members[member.key];
function boundStateField(paramName: string): string | null {
  const input = graphPlacement?.inputs?.[paramName];
  if (input && "state" in input && !("field" in input)) return input.state;
  const output = graphPlacement?.outputs?.[paramName];
  return output ? output.state : null;
}

/**
 * Applies node/edge selection changes atomically through `PanelInstance` so switching away from a dirty form is
 * guarded once before panel state mutates and `choose` only fires if the switch is accepted.
 */
function commitSelection(
  changes: { readonly node?: RuntimeJsonValue | null; readonly edge?: RuntimeJsonValue | null },
  onApplied?: () => void,
): void {
  const statePatch: Record<string, PanelFieldValue> = {};
  const localUpdates: (() => void)[] = [];
  if ("node" in changes) {
    const field = boundStateField("selectedNode");
    if (field) statePatch[field] = (changes.node ?? null) as PanelFieldValue;
    else localUpdates.push(() => { selectedNode.set(changes.node ?? null); });
  }
  if ("edge" in changes) {
    const field = boundStateField("selectedEdge");
    if (field) statePatch[field] = (changes.edge ?? null) as PanelFieldValue;
    else localUpdates.push(() => { selectedEdge.set(changes.edge ?? null); });
  }
  const finish = () => {
    for (const update of localUpdates) update();
    onApplied?.();
  };
  if (!Object.keys(statePatch).length) {
    finish();
    return;
  }
  const applied = panel.instance.state.setState(statePatch);
  if (applied === false) return;
  if (applied && typeof applied !== "boolean") void applied.then((ok) => { if (ok) finish(); });
  else finish();
}

function chooseNode(ids: readonly string[]) {
  const nextId = ids[0] ?? null;
  if (nextId === null) {
    if (selectedNode.value.value === null) return;
    commitSelection({ node: null });
    return;
  }
  if (selectedNodes.value.length === 1 && selectedNodes.value[0] === nextId && selectedEdge.value.value === null) return;
  commitSelection({
    ...(selectedEdge.value.value !== null ? { edge: null } : {}),
    node: { className: nodeType, primaryKey: nextId } as unknown as RuntimeJsonValue,
  });
}

function chooseEdge(ids: readonly string[]) {
  const nextId = ids.find((id) => id !== PENDING_GRAPH_EDGE_ID) ?? null;
  if (nextId === null) {
    if (selectedEdge.value.value === null) return;
    commitSelection({ edge: null });
    return;
  }
  if (selectedEdges.value.length === 1 && selectedEdges.value[0] === nextId && selectedNode.value.value === null) return;
  commitSelection({
    ...(selectedNode.value.value !== null ? { node: null } : {}),
    edge: { className: edgeType, primaryKey: nextId } as unknown as RuntimeJsonValue,
  });
}

function activateElement(element: GraphCanvasElement) {
  if (element.kind === "edge" && element.id === PENDING_GRAPH_EDGE_ID) return;
  const refValue: ObjectListRef = {
    className: element.kind === "node" ? nodeType : edgeType,
    primaryKey: element.id,
  };
  if (element.kind === "node") {
    const alreadySelected =
      selectedNodes.value.length === 1
      && selectedNodes.value[0] === element.id
      && selectedEdge.value.value === null;
    if (alreadySelected) {
      emit("choose", refValue);
      return;
    }
    commitSelection(
      {
        ...(selectedEdge.value.value !== null ? { edge: null } : {}),
        node: refValue as unknown as RuntimeJsonValue,
      },
      () => emit("choose", refValue),
    );
    return;
  }
  const alreadySelected =
    selectedEdges.value.length === 1
    && selectedEdges.value[0] === element.id
    && selectedNode.value.value === null;
  if (alreadySelected) {
    emit("choose", refValue);
    return;
  }
  commitSelection(
    {
      ...(selectedNode.value.value !== null ? { node: null } : {}),
      edge: refValue as unknown as RuntimeJsonValue,
    },
    () => emit("choose", refValue),
  );
}

function letGo() {
  if (selectedNode.value.value === null && selectedEdge.value.value === null) return;
  commitSelection({ node: null, edge: null });
}
function connect(source: string, target: string) {
  connectFrom.set(source);
  connectTo.set(target);
}
function move(id: string, place: GraphCanvasPoint) {
  positions.set({ ...saved.value, [id]: { x: place.x, y: place.y } } as unknown as RuntimeJsonValue);
  if (props.connectPorts && hoveredNodeId.value === id) refreshHoveredNodeBox();
}

type PortDirection = "top" | "right" | "bottom" | "left";
interface PortDragState {
  sourceId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  targetId: string | null;
  targetBox: GraphCanvasNodeViewportBox | null;
}

const hoveredNodeId = ref<string | null>(null);
const hoveredNodeBox = ref<GraphCanvasNodeViewportBox | null>(null);
const portDrag = ref<PortDragState | null>(null);
let hoverClearTimer: ReturnType<typeof setTimeout> | undefined;

function refreshHoveredNodeBox() {
  if (!props.connectPorts || !hoveredNodeId.value) {
    hoveredNodeBox.value = null;
    return;
  }
  hoveredNodeBox.value = canvas.value?.nodeViewportBox?.(hoveredNodeId.value) ?? null;
}

function onHoverNode(id: string | null) {
  if (!props.connectPorts) return;
  clearTimeout(hoverClearTimer);
  if (id) {
    hoveredNodeId.value = id;
    refreshHoveredNodeBox();
    return;
  }
  if (portDrag.value) return;
  hoverClearTimer = setTimeout(() => {
    hoveredNodeId.value = null;
    hoveredNodeBox.value = null;
  }, 120);
}

function onPortMouseEnter() {
  clearTimeout(hoverClearTimer);
}

function onPortMouseLeave() {
  if (portDrag.value) return;
  clearTimeout(hoverClearTimer);
  hoverClearTimer = setTimeout(() => {
    hoveredNodeId.value = null;
    hoveredNodeBox.value = null;
  }, 120);
}

const hoverPortHandles = computed(() => {
  if (!props.connectPorts || !hoveredNodeBox.value || portDrag.value) return [];
  const { id, x, y, radius } = hoveredNodeBox.value;
  return [
    { direction: "top" as PortDirection, nodeId: id, x, y: y - radius },
    { direction: "right" as PortDirection, nodeId: id, x: x + radius, y },
    { direction: "bottom" as PortDirection, nodeId: id, x, y: y + radius },
    { direction: "left" as PortDirection, nodeId: id, x: x - radius, y },
  ];
});

function stageLocalPoint(clientX: number, clientY: number): GraphCanvasPoint {
  const rect = canvas.value?.frameRect?.() ?? element.value?.getBoundingClientRect();
  if (!rect) return { x: clientX, y: clientY };
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function hitTestNodeAt(point: GraphCanvasPoint): GraphCanvasNodeViewportBox | null {
  const rects = canvas.value?.nodeViewportRects?.() ?? [];
  let closest: GraphCanvasNodeViewportBox | null = null;
  let bestDist = Infinity;
  for (const box of rects) {
    const dist = Math.hypot(point.x - box.x, point.y - box.y);
    if (dist <= box.radius + 14 && dist < bestDist) {
      bestDist = dist;
      closest = box;
    }
  }
  return closest;
}

function stopPortDragListeners() {
  window.removeEventListener("pointermove", onPortPointerMove);
  window.removeEventListener("pointerup", onPortPointerUp);
  window.removeEventListener("pointercancel", onPortPointerCancel);
  window.removeEventListener("keydown", onPortKeyDown);
}

function onPortPointerMove(event: PointerEvent) {
  if (!portDrag.value) return;
  const point = stageLocalPoint(event.clientX, event.clientY);
  const hit = hitTestNodeAt(point);
  portDrag.value = {
    ...portDrag.value,
    currentX: hit ? hit.x : point.x,
    currentY: hit ? hit.y : point.y,
    targetId: hit ? hit.id : null,
    targetBox: hit,
  };
}

function onPortPointerUp(event: PointerEvent) {
  const active = portDrag.value;
  stopPortDragListeners();
  portDrag.value = null;
  if (!active) return;
  const point = stageLocalPoint(event.clientX, event.clientY);
  const hit = hitTestNodeAt(point) ?? active.targetBox;
  if (hit) connect(active.sourceId, hit.id);
}

function onPortPointerCancel() {
  stopPortDragListeners();
  portDrag.value = null;
}

function onPortKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") onPortPointerCancel();
}

function startPortConnect(handle: { direction: PortDirection; nodeId: string; x: number; y: number }, event: PointerEvent) {
  if (!props.connectPorts || !editable.value) return;
  clearTimeout(hoverClearTimer);
  const point = stageLocalPoint(event.clientX, event.clientY);
  portDrag.value = {
    sourceId: handle.nodeId,
    startX: handle.x,
    startY: handle.y,
    currentX: point.x,
    currentY: point.y,
    targetId: null,
    targetBox: null,
  };
  window.addEventListener("pointermove", onPortPointerMove);
  window.addEventListener("pointerup", onPortPointerUp);
  window.addEventListener("pointercancel", onPortPointerCancel);
  window.addEventListener("keydown", onPortKeyDown);
}

const portPreviewPath = computed(() => {
  const drag = portDrag.value;
  if (!drag) return "";
  if (drag.targetBox && drag.targetId === drag.sourceId) {
    const { x, y, radius } = drag.targetBox;
    const topY = y - radius;
    return `M ${x - radius * 0.45} ${topY} C ${x - radius * 1.4} ${topY - 56}, ${x + radius * 1.4} ${topY - 56}, ${x + radius * 0.45} ${topY}`;
  }
  return `M ${drag.startX} ${drag.startY} L ${drag.currentX} ${drag.currentY}`;
});

const canvas = ref<InstanceType<typeof G6GraphCanvas> | null>(null);
/** The whole graph, or — where it would be too small to read — the part around the chosen node, else the most connected. */
function fit() {
  if (!canvas.value) return;
  const chosen = selectedNodes.value.find((id) => computedLayout.value.positions.has(id));
  const maxZoom = layoutMode.value === "force" ? 1 : 1.15;
  void canvas.value.fit({ maxZoom, keepNames: true, padding: FIT_PADDING, around: chosen ?? computedLayout.value.root })
    .then((whole) => {
      partial.value = !whole;
      moved.value = false;
      fitted = true;
    });
}
/**
 * A graph larger than the canvas at a size its names can be read at is shown in part, and a light line says so; once the
 * reader moves the view (they found the rest) it steps back.
 */
const partial = ref(false);
const moved = ref(false);
let fitted = false;
// The view a reader opens the graph on.
watch(canvas, (drawn) => drawn && fit(), { flush: "post" });
/** The part a reader chose, in the middle of the view. */
function focusChosen() {
  void canvas.value!.focus(selectedNodes.value[0]!);
}
const ZOOM_STEP = 1.25;
/**
 * Once the container settles at a new size (a side panel opening beside it), the graph is laid out for the new room and
 * fitted to it again.
 */
let settling: ReturnType<typeof setTimeout> | undefined;
function resized(width: number, height: number) {
  clearTimeout(settling);
  settling = setTimeout(() => {
    measure(width, height);
    // The canvas takes the new places on the next update; the fit waits for them.
    void nextTick(fit);
  }, 200);
}
onBeforeUnmount(() => {
  clearTimeout(settling);
  clearTimeout(hoverClearTimer);
  stopPortDragListeners();
});
/** The zoom the canvas shows, as the page reads it (`zoom`), to two decimals; and the zoom the page sets, shown. */
let shownZoom: number | null = null;
function viewed(viewport: GraphCanvasViewport) {
  if (fitted && partial.value) moved.value = true;
  shownZoom = Math.round(viewport.zoom * 100) / 100;
  if (zoom.value.value !== shownZoom) zoom.set(shownZoom);
  if (props.connectPorts && hoveredNodeId.value) refreshHoveredNodeBox();
}
watch(() => zoom.value.value, (wanted) => {
  if (typeof wanted === "number" && wanted !== shownZoom && canvas.value) void canvas.value.zoomTo(wanted);
});
/** Back to where the relations place each node: the reader's places are let go. */
function relayout() {
  positions.set(null);
  fit();
}
async function download() {
  const background = exportBackground.value;
  const image = background
    ? await canvas.value!.exportImage({ background })
    : await canvas.value!.exportImage();
  const suggestedName = resolveGraphExportFilename(exportFilename.value, member.projection.name);
  savePanelFile({ bytes: new Uint8Array(await image.arrayBuffer()), mime: "image/png", suggestedName });
}
</script>

<template>
  <div class="sdk-object-graph-canvas" :data-graph-highlight-kind="highlightKind">
    <div
      v-if="showHighlightBanner && showGraph && highlightKind === 'path' && pathResult.status !== 'idle'"
      class="sdk-object-graph-canvas-highlight sdk-object-graph-canvas-path"
      :class="`status-${pathResult.status}`"
      role="status"
      data-graph-path-banner
      :data-graph-path-status="pathResult.status"
      :data-graph-path-hops="pathResult.hops ?? undefined"
      :title="pathBannerText"
    >
      <span class="sdk-object-graph-canvas-highlight-badge">{{ t("platform.graphPathHighlightLabel") }}</span>
      <span v-if="pathResult.status === 'found'" class="sdk-object-graph-canvas-path-hops">{{ pathHopsLabel }}</span>
      <span class="sdk-object-graph-canvas-highlight-text">{{ pathResult.status === "found" ? pathTrail : pathBannerText }}</span>
    </div>
    <div
      v-else-if="showHighlightBanner && showGraph && highlightKind === 'search'"
      class="sdk-object-graph-canvas-highlight sdk-object-graph-canvas-search"
      role="status"
      data-graph-search-banner
      :title="searchBannerTitle"
    >
      <span class="sdk-object-graph-canvas-highlight-badge">
        {{ t("platform.graphSearchHighlightLabel") }} ({{ searchHighlightItems.length }})
      </span>
      <span class="sdk-object-graph-canvas-highlight-text">{{ searchPreviewText }}</span>
    </div>
    <div
      v-if="toolbarPlacement === 'top-four'"
      class="sdk-object-graph-canvas-top-bar"
      data-graph-top-toolbar
    >
      <div class="sdk-object-graph-canvas-top-tools" role="toolbar" :aria-label="t('platform.graphFit')" data-graph-toolbar>
        <button type="button" data-graph-action="zoom-in" :disabled="!showGraph" :title="t('platform.graphZoomIn')" :aria-label="t('platform.graphZoomIn')" @click="canvas?.zoomBy(ZOOM_STEP)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button type="button" data-graph-action="zoom-out" :disabled="!showGraph" :title="t('platform.graphZoomOut')" :aria-label="t('platform.graphZoomOut')" @click="canvas?.zoomBy(1 / ZOOM_STEP)">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button type="button" data-graph-action="fit" :disabled="!showGraph" :title="t('platform.graphFit')" :aria-label="t('platform.graphFit')" @click="fit">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
          </svg>
        </button>
        <button type="button" data-graph-action="relayout" :disabled="!showGraph" :title="t('platform.graphRelayout')" :aria-label="t('platform.graphRelayout')" @click="relayout">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="6" y="1.5" width="4" height="3.5" rx="0.8" />
            <rect x="1.5" y="11" width="4" height="3.5" rx="0.8" />
            <rect x="10.5" y="11" width="4" height="3.5" rx="0.8" />
            <path d="M8 5v3M3.5 11V8h9v3" />
          </svg>
        </button>
      </div>
      <div class="sdk-object-graph-canvas-top-right" data-graph-toolbar-right>
        <slot
          name="toolbar-actions"
          :selected-node="selectedNode.value.value"
          :selected-edge="selectedEdge.value.value"
          :selected-nodes="selectedNodes"
          :selected-edges="selectedEdges"
          :node-count="resolved.nodes.length"
          :edge-count="resolved.links.length"
          :zoom="zoom.value.value"
          :zoom-in="() => canvas?.zoomBy(ZOOM_STEP)"
          :zoom-out="() => canvas?.zoomBy(1 / ZOOM_STEP)"
          :fit-view="fit"
          :relayout="relayout"
        ></slot>
        <slot
          name="toolbar-right"
          :selected-node="selectedNode.value.value"
          :selected-edge="selectedEdge.value.value"
          :selected-nodes="selectedNodes"
          :selected-edges="selectedEdges"
          :node-count="resolved.nodes.length"
          :edge-count="resolved.links.length"
          :zoom="zoom.value.value"
          :zoom-in="() => canvas?.zoomBy(ZOOM_STEP)"
          :zoom-out="() => canvas?.zoomBy(1 / ZOOM_STEP)"
          :fit-view="fit"
          :relayout="relayout"
        ></slot>
      </div>
    </div>
    <div ref="element" class="sdk-object-graph-canvas-stage">
      <el-skeleton v-if="resolved.loading" :rows="4" animated></el-skeleton>
      <p v-else-if="resolved.error" class="sdk-object-graph-canvas-error" role="alert">{{ resolved.error }}</p>
      <el-empty v-else-if="!resolved.nodes.length" :description="t('platform.graphEmpty')" :image-size="48"></el-empty>
      <template v-else-if="room">
        <G6GraphCanvas
          ref="canvas"
          :label="member.projection.name"
          :nodes="drawnNodes"
          :edges="drawnEdges"
          :selected="selectedNodes"
          :selected-edges="selectedEdges"
          selection="single"
          :layout="{ type: 'preset' }"
          :categories="categories"
          :node-size="look.nodeSize"
          :label-size="look.labelSize"
          readable-labels
          :editable="editable"
          :style-overrides="styleOverrides"
          @update:selected="chooseNode($event)"
          @update:selected-edges="chooseEdge($event)"
          @activate="activateElement"
          @hover-node="onHoverNode"
          @blank="letGo"
          @connect="connect"
          @move="move"
          @viewport="viewed"
          @resized="resized"
        />
        <div
          v-if="connectPorts && hoverPortHandles.length"
          class="sdk-object-graph-connect-ports"
          data-connect-ports
        >
          <button
            v-for="handle in hoverPortHandles"
            :key="`${handle.nodeId}:${handle.direction}`"
            type="button"
            class="sdk-object-graph-connect-port"
            :data-connect-port="handle.direction"
            :data-connect-node="handle.nodeId"
            :style="{ left: `${handle.x}px`, top: `${handle.y}px` }"
            :aria-label="handle.direction"
            @mouseenter="onPortMouseEnter"
            @mouseleave="onPortMouseLeave"
            @pointerdown.stop.prevent="startPortConnect(handle, $event)"
          ></button>
        </div>
        <svg
          v-if="connectPorts && portDrag"
          class="sdk-object-graph-connect-preview"
          data-connect-preview
          aria-hidden="true"
        >
          <defs>
            <marker
              :id="previewMarkerId"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M 1 1 L 9 5 L 1 9 z" fill="currentColor" />
            </marker>
          </defs>
          <circle
            v-if="portDrag.targetBox"
            class="sdk-object-graph-connect-target-ring"
            :cx="portDrag.targetBox.x"
            :cy="portDrag.targetBox.y"
            :r="portDrag.targetBox.radius + 5"
          />
          <path
            class="sdk-object-graph-connect-preview-line"
            :d="portPreviewPath"
            :marker-end="`url(#${previewMarkerId})`"
          />
        </svg>
        <div v-if="partial || resolved.edgesNotice" class="sdk-object-graph-canvas-notices">
          <p v-if="resolved.edgesNotice" class="sdk-object-graph-canvas-edge-notice" role="status" data-graph-edges-notice>
            {{ resolved.edgesNotice }}
          </p>
          <p v-if="partial" class="sdk-object-graph-canvas-hint" :class="{ quiet: moved }" role="status" data-graph-hint>
            {{ t("platform.graphLargerThanCanvas") }}
          </p>
        </div>
        <div v-if="toolbarPlacement === 'floating'" class="sdk-object-graph-canvas-tools" data-graph-toolbar>
          <button type="button" data-graph-action="zoom-in" :title="t('platform.graphZoomIn')" :aria-label="t('platform.graphZoomIn')" @click="canvas?.zoomBy(ZOOM_STEP)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
          <button type="button" data-graph-action="zoom-out" :title="t('platform.graphZoomOut')" :aria-label="t('platform.graphZoomOut')" @click="canvas?.zoomBy(1 / ZOOM_STEP)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M3.5 8h9" />
            </svg>
          </button>
          <button type="button" data-graph-action="fit" :title="t('platform.graphFit')" :aria-label="t('platform.graphFit')" @click="fit">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
            </svg>
          </button>
          <button v-if="showFocusButton" type="button" data-graph-action="focus-selected" :disabled="!selectedNodes.length" :title="t('platform.graphFocusSelected')" :aria-label="t('platform.graphFocusSelected')" @click="focusChosen">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="8" cy="8" r="2.5" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
            </svg>
          </button>
          <button type="button" data-graph-action="relayout" :title="t('platform.graphRelayout')" :aria-label="t('platform.graphRelayout')" @click="relayout">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <rect x="6" y="1.5" width="4" height="3.5" rx="0.8" />
              <rect x="1.5" y="11" width="4" height="3.5" rx="0.8" />
              <rect x="10.5" y="11" width="4" height="3.5" rx="0.8" />
              <path d="M8 5v3M3.5 11V8h9v3" />
            </svg>
          </button>
          <button type="button" data-graph-action="download" :title="t('common.download')" :aria-label="t('common.download')" @click="download">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
            </svg>
          </button>
          <slot
            name="toolbar"
            :zoom="zoom.value.value"
            :zoom-in="() => canvas?.zoomBy(ZOOM_STEP)"
            :zoom-out="() => canvas?.zoomBy(1 / ZOOM_STEP)"
            :fit-view="fit"
            :relayout="relayout"
            :export-png="download"
            :selected-nodes="selectedNodes"
            :selected-edges="selectedEdges"
            :node-count="resolved.nodes.length"
            :edge-count="resolved.links.length"
          ></slot>
        </div>
        <div v-if="$slots.overlay" class="sdk-object-graph-canvas-overlay" data-graph-overlay>
          <slot
            name="overlay"
            :selected-node="selectedNode.value.value"
            :selected-edge="selectedEdge.value.value"
            :path-result="pathResult"
            :node-count="resolved.nodes.length"
            :edge-count="resolved.links.length"
          ></slot>
        </div>
        <div v-if="canvasHint" class="sdk-object-graph-canvas-op-hint" data-graph-op-hint>
          <span aria-hidden="true"></span>
          {{ canvasHint }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Fills the box its member is placed in; falls back to the default minimum canvas height when that box has no definite
   height, so G6 always measures a non-zero canvas. */
.sdk-object-graph-canvas {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 420px;
  container-type: inline-size;
}
.sdk-object-graph-canvas-stage {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 20px 20px;
}
.sdk-object-graph-canvas-error {
  margin: 0;
  color: var(--el-color-danger-text);
  font-size: var(--text-sm);
}
.sdk-object-graph-canvas-highlight {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border-bottom: 1px solid var(--ui-divider);
  background: var(--el-bg-color-overlay);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.sdk-object-graph-canvas-path {
  border-bottom-color: var(--el-color-warning-light-5);
  color: var(--el-text-color-primary);
}
.sdk-object-graph-canvas-highlight-badge {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 600;
}
.sdk-object-graph-canvas-path .sdk-object-graph-canvas-highlight-badge {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}
.sdk-object-graph-canvas-path-hops {
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}
.sdk-object-graph-canvas-search {
  border-bottom-color: var(--el-color-primary-light-5);
  color: var(--el-text-color-primary);
}
.sdk-object-graph-canvas-search .sdk-object-graph-canvas-highlight-badge {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.sdk-object-graph-canvas-highlight-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular);
}
.sdk-object-graph-canvas-notices {
  position: absolute;
  inset-block-end: 66px;
  inset-inline-start: 18px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-xs);
  pointer-events: none;
}
.sdk-object-graph-canvas-edge-notice {
  margin: 0;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  color: var(--el-color-warning-dark-2);
  font-size: var(--text-xs);
}
.sdk-object-graph-canvas-hint {
  margin: 0;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-sm);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  transition: opacity 200ms ease-out;
}
.sdk-object-graph-canvas-hint.quiet {
  opacity: 0.55;
}
.sdk-object-graph-canvas-tools {
  position: absolute;
  inset-block-end: 18px;
  inset-inline-start: 18px;
  z-index: 2;
  display: flex;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  border: 1px solid var(--el-border-color-lighter, var(--ui-divider));
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay, 0 4px 16px rgba(15, 23, 42, 0.08));
}
.sdk-object-graph-canvas-tools button {
  display: grid;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.sdk-object-graph-canvas-tools button:disabled {
  cursor: default;
  opacity: 0.4;
}
.sdk-object-graph-canvas-tools button:not(:disabled):hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-graph-canvas-top-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-height: 48px;
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-lighter, var(--ui-divider));
  background: var(--el-bg-color);
}
.sdk-object-graph-canvas-top-tools {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}
.sdk-object-graph-canvas-top-tools button {
  display: grid;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.sdk-object-graph-canvas-top-tools button:disabled {
  cursor: default;
  opacity: 0.4;
}
.sdk-object-graph-canvas-top-tools button:not(:disabled):hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-graph-canvas-top-right {
  margin-inline-start: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-graph-connect-ports {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
.sdk-object-graph-connect-port {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid var(--el-color-primary);
  border-radius: 50%;
  background: var(--el-bg-color);
  transform: translate(-50%, -50%);
  cursor: crosshair;
  pointer-events: auto;
  box-shadow: 0 0 0 2px var(--el-bg-color);
  transition: transform 120ms ease, background-color 120ms ease;
}
.sdk-object-graph-connect-port:hover {
  transform: translate(-50%, -50%) scale(1.25);
  background: var(--el-color-primary-light-9);
}
.sdk-object-graph-connect-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
  color: var(--el-color-primary);
  overflow: visible;
}
.sdk-object-graph-connect-preview-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-dasharray: 5 4;
  stroke-linecap: round;
}
.sdk-object-graph-connect-target-ring {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-opacity: 0.5;
}
.sdk-object-graph-canvas-op-hint {
  position: absolute;
  inset-block-end: 20px;
  inset-inline-end: 18px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--el-text-color-placeholder);
  font-size: var(--text-xs);
  pointer-events: none;
}
.sdk-object-graph-canvas-op-hint span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
}
@container (max-width: 480px) {
  .sdk-object-graph-canvas-op-hint {
    display: none;
  }
}
</style>
