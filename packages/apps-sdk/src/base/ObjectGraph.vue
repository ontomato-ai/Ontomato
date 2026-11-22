<script setup lang="ts">
import { computed, defineComponent, h, inject, onBeforeUnmount, provide } from "vue";
import { projectionKey, usePanelContext, useProjectionSlot } from "../panel/context";
import { panelMemberKey, useMember } from "../panel/member";
import { fieldControlKey, fieldControlsOf } from "./form-controls";
import type { EdgeEndsConfig } from "./object-graph-data";
import ObjectGraphCanvas from "./ObjectGraphCanvas.vue";
import ObjectGraphField from "./ObjectGraphField.vue";

/**
 * Objects of one type as a graph, joined by the objects of another (classes joined by their relationships): the member's
 * `nodes` and `edges` datums (`panelRecordList`), with `config.edgeEnds` (`source`, `target`) pointing to the node keys
 * inside each edge's fields. A member whose formField port names a form field chooses that field's list of node keys
 * on it (an agent's data scope); any other member is the page's graph canvas, shared by the ontology graph and visual
 * modeling (see ObjectGraphCanvas). The field's choice is drawn by its form, where the field is.
 */
const props = withDefaults(defineProps<{
  /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
  edgeEnds?: EdgeEndsConfig;
  /** On the page's canvas, a line drawn with Shift from one node to another hands the panel its two ends. */
  editable?: boolean;
  /** On the page's canvas, the categories in a fixed order: the n-th takes the platform palette's n-th colour. */
  categories?: readonly string[];
  /** On the page's canvas, a JSON Pointer into each node record's `fields` naming its category; one colour when absent. */
  nodeCategory?: string;
  /** On the page's canvas, each node's diameter in screen pixels; the platform's own when absent. */
  nodeSize?: number;
  /** On the page's canvas, the size of each node's name in screen pixels; the platform's own when absent. */
  labelSize?: number;
}>(), { editable: undefined });

const panel = usePanelContext();
const member = useMember();
const slot = useProjectionSlot();
const memberContext = inject(panelMemberKey, null);
const port = panel.manifest.members[member.key]?.formField;
const choosesField = computed(() => port !== undefined);

// Choosing a form's field, the graph is drawn by the form where the field is, under this projection's slot and member.
if (port) {
  const Field = defineComponent({
    setup() {
      provide(projectionKey, slot);
      if (memberContext) provide(panelMemberKey, memberContext);
      return () => h(ObjectGraphField, { edgeEnds: props.edgeEnds });
    },
  });
  const controls = fieldControlsOf(panel.instance);
  const key = fieldControlKey(port.slot, port.path, port.itemPath);
  controls.set(key, Field);
  onBeforeUnmount(() => controls.delete(key));
}
</script>

<template>
  <!-- Choosing a form's field, the graph is drawn by the form, where the field is. -->
  <ObjectGraphCanvas v-if="!choosesField" :edge-ends="edgeEnds" :editable="editable" :categories="categories" :node-category="nodeCategory" :node-size="nodeSize" :label-size="labelSize"></ObjectGraphCanvas>
</template>
