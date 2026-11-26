<script setup lang="ts">
import type { GraphCanvasStyleOverrides } from "@ontomato/foundation-ui/graph/g6";
import type { EdgeEndsConfig } from "./object-graph-data";
import type { PendingGraphEdge } from "./object-graph-export";
import type { ObjectListRef } from "./object-list-types";
import ObjectGraphCanvas from "./ObjectGraphCanvas.vue";

/**
 * Platform-dedicated visual modeling graph canvas (`panelUsable: false`).
 *
 * Wraps the shared `ObjectGraphCanvas` / `G6GraphCanvas` engine with the visual modeling workspace's fixed layout,
 * appearance, and gestures:
 * - Top-left 4-action view toolbar (zoom in, zoom out, fit, relayout) with `#toolbar-actions` / `#toolbar-right` slots
 *   on the right, omitting focus-selected, PNG export, and the bottom-left floating toolbar.
 * - Independent node selection halo ring and capsule-shaped (pill) edge labels.
 * - Four-direction hover connection ports (top/right/bottom/left) with live drag-preview edge (alongside Shift+drag)
 *   handing endpoints to `connectFrom` / `connectTo`, plus a purely visual uncommitted pending edge while the create
 *   dialog is open.
 * - Double-click activation emitting `choose` with the real `{ className, primaryKey }` identity.
 */
withDefaults(
  defineProps<{
    /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
    edgeEnds?: EdgeEndsConfig;
    /** Categories in a fixed order: the n-th takes the platform palette's n-th colour. */
    categories?: readonly string[];
    /** JSON Pointer into each node record's `fields` naming its category; one colour when absent. */
    nodeCategory?: string;
    /** Optional subtle operation hint shown at the bottom-right corner of the canvas. */
    hint?: string;
    /** Optional explicit uncommitted visual preview edge; defaults automatically from `connectFrom` + `connectTo`. */
    pendingEdge?: PendingGraphEdge | null;
  }>(),
  { pendingEdge: null },
);

const emit = defineEmits<{
  /** Emitted when the reader explicitly activates a node or edge by double-clicking it. */
  choose: [value: ObjectListRef];
}>();

defineSlots<{
  /** Right-side toolbar actions slot (for selection status tags and edit/delete actions). */
  "toolbar-actions"?(props: {
    selectedNode: unknown;
    selectedEdge: unknown;
    selectedNodes: readonly string[];
    selectedEdges: readonly string[];
    nodeCount: number;
    edgeCount: number;
    zoom: unknown;
    zoomIn: () => unknown;
    zoomOut: () => unknown;
    fitView: () => void;
    relayout: () => void;
  }): unknown;
  /** Alias slot on the right side of the top toolbar. */
  "toolbar-right"?(props: {
    selectedNode: unknown;
    selectedEdge: unknown;
    selectedNodes: readonly string[];
    selectedEdges: readonly string[];
    nodeCount: number;
    edgeCount: number;
    zoom: unknown;
    zoomIn: () => unknown;
    zoomOut: () => unknown;
    fitView: () => void;
    relayout: () => void;
  }): unknown;
  /** Floating overlay region rendered over the graph canvas. */
  overlay?(props: {
    selectedNode: unknown;
    selectedEdge: unknown;
    pathResult: unknown;
    nodeCount: number;
    edgeCount: number;
  }): unknown;
}>();

const VISUAL_MODELING_STYLE: GraphCanvasStyleOverrides = {
  nodeLineWidth: 5,
  selectedNodeLineWidth: 6,
  selectedNodeHalo: true,
  selectedNodeHaloWidth: 12,
  nodeLabelOffsetY: 8,
  edgeLineWidth: 2,
  selectedEdgeLineWidth: 4,
  edgeLabelShape: "pill",
  edgeLabelFontSize: 12,
  edgeLabelRadius: 999,
};
</script>

<template>
  <ObjectGraphCanvas
    :edge-ends="edgeEnds"
    editable
    :categories="categories"
    :node-category="nodeCategory"
    :node-size="62"
    :label-size="13"
    :highlight-banner="false"
    :show-focus-button="false"
    :hint="hint"
    toolbar-placement="top-four"
    connect-ports
    show-pending-edge
    :pending-edge="pendingEdge"
    :style-overrides="VISUAL_MODELING_STYLE"
    @choose="emit('choose', $event)"
  >
    <template v-if="$slots['toolbar-actions']" #toolbar-actions="scope">
      <slot name="toolbar-actions" v-bind="scope"></slot>
    </template>
    <template v-if="$slots['toolbar-right']" #toolbar-right="scope">
      <slot name="toolbar-right" v-bind="scope"></slot>
    </template>
    <template v-if="$slots.overlay" #overlay="scope">
      <slot name="overlay" v-bind="scope"></slot>
    </template>
  </ObjectGraphCanvas>
</template>
