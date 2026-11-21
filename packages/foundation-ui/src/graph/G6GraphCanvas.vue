<script setup lang="ts">
import { Graph, type EdgeData, type NodeData } from "@antv/g6";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { G6_LABEL_WIDTH, G6_NODE_SIZE, g6Edges, g6Node, g6NodeStyle, readG6Colors, type G6Colors } from "./g6-elements";
import { MARGIN, NODE_HEIGHT, NODE_WIDTH, placeNodes } from "./layout";
import type {
  GraphCanvasEdge,
  GraphCanvasElement,
  GraphCanvasLayout,
  GraphCanvasNode,
  GraphCanvasPoint,
  GraphCanvasSelection,
  GraphCanvasViewport,
} from "./types";

/**
 * The graph canvas drawn by G6, for graphs a reader pans, zooms and drags: the same interface as the SVG `GraphCanvas`
 * (./types.ts), plus what only a canvas that moves can offer. It reads nothing, decides nothing about what a node means,
 * keeps no selection and stores nothing: the caller passes `selected` and writes back what the canvas hands it, keeps a
 * dragged node's position if it wants it kept, and saves or downloads what `positions()` and `exportImage()` give it.
 *
 * It follows what it is given: a change to `nodes` or `edges` adds, updates and removes only the elements that changed,
 * so a caller grows a graph by passing a longer list, and a node moves only when its caller gives it a new position.
 * Large additions are drawn in batches so the page stays responsive, reported through `progress`.
 */
const props = withDefaults(
  defineProps<{
    /** The graph's accessible name. */
    label: string;
    /** The nodes to draw. */
    nodes: readonly GraphCanvasNode[];
    /** The edges between the nodes; one that names a node not given is not drawn. */
    edges?: readonly GraphCanvasEdge[];
    /** The IDs of the chosen nodes, drawn as selected. */
    selected?: readonly string[];
    /**
     * The IDs of the chosen edges, drawn as selected; a reader chooses edges under the same `selection` rule as nodes.
     * Whether a node and an edge may be chosen at once is the caller's: it passes back what it keeps.
     */
    selectedEdges?: readonly string[];
    /** How a reader chooses: `none` draws only, `single` keeps at most one node, `multiple` adds and removes one at a time. */
    selection?: GraphCanvasSelection;
    /** Where the nodes go: `grid` in the given order, `preset` at each node's `x`/`y`. */
    layout?: GraphCanvasLayout;
    /** The canvas fills its container's height; when given, it grows no taller than this many pixels. */
    maxHeight?: number;
    /** Categories in a fixed order: the n-th takes the palette's n-th colour; any other category is placed by its name. */
    categories?: readonly string[];
    /** The widest a node's name is drawn, in graph units; a longer one ends in an ellipsis. 160 when absent. */
    labelWidth?: number;
    /**
     * Keeps names readable however far the reader zooms out: a node's and an edge's name stay their size on screen, and
     * a name that would then overlap another is hidden until there is room for it again.
     */
    readableLabels?: boolean;
    /**
     * Lets a reader ask for a new edge: dragging from a node to a node with Shift held hands back `connect`, while a
     * plain drag still moves the node. The canvas draws no edge of its own: the caller adds one if its owner creates it.
     */
    editable?: boolean;
  }>(),
  { edges: () => [], selected: () => [], selectedEdges: () => [], selection: "single", layout: () => ({ type: "grid" }), maxHeight: undefined, categories: () => [], labelWidth: G6_LABEL_WIDTH, readableLabels: false, editable: false },
);
const emit = defineEmits<{
  /** The selection a reader's choice results in: every chosen ID, in the order they were chosen. */
  "update:selected": [ids: string[]];
  /** The edge selection a reader's choice on an edge results in, as `update:selected` is for nodes. */
  "update:selectedEdges": [ids: string[]];
  /** The part of the graph in view, in graph coordinates: after each draw, pan, zoom and resize. */
  viewport: [viewport: GraphCanvasViewport];
  /** A reader clicked the canvas away from every node and edge. */
  blank: [];
  /** A reader asked for an edge from `source` to `target` (both node IDs, the same one for a loop); only when `editable`. */
  connect: [source: string, target: string];
  /** A reader double-clicked a node or an edge: what that does is the caller's. */
  activate: [element: GraphCanvasElement];
  /** A reader dragged a node and let go here. The canvas keeps it there until its caller gives it another position. */
  move: [id: string, position: GraphCanvasPoint];
  /** How many of the elements being added are drawn so far, while a change is drawn in batches; ends with drawn = total. */
  progress: [drawn: number, total: number];
  /** The canvas took a new size (its container grew or shrank), once G6 has been resized to it. */
  resized: [width: number, height: number];
}>();

