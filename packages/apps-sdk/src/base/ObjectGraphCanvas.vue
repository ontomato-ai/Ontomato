<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { PageHighlight } from "@ontomato/contracts/page-context";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { G6GraphCanvas, layoutByForce, layoutByRelations, type GraphCanvasPoint, type GraphCanvasTone, type GraphCanvasViewport, type LayoutRoom } from "@ontomato/foundation-ui/graph/g6";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberParam } from "../panel/member";
import { savePanelFile } from "../panel/save-file";
import { useGraphRecords, type EdgeEndsConfig } from "./object-graph-data";
import { findDirectedGraphPath } from "./object-graph-path";

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
}>(), { editable: undefined, highlightBanner: undefined, showFocusButton: undefined });

const { t } = useI18n();
const { instance } = usePanelContext();
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
  return resolved.value.edgesNotice
    ? t("platform.graphPathNotFoundVisible", { from: result.from.label, to: result.to.label })
    : t("platform.graphPathNotFound", { from: result.from.label, to: result.to.label });
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

/** Every node where the reader put it, else where its relations place it. */
const drawnNodes = computed(() => resolved.value.nodes.map((node) => ({
  ...node, ...computedLayout.value.positions.get(node.id), ...saved.value[node.id], tone: nodeToneOf(node.id),
})));
const drawnEdges = computed(() => resolved.value.links.map((edge) => ({ ...edge, tone: edgeToneOf(edge.id) })));

const choose = (param: typeof selectedNode, type: string, ids: readonly string[]) =>
  param.set(ids.length ? { className: type, primaryKey: ids[0]! } as unknown as RuntimeJsonValue : null);
function letGo() {
  selectedNode.set(null);
  selectedEdge.set(null);
}
function connect(source: string, target: string) {
  connectFrom.set(source);
  connectTo.set(target);
}
function move(id: string, place: GraphCanvasPoint) {
  positions.set({ ...saved.value, [id]: { x: place.x, y: place.y } } as unknown as RuntimeJsonValue);
}

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
onBeforeUnmount(() => clearTimeout(settling));
/** The zoom the canvas shows, as the page reads it (`zoom`), to two decimals; and the zoom the page sets, shown. */
let shownZoom: number | null = null;
function viewed(viewport: GraphCanvasViewport) {
  if (fitted && partial.value) moved.value = true;
  shownZoom = Math.round(viewport.zoom * 100) / 100;
  if (zoom.value.value !== shownZoom) zoom.set(shownZoom);
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
  const image = await canvas.value!.exportImage();
  savePanelFile({ bytes: new Uint8Array(await image.arrayBuffer()), mime: "image/png", suggestedName: `${member.projection.name}.png` });
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
          @update:selected="choose(selectedNode, nodeType, $event)"
          @update:selected-edges="choose(selectedEdge, edgeType, $event)"
          @blank="letGo"
          @connect="connect"
          @move="move"
          @viewport="viewed"
          @resized="resized"
        />
        <div v-if="partial || resolved.edgesNotice" class="sdk-object-graph-canvas-notices">
          <p v-if="resolved.edgesNotice" class="sdk-object-graph-canvas-edge-notice" role="status" data-graph-edges-notice>
            {{ resolved.edgesNotice }}
          </p>
          <p v-if="partial" class="sdk-object-graph-canvas-hint" :class="{ quiet: moved }" role="status" data-graph-hint>
            {{ t("platform.graphLargerThanCanvas") }}
          </p>
        </div>
        <div class="sdk-object-graph-canvas-tools" data-graph-toolbar>
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
