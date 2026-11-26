<script setup lang="ts">
import { computed } from "vue";
import { useFormFieldSlot } from "../panel/slot-context";
import type { EdgeEndsConfig } from "./object-graph-data";
import type { ObjectListRef } from "./object-list-types";
import ObjectGraphCanvas from "./ObjectGraphCanvas.vue";
import ObjectGraphField from "./ObjectGraphField.vue";

/**
 * Objects of one type as a graph, joined by the objects of another (classes joined by their relationships): the member's
 * `nodes` and `edges` datums (`panelRecordList`), with `config.edgeEnds` (`source`, `target`) pointing to the node keys
 * inside each edge's fields. When placed inside an `ObjectForm` field slot (`#field-<path>` or `#field`), it renders
 * `ObjectGraphField` in place to choose that field's list of node keys; otherwise it renders the interactive
 * `ObjectGraphCanvas` (with `#toolbar` and `#overlay` Vue slots).
 */
withDefaults(defineProps<{
  /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
  edgeEnds?: EdgeEndsConfig;
  /** On the page's canvas, a line drawn with Shift from one node to another hands the panel its two ends. */
  editable?: boolean;
  /** On the page's canvas, the categories in a fixed order: the n-th takes the platform palette's n-th colour. */
  categories?: readonly string[];
  /** On the page's canvas, a JSON Pointer into each node record's `fields` naming its category; one colour when absent. */
  nodeCategory?: string;
  /** Automatic placement algorithm for unplaced nodes: column-based `relations` (default) or radial `force`. */
  layout?: "relations" | "force";
  /** Optional subtle operation hint shown at the bottom-right corner of the canvas. */
  hint?: string;
}>(), { editable: undefined });

const emit = defineEmits<{
  /** Emitted when the reader explicitly activates a node or edge by double-clicking it. */
  choose: [value: ObjectListRef];
}>();

const fieldSlot = useFormFieldSlot();
const choosesField = computed(() => fieldSlot !== null);

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
  /** Floating overlay region rendered over the graph canvas (for legends, path cards, or inspector chips). */
  overlay?(props: {
    selectedNode: unknown;
    selectedEdge: unknown;
    pathResult: unknown;
    nodeCount: number;
    edgeCount: number;
  }): unknown;
}>();
</script>

<template>
  <ObjectGraphField v-if="choosesField" :edge-ends="edgeEnds"></ObjectGraphField>
  <ObjectGraphCanvas
    v-else
    :edge-ends="edgeEnds"
    :editable="editable"
    :categories="categories"
    :node-category="nodeCategory"
    :layout="layout"
    :hint="hint"
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