const BATCH = 200;
/** The area the canvas takes; the element G6 draws into sits inside it, because G6 restyles its own container. */
const frame = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
let graph: Graph | null = null;
let colors: G6Colors;
/** What G6 holds now, as last handed to it: each node's look and position, each edge, and the selected node and edge IDs. */
let drawnNodes = new Map<string, string>();
let drawnPositions = new Map<string, string>();
let drawnEdges = new Map<string, string>();
let drawnSelected = new Set<string>();
/**
 * Every change to G6 runs after the one before it, so a drawing in batches is never interleaved with another. The queue
 * opens once G6 is created and has drawn the first props, which waits for the canvas to have a size: a caller may fit or
 * place the view before that, and it happens then. A task still queued when the canvas goes away is not run.
 */
let opened!: () => void;
let queue: Promise<void> = new Promise<void>((resolve) => (opened = resolve));

function enqueue(task: (target: Graph) => Promise<void>): Promise<void> {
  const run = queue.then(() => (graph ? task(graph) : undefined));
  queue = run.catch(() => undefined);
  return run;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function positionsOf(nodes: readonly GraphCanvasNode[]): Map<string, GraphCanvasPoint> {
  if (props.layout.type === "preset") return new Map(placeNodes(nodes, props.layout).map((node) => [node.id, { x: node.x, y: node.y }]));
  // The grid is laid out for the SVG canvas's boxes; G6 places a node by its centre.
  return new Map(placeNodes(nodes, props.layout).map((node) => [node.id, { x: node.x + NODE_WIDTH / 2 - MARGIN, y: node.y + NODE_HEIGHT / 2 - MARGIN }]));
}

/**
 * Brings G6 to the current props: removes what is gone, adds what is new in batches, and updates what changed. Props
 * that come back with the same content draw nothing: a caller re-rendering on `viewport` must not set off another draw.
 */
async function sync(target: Graph) {
  const nodes = new Map(props.nodes.map((node) => [node.id, node]));
  const positions = positionsOf(props.nodes);
  const choosable = props.selection !== "none";
  const nodeStyles = new Map(props.nodes.map((node) => [node.id, g6NodeStyle(node, colors, props.categories, choosable, props.labelWidth)]));
  const edges = g6Edges(props.edges, nodes, colors);
  const edgeKeys = new Map(edges.map((edge) => [String(edge.id), JSON.stringify(edge)]));

  const goneEdges = [...drawnEdges.keys()].filter((id) => edgeKeys.get(id) === undefined);
  if (goneEdges.length) target.removeEdgeData(goneEdges);
  const goneNodes = [...drawnNodes.keys()].filter((id) => !nodes.has(id));
  if (goneNodes.length) target.removeNodeData(goneNodes);
  for (const id of goneEdges) {
    drawnEdges.delete(id);
    drawnSelected.delete(id);
  }
  for (const id of goneNodes) {
    drawnNodes.delete(id);
    drawnPositions.delete(id);
    drawnSelected.delete(id);
  }

  const changedNodes: NodeData[] = [];
  const addedNodes: NodeData[] = [];
  for (const node of props.nodes) {
    const style = nodeStyles.get(node.id)!;
    const position = positions.get(node.id)!;
    const look = JSON.stringify(style);
    const at = JSON.stringify(position);
    if (!drawnNodes.has(node.id)) addedNodes.push(g6Node(node, position, style));
    else if (drawnNodes.get(node.id) !== look || drawnPositions.get(node.id) !== at) {
      // A node keeps where a reader dragged it unless its caller gives it a new position.
      changedNodes.push({ id: node.id, data: { anchor: !!node.anchor }, style: drawnPositions.get(node.id) === at ? style : { ...style, ...position } });
    }
    drawnNodes.set(node.id, look);
    drawnPositions.set(node.id, at);
  }
  const changedEdges = edges.filter((edge) => drawnEdges.has(String(edge.id)) && drawnEdges.get(String(edge.id)) !== edgeKeys.get(String(edge.id)));
  const addedEdges = edges.filter((edge) => !drawnEdges.has(String(edge.id)));
  for (const [id, key] of edgeKeys) drawnEdges.set(id, key);

  if (changedNodes.length) target.updateNodeData(changedNodes);
  if (changedEdges.length) target.updateEdgeData(changedEdges);
  await addInBatches(target, addedNodes, addedEdges);
  const changed = goneEdges.length + goneNodes.length + changedNodes.length + changedEdges.length + addedNodes.length + addedEdges.length > 0;
  if (applySelection(target) || changed) await target.draw();
}

/** Nodes before edges, so every edge's ends exist when it is drawn. Stops if the canvas goes away between batches. */
async function addInBatches(target: Graph, nodes: NodeData[], edges: EdgeData[]) {
  const total = nodes.length + edges.length;
  if (total <= BATCH) {
    if (total) target.addData({ nodes, edges });
    return;
  }
  let drawn = 0;
  emit("progress", drawn, total);
  for (const [kind, items] of [["nodes", nodes], ["edges", edges]] as const) {
    for (let offset = 0; offset < items.length; offset += BATCH) {
      const batch = items.slice(offset, offset + BATCH);
      target.addData(kind === "nodes" ? { nodes: batch as NodeData[] } : { edges: batch as EdgeData[] });
      await target.draw();
      drawn += batch.length;
      emit("progress", drawn, total);
      await yieldToBrowser();
      if (graph !== target) return;
    }
  }
}

/** Marks the selected nodes and edges; whether that changed anything. */
function applySelection(target: Graph) {
  const next = new Set([...props.selected.filter((id) => drawnNodes.has(id)), ...props.selectedEdges.filter((id) => drawnEdges.has(id))]);
  const states: Record<string, string[]> = {};
  for (const id of drawnSelected) if (!next.has(id)) states[id] = [];
  for (const id of next) if (!drawnSelected.has(id)) states[id] = ["selected"];
  drawnSelected = next;
  if (!Object.keys(states).length) return false;
  void target.setElementState(states, false);
  return true;
}

/** The selection that choosing `id` among `current` results in, under the canvas's `selection` rule. */
function chosen(current: readonly string[], id: string) {
  if (props.selection === "single") return current.includes(id) ? [] : [id];
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

let reported = "";
function reportViewport(target: Graph) {
  const zoom = target.getZoom();
  const [x, y] = target.getCanvasByViewport([0, 0]);
  const { width, height } = frame.value!.getBoundingClientRect();
  const viewport = { x, y, width: width / zoom, height: height / zoom, zoom };
  if (JSON.stringify(viewport) === reported) return;
  reported = JSON.stringify(viewport);
  emit("viewport", viewport);
}

function edgeOptions() {
  return { type: "line", state: { selected: { stroke: colors.primary, lineWidth: 3, opacity: 1 } } };
}

function nodeOptions() {
  return { type: "circle", state: { selected: { stroke: colors.primary, lineWidth: 5, lineDash: [] } } };
}

async function create(width: number, height: number) {
  colors = readG6Colors(host.value!);
  const target = new Graph({
    container: host.value!,
    width: Math.round(width),
    height: Math.round(height),
    autoResize: false,
    padding: 48,
    animation: false,
    data: { nodes: [], edges: [] },
    behaviors: [
      "drag-canvas",
      "zoom-canvas",
      { type: "drag-element", enable: (event: any) => !(props.editable && event.shiftKey) },
      ...(props.readableLabels ? [
        {
          type: "fix-element-size", key: "readable-labels", state: "", enable: (event: any) => event.data.scale < 1,
          node: [{ shape: "label", fields: ["fontSize", "lineHeight"] }], edge: [{ shape: "label", fields: ["fontSize", "lineHeight"] }],
        },
        { type: "auto-adapt-label", key: "label-room", throttle: 100, padding: 2 },
      ] : []),
      {
        type: "create-edge",
        trigger: "drag",
        enable: (event: any) => props.editable && event.shiftKey,
        onCreate: (edge: EdgeData) => {
          emit("connect", String(edge.source), String(edge.target));
          return undefined;
        },
      },
    ],
    node: nodeOptions(),
    edge: edgeOptions(),
  });
  graph = target;
  // The second click of a double-click is not a second choice: it would undo the first.
  target.on("node:click", (event: any) => {
    if (event.detail >= 2 || props.selection === "none") return;
    emit("update:selected", chosen(props.selected, String(event.target.id)));
  });
  target.on("edge:click", (event: any) => {
    if (event.detail >= 2 || props.selection === "none") return;
    emit("update:selectedEdges", chosen(props.selectedEdges, String(event.target.id)));
  });
  target.on("canvas:click", () => emit("blank"));
  target.on("node:dblclick", (event: any) => emit("activate", { kind: "node", id: String(event.target.id) }));
  target.on("edge:dblclick", (event: any) => emit("activate", { kind: "edge", id: String(event.target.id) }));
  target.on("node:dragend", (event: any) => {
    const id = String(event.target.id);
    const [x, y] = target.getElementPosition(id);
    emit("move", id, { x, y });
  });
  await target.render();
  // Only now: G6 transforms its viewport while it creates it, before the graph can say what its zoom is.
  target.on("aftertransform", () => reportViewport(target));
  target.on("afterdraw", () => reportViewport(target));
  await sync(target);
  reportViewport(target);
  opened();
}

/**
 * Colours are resolved once and again whenever the colour roles where the canvas is drawn change (a mode switch). A
 * switch ends several of the probe's transitions; one redraw serves them all.
 */
let restyling = false;
function restyle() {
  if (restyling) return;
  restyling = true;
  void enqueue(async (target) => {
    restyling = false;
    colors = readG6Colors(host.value!);
    target.setNode(nodeOptions());
    target.setEdge(edgeOptions());
    drawnNodes = new Map([...drawnNodes.keys()].map((id) => [id, ""]));
    drawnEdges = new Map([...drawnEdges.keys()].map((id) => [id, ""]));
    drawnSelected = new Set();
    await sync(target);
  });
}

watch(
  () => [props.nodes, props.edges, props.layout.type, props.categories, props.selection, props.labelWidth],
  () => void enqueue(sync),
);
watch(
  () => [props.selected, props.selectedEdges],
  () =>
    void enqueue(async (target) => {
      if (applySelection(target)) await target.draw();
    }),
);

let resized: ResizeObserver | undefined;
onMounted(() => {
  const { width, height } = frame.value!.getBoundingClientRect();
  if (width && height) void create(width, height);
  resized = new ResizeObserver(([entry]) => {
    const { width, height } = entry!.contentRect;
    if (!width || !height) return;
    if (!graph) {
      void create(width, height);
      return;
    }
    // Through the queue: a resize while G6 is still drawing its first props waits until it can report the view.
    void enqueue(async (target) => {
      target.resize(Math.round(width), Math.round(height));
      reportViewport(target);
      emit("resized", width, height);
    });
  });
  resized.observe(frame.value!);
});
onBeforeUnmount(() => {
  resized?.disconnect();
  graph?.destroy();
  graph = null;
});

/** How far a drawn node reaches from its centre: half its name's width across, its size above, and its name below. */
const REACH = { x: () => props.labelWidth / 2, top: G6_NODE_SIZE / 2, bottom: G6_NODE_SIZE / 2 + 6 + 18 };

/**
 * At a zoom the whole graph does not fit at, the part around `around` (the graph's middle when absent), moved no further
 * than the graph's own edges: an axis the graph spans less than the view is centred on the graph, the other keeps the
 * view inside the graph, so a reader never looks at empty canvas beside a graph that runs on the other way.
 */
async function showAround(target: Graph, zoom: number, around: string | undefined, padding: number | [number, number, number, number] = 0) {
  const points = target.getNodeData().filter((node) => !node.data?.anchor).map((node) => ({ x: Number(node.style!.x), y: Number(node.style!.y) }));
  if (!points.length) return;
  const [top, right, bottom, left] = typeof padding === "number" ? [padding, padding, padding, padding] : padding;
  const { width, height } = frame.value!.getBoundingClientRect();
  const bounds = {
    minX: Math.min(...points.map(({ x }) => x)) - REACH.x(), maxX: Math.max(...points.map(({ x }) => x)) + REACH.x(),
    minY: Math.min(...points.map(({ y }) => y)) - REACH.top, maxY: Math.max(...points.map(({ y }) => y)) + REACH.bottom,
  };
  const focus = around === undefined ? undefined : target.getNodeData().find((node) => String(node.id) === around);
  const wanted = focus
    ? { x: Number(focus.style!.x), y: Number(focus.style!.y) }
    : { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  // Each axis: the centre that keeps the view within the graph's edges, or the graph's own centre where it is narrower.
  const along = (value: number, min: number, max: number, before: number, after: number, size: number) => {
    const low = min + (size / 2 - before) / zoom;
    const high = max - (size / 2 - after) / zoom;
    return low > high ? (min + max) / 2 : Math.min(Math.max(value, low), high);
  };
  const centre = [along(wanted.x, bounds.minX, bounds.maxX, left, right, width), along(wanted.y, bounds.minY, bounds.maxY, top, bottom, height)] as const;
  const [x, y] = target.getViewportByCanvas([centre[0], centre[1]]);
  await target.translateBy([width / 2 - x, height / 2 - y], false);
}

/** Runs after the props of this tick are applied, so a caller can change the data and then fit or focus it. */
async function afterChanges(task: (target: Graph) => Promise<void>) {
  await nextTick();
  await enqueue(task);
}

defineExpose({
  /**
   * Shows the whole graph, no larger than `maxZoom`, keeping `padding` pixels clear (one value, or top, right, bottom,
   * left). With `minZoom` it is never shown smaller: a graph that would be is shown at `minZoom` around the node
   * `around` (its middle when absent) as far as the graph's own edges allow, and the reader pans to the rest — names
   * stay readable rather than all in view.
   */
  fit: (options: { maxZoom?: number; minZoom?: number; around?: string; padding?: number | [number, number, number, number] } = {}) =>
    afterChanges(async (target) => {
      if (options.padding !== undefined) target.setOptions({ padding: options.padding });
      await target.fitView({ when: "always", direction: "both" });
      const zoom = target.getZoom();
      if (options.maxZoom !== undefined && zoom > options.maxZoom) await target.zoomTo(options.maxZoom, false);
      else if (options.minZoom !== undefined && zoom < options.minZoom) {
        await target.zoomTo(options.minZoom, false);
        return showAround(target, options.minZoom, options.around, options.padding);
      }
      await target.fitCenter(false);
    }),
  /** Zooms by `ratio` about the middle of the view. */
  zoomBy: (ratio: number) => afterChanges((target) => target.zoomBy(ratio, false)),
  /** Zooms to `zoom` about the middle of the view. */
  zoomTo: (zoom: number) => afterChanges((target) => target.zoomTo(zoom, false)),
  /** Brings a node to the middle of the view. */
  focus: (id: string) => afterChanges((target) => target.focusElement(id, false)),
  /** Shows the graph at `zoom` with the graph point `x`/`y` at the view's top-left corner. */
  setViewport: (viewport: { x: number; y: number; zoom: number }) =>
    afterChanges(async (target) => {
      await target.zoomTo(viewport.zoom, false);
      const [x, y] = target.getViewportByCanvas([viewport.x, viewport.y]);
      await target.translateBy([-x, -y], false);
    }),
  /** Puts every node back where the layout and the nodes' own positions place it, undoing what a reader dragged. */
  relayout: () =>
    afterChanges(async (target) => {
      const positions = positionsOf(props.nodes);
      target.updateNodeData(props.nodes.map((node) => ({ id: node.id, style: { ...positions.get(node.id)! } })));
      await target.draw();
    }),
  /** Where every node is drawn now, dragged ones included; anchors are left out. Empty before the canvas is first drawn. */
  positions: (): Record<string, GraphCanvasPoint> =>
    Object.fromEntries(
      (graph?.getNodeData() ?? [])
        .filter((node) => !node.data?.anchor)
        .map((node) => [String(node.id), { x: Number(node.style!.x), y: Number(node.style!.y) }]),
    ),
  /** The view as drawn now, as a PNG on the canvas's surface colour: what to save is the caller's. */
  exportImage: () =>
    new Promise<Blob>((resolve, reject) => {
      const layers = Array.from(host.value!.querySelectorAll("canvas"));
      const output = document.createElement("canvas");
      output.width = Math.max(...layers.map((layer) => layer.width));
      output.height = Math.max(...layers.map((layer) => layer.height));
      const context = output.getContext("2d")!;
      context.fillStyle = colors.surface;
      context.fillRect(0, 0, output.width, output.height);
      for (const layer of layers) context.drawImage(layer, 0, 0, output.width, output.height);
      output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The graph could not be exported as PNG"))), "image/png");
    }),
});
</script>

<template>
  <div class="g6-graph-canvas" role="group" :aria-label="label" :style="maxHeight === undefined ? undefined : { maxHeight: `${maxHeight}px` }">
    <!-- G6 sets its container to position: relative, so it cannot be the element that takes the canvas's size. -->
    <div ref="frame" class="g6-graph-frame"><div ref="host" class="g6-graph-host" /></div>
    <!--
      Follows the colour roles where the canvas is drawn: when a mode switch changes them, the probe's colours change and
      its transition ends, and the canvas resolves its colours again. No class or attribute of the page is read for it.
    -->
    <span class="g6-theme-probe" aria-hidden="true" @transitionend="restyle" />
  </div>
</template>

<style scoped>
.g6-graph-canvas {
  position: relative;
  height: 100%;
  min-height: 0;
}
.g6-graph-frame {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.g6-graph-host {
  width: 100%;
  height: 100%;
}
.g6-theme-probe {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
  color: var(--el-text-color-primary);
  background-color: var(--chart-1);
  border-color: var(--el-color-primary);
  transition:
    color 1ms,
    background-color 1ms,
    border-color 1ms;
}
</style>
