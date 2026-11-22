<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { G6GraphCanvas, layoutByRelations, type GraphCanvasPoint, type GraphCanvasTone, type GraphCanvasViewport, type LayoutRoom } from "@ontomato/foundation-ui/graph/g6";
import { useMember, useMemberParam } from "../panel/member";
import { savePanelFile } from "../panel/save-file";
import { useGraphRecords, type EdgeEndsConfig } from "./object-graph-data";

/**
 * The graph as a page draws it (the ontology graph, visual modeling): the owner's node and edge records on the platform's
 * G6 canvas. A chosen node or edge is the panel's state of the type its datum reads (`selectedNode`, `selectedEdge`);
 * a click on empty canvas lets both go. Where the reader puts the nodes is the reader's own (`positions`, a personal
 * state), drawn again from there; a node never placed is placed by its relations, the most connected first, and nothing
 * is written for it. What the panel highlights (`highlightedNodes`, `highlightedEdges`: a path, a search's hits) stands
 * out and the rest fades, without being chosen. The view opens on the chosen node, else the most connected, never
 * smaller than names can be read at: a graph too large for that is panned. On an editable graph a line drawn with
 * Shift from one node to another hands the panel its two ends (`connectFrom`, `connectTo`) for the owner's new edge —
 * the canvas draws no edge of its own and writes nothing to the owner.
 */
const props = withDefaults(defineProps<{ edgeEnds?: EdgeEndsConfig; editable?: boolean; categories?: readonly string[]; nodeCategory?: string }>(), { editable: undefined });

const { t } = useI18n();
const member = useMember();
const nodeCategory = props.nodeCategory ?? member.projection.config.nodeCategory;
if (nodeCategory !== undefined && typeof nodeCategory !== "string") throw new Error(`The projection in member '${member.key}' names nodeCategory with no JSON Pointer`);
const resolved = useGraphRecords(props.edgeEnds, nodeCategory);
/** The categories in a fixed order: the n-th takes the platform palette's n-th colour. */
const categories = computed(() => {
  const listed = props.categories ?? member.projection.config.categories ?? [];
  if (!Array.isArray(listed) || !listed.every((item) => typeof item === "string"))
    throw new Error(`The projection in member '${member.key}' names categories that are not a list of names`);
  return listed as string[];
});
const editable = computed(() => props.editable ?? member.projection.config.editable === true);

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
const zoom = useMemberParam("zoom");

type Positions = Record<string, GraphCanvasPoint>;
const saved = computed<Positions>(() => {
  const value = positions.value.value;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as unknown as Positions : {};
});
/** The clear space kept around the graph when it is fitted to the canvas. */
const FIT_PADDING = 36;
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
const layout = computed(() => layoutByRelations(resolved.value.nodes, resolved.value.links, room.value!));

/** The chosen object's key, when the state holds one of this type. */
const keyOf = (value: RuntimeJsonValue | null, type: string) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && value.className === type ? [String(value.primaryKey)] : [];
/** The keys of the objects of this type a list state holds. */
const keysOf = (value: RuntimeJsonValue | null, type: string) => new Set(Array.isArray(value) ? value.flatMap((item) => keyOf(item, type)) : []);
const selectedNodes = computed(() => keyOf(selectedNode.value.value, nodeType));
const selectedEdges = computed(() => keyOf(selectedEdge.value.value, edgeType));

const highlighted = computed(() => ({ nodes: keysOf(highlightedNodes.value.value, nodeType), edges: keysOf(highlightedEdges.value.value, edgeType) }));
/** With anything highlighted, what is stands out and the rest fades; otherwise every element is plain. */
const toneOf = (keys: ReadonlySet<string>, id: string): GraphCanvasTone | undefined =>
  highlighted.value.nodes.size || highlighted.value.edges.size ? (keys.has(id) ? "accent" : "muted") : undefined;

/** Every node where the reader put it, else where its relations place it. */
const drawnNodes = computed(() => resolved.value.nodes.map((node) => ({
  ...node, ...layout.value.positions.get(node.id), ...saved.value[node.id], tone: toneOf(highlighted.value.nodes, node.id),
})));
const drawnEdges = computed(() => resolved.value.links.map((edge) => ({ ...edge, tone: toneOf(highlighted.value.edges, edge.id) })));

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
  const chosen = selectedNodes.value.find((id) => layout.value.positions.has(id));
  void canvas.value!.fit({ maxZoom: 1.15, keepNames: true, padding: FIT_PADDING, around: chosen ?? layout.value.root })
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
  <div ref="element" class="sdk-object-graph-canvas">
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
      <p v-if="partial" class="sdk-object-graph-canvas-hint" :class="{ quiet: moved }" role="status" data-graph-hint>
        {{ t("platform.graphLargerThanCanvas") }}
      </p>
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
        <button type="button" data-graph-action="focus-selected" :disabled="!selectedNodes.length" :title="t('platform.graphFocusSelected')" :aria-label="t('platform.graphFocusSelected')" @click="focusChosen">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <circle cx="8" cy="8" r="2.5" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
          </svg>
        </button>
        <button type="button" data-graph-action="relayout" :title="t('platform.graphRelayout')" :aria-label="t('platform.graphRelayout')" @click="relayout">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.3-3.55M13.5 2.5v2.75h-2.75" />
          </svg>
        </button>
        <button type="button" data-graph-action="download" :title="t('common.download')" :aria-label="t('common.download')" @click="download">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
          </svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The canvas fills the box its member is placed in (a flex item stretched to the panel's space, or a fixed height): how
   tall that box is is the panel's, filling it is the canvas's own — G6 draws nothing in a box it measures at 0. */
.sdk-object-graph-canvas {
  position: relative;
  height: 100%;
  min-height: 0;
}
.sdk-object-graph-canvas-error {
  margin: 0;
  color: var(--el-color-danger-text);
  font-size: var(--text-sm);
}
.sdk-object-graph-canvas-hint {
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
.sdk-object-graph-canvas-hint.quiet {
  opacity: 0.55;
}
.sdk-object-graph-canvas-tools {
  position: absolute;
  inset-block-start: var(--spacing-sm);
  inset-inline-end: var(--spacing-sm);
  display: flex;
  gap: calc(var(--spacing-xs) / 2);
  padding: calc(var(--spacing-xs) / 2);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
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
</style>
