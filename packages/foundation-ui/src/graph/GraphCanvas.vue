<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { MARGIN, NODE_HEIGHT, NODE_WIDTH, placeNodes, shownLabel } from "./layout";
import type {
  GraphCanvasEdge,
  GraphCanvasLayout,
  GraphCanvasNode,
  GraphCanvasSelection,
  GraphCanvasViewport,
} from "./types";

/**
 * A graph a reader looks at and chooses nodes on: the nodes and edges it is given, drawn as SVG, each node marked by its
 * tone and by whether it is selected. Choosing a node hands back the selection that results; scrolling or resizing
 * hands back what part of the graph is in view. It reads nothing, decides nothing about what a node means and keeps no
 * selection of its own: the caller passes `selected` and writes back what the canvas hands it.
 */
const props = withDefaults(
  defineProps<{
    /** The graph's accessible name: what a screen reader announces for the whole drawing. */
    label: string;
    /** The nodes to draw, each with its ID, its label and the tone its caller gives it; `grid` places them in this order. */
    nodes: readonly GraphCanvasNode[];
    /** The edges between the nodes; one that names a node not given is not drawn. */
    edges?: readonly GraphCanvasEdge[];
    /** The IDs of the chosen nodes, drawn as selected. */
    selected?: readonly string[];
    /** How a reader chooses: `none` draws only, `single` keeps at most one node, `multiple` adds and removes one at a time. */
    selection?: GraphCanvasSelection;
    /** Where the nodes go: `grid` in the given order, `preset` at each node's `x`/`y`. */
    layout?: GraphCanvasLayout;
    /** The tallest the canvas grows, in pixels, before it scrolls. */
    maxHeight?: number;
  }>(),
  { edges: () => [], selected: () => [], selection: "single", layout: () => ({ type: "grid" }), maxHeight: 420 },
);
const emit = defineEmits<{
  /** The selection a reader's choice results in: every chosen ID, in the order they were chosen. */
  "update:selected": [ids: string[]];
  /** The part of the graph in view, after the canvas is drawn and whenever the reader scrolls or it is resized. */
  viewport: [viewport: GraphCanvasViewport];
}>();

const placed = computed(() => placeNodes(props.nodes, props.layout));
const chosen = computed(() => new Set(props.selected));
const width = computed(() => Math.max(NODE_WIDTH + MARGIN * 2, ...placed.value.map((node) => node.x + NODE_WIDTH + MARGIN)));
const height = computed(() => Math.max(NODE_HEIGHT + MARGIN * 2, ...placed.value.map((node) => node.y + NODE_HEIGHT + MARGIN)));
const lines = computed(() => {
  const at = new Map(placed.value.map((node) => [node.id, node]));
  return props.edges.flatMap((edge) => {
    const source = at.get(edge.source);
    const target = at.get(edge.target);
    if (!source || !target) return [];
    return [{
      id: edge.id,
      tone: edge.tone ?? "default",
      x1: source.x + NODE_WIDTH / 2,
      y1: source.y + NODE_HEIGHT / 2,
      x2: target.x + NODE_WIDTH / 2,
      y2: target.y + NODE_HEIGHT / 2,
    }];
  });
});

function choose(id: string) {
  if (props.selection === "none") return;
  if (props.selection === "single") {
    emit("update:selected", chosen.value.has(id) ? [] : [id]);
    return;
  }
  emit("update:selected", chosen.value.has(id) ? props.selected.filter((item) => item !== id) : [...props.selected, id]);
}

const scroller = ref<HTMLElement | null>(null);
function reportViewport() {
  const element = scroller.value!;
  emit("viewport", { x: element.scrollLeft, y: element.scrollTop, width: element.clientWidth, height: element.clientHeight, zoom: 1 });
}
let resized: ResizeObserver | undefined;
onMounted(() => {
  reportViewport();
  resized = new ResizeObserver(reportViewport);
  resized.observe(scroller.value!);
});
onBeforeUnmount(() => resized?.disconnect());
</script>

<template>
  <div ref="scroller" class="graph-canvas" :style="{ maxHeight: `${Math.min(height, maxHeight)}px` }" @scroll.passive="reportViewport">
    <svg :width="width" :height="height" role="group" :aria-label="label">
      <line
        v-for="line in lines"
        :key="line.id"
        class="graph-edge"
        :class="line.tone"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
      />
      <g
        v-for="node in placed"
        :key="node.id"
        class="graph-node"
        :class="[node.tone ?? 'default', { selected: chosen.has(node.id), choosable: selection !== 'none' }]"
        :data-node-id="node.id"
        :role="selection === 'none' ? undefined : 'button'"
        :tabindex="selection === 'none' ? undefined : 0"
        :aria-pressed="selection === 'none' ? undefined : chosen.has(node.id)"
        :aria-label="node.title ?? node.label"
        @click="choose(node.id)"
        @keydown.enter.prevent="choose(node.id)"
        @keydown.space.prevent="choose(node.id)"
      >
        <title>{{ node.title ?? node.label }}</title>
        <rect :x="node.x" :y="node.y" :width="NODE_WIDTH" :height="NODE_HEIGHT" rx="10" />
        <text :x="node.x + NODE_WIDTH / 2" :y="node.y + NODE_HEIGHT / 2 + 4" text-anchor="middle">{{ shownLabel(node.label) }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/*
 * Node labels are at least 12px, and the three looks — plain, accent and selected — differ by fill and border weight as
 * well as colour, so they stay apart in both modes.
 */
.graph-canvas {
  overflow: auto;
  border-radius: var(--radius-sm);
}
.graph-canvas svg {
  display: block;
}
.graph-edge {
  stroke: var(--el-border-color);
  stroke-width: 1.5;
  opacity: 0.7;
}
.graph-edge.accent {
  stroke: var(--el-color-primary-light-5);
  opacity: 1;
  stroke-width: 2;
}
.graph-node {
  outline: none;
}
.graph-node.choosable {
  cursor: pointer;
}
.graph-node rect {
  fill: var(--el-bg-color);
  stroke: var(--el-border-color);
  stroke-width: 1;
  transition:
    fill var(--transition-fast),
    stroke var(--transition-fast);
}
.graph-node text {
  fill: var(--el-text-color-regular);
  font-size: 12px;
  pointer-events: none;
}
/* Accent: filled but lighter, and a dashed border, so it reads apart from both other looks in dark mode too. */
.graph-node.accent rect {
  fill: var(--el-color-primary-light-9);
  stroke: var(--el-color-primary-light-5);
  stroke-dasharray: 4 3;
}
.graph-node.selected rect {
  fill: var(--el-color-primary);
  stroke: var(--el-color-primary);
  stroke-width: 2;
  stroke-dasharray: none;
}
.graph-node.selected text {
  fill: var(--on-primary);
  font-weight: 600;
}
.graph-node:focus-visible rect {
  stroke: var(--el-color-primary);
  stroke-width: 3;
}
.graph-node.choosable:hover rect {
  stroke: var(--el-text-color-secondary);
}
</style>
