<script setup lang="ts">
import type { GraphCanvasStyleOverrides } from "@ontomato/foundation-ui/graph/g6";
import type { EdgeEndsConfig } from "./object-graph-data";
import type { ObjectListRef } from "./object-list-types";
import ObjectGraphCanvas from "./ObjectGraphCanvas.vue";

/**
 * Platform-dedicated ontology model graph canvas (`panelUsable: false`).
 *
 * Wraps the shared `ObjectGraphCanvas` / `G6GraphCanvas` engine with the ontology graph's fixed visual language:
 * 62px nodes with 5px strokes and subtle shadow, stronger highlighted/selected strokes (6px selected, 7px path/neighbor
 * nodes, 4px path/selected edges), exact non-matching dimming (`0.16` nodes / `0.12` edges), radial force layout,
 * and PNG export composited onto a solid page background with a dated `ontology-graph-YYYY-MM-DD.png` filename.
 */
defineProps<{
  /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
  edgeEnds?: EdgeEndsConfig;
  /** Categories in a fixed order: the n-th takes the platform palette's n-th colour. */
  categories?: readonly string[];
  /** JSON Pointer into each node record's `fields` naming its category; one colour when absent. */
  nodeCategory?: string;
  /** The names the legend gives the categories, by category; any other category is named by its own value. */
  categoryLabels?: Readonly<Record<string, string>>;
  /** JSON Pointer into each edge record's `fields` naming the one that draws the edge dashed when it holds `true`. */
  edgeDashedField?: string;
  /** Offers the categories as a legend the reader clicks to hide and show them. */
  showCategoryLegend?: boolean;
  /** Optional subtle operation hint shown at the bottom-right corner of the canvas. */
  hint?: string;
}>();

const emit = defineEmits<{
  /** Emitted when the reader explicitly activates a node or edge by double-clicking it. */
  choose: [value: ObjectListRef];
}>();

defineSlots<{
  /** Extra controls appended to the floating canvas toolbar. */
  toolbar?(props: {
    zoom: unknown;
    zoomIn: () => unknown;
    zoomOut: () => unknown;
    fitView: () => void;
    relayout: () => void;
    exportPng: () => void;
    selectedNodes: readonly string[];
    selectedEdges: readonly string[];
    nodeCount: number;
    edgeCount: number;
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

const ONTOLOGY_MODEL_STYLE: GraphCanvasStyleOverrides = {
  nodeLineWidth: 5,
  highlightedNodeLineWidth: 7,
  selectedNodeLineWidth: 6,
  nodeShadowBlur: 12,
  nodeLabelOffsetY: 8,
  mutedNodeOpacity: 0.16,
  edgeLineWidth: 2,
  highlightedEdgeLineWidth: 4,
  selectedEdgeLineWidth: 4,
  mutedEdgeOpacity: 0.12,
  edgeLabelShape: "plain",
  edgeLabelFontSize: 11,
  edgeLabelRadius: 4,
};
</script>

<template>
  <ObjectGraphCanvas
    :edge-ends="edgeEnds"
    :categories="categories"
    :node-category="nodeCategory"
    :category-labels="categoryLabels"
    :edge-dashed-field="edgeDashedField"
    :show-category-legend="showCategoryLegend"
    :node-size="62"
    :label-size="13"
    layout="force"
    :highlight-banner="false"
    :show-focus-button="false"
    :hint="hint"
    export-background="var(--el-bg-color-page)"
    export-filename="ontology-graph-{date}.png"
    :style-overrides="ONTOLOGY_MODEL_STYLE"
    @choose="emit('choose', $event)"
  >
    <template v-if="$slots.toolbar" #toolbar="scope">
      <slot name="toolbar" v-bind="scope"></slot>
    </template>
    <template v-if="$slots.overlay" #overlay="scope">
      <slot name="overlay" v-bind="scope"></slot>
    </template>
  </ObjectGraphCanvas>
</template>
