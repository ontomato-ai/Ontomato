<script setup lang="ts">
import { computed } from "vue";
import { usePanelContext } from "../panel/context";
import { useMember } from "../panel/member";
import type { EdgeEndsConfig } from "./object-graph-data";
import ObjectGraphCanvas from "./ObjectGraphCanvas.vue";
import ObjectGraphField from "./ObjectGraphField.vue";

/**
 * Objects of one type as a graph, joined by the objects of another (classes joined by their relationships): the member's
 * `nodes` and `edges` datums (`panelRecordList`), with `config.edgeEnds` (`source`, `target`) pointing to the node keys
 * inside each edge's fields. A member whose formField port names a form field chooses that field's list of node keys
 * on it (an agent's data scope); any other member is the page's graph canvas, shared by the ontology graph and visual
 * modeling (see ObjectGraphCanvas).
 */
withDefaults(defineProps<{
  /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
  edgeEnds?: EdgeEndsConfig;
  /** On the page's canvas, a line drawn with Shift from one node to another hands the panel its two ends. */
  editable?: boolean;
}>(), { editable: undefined });

const panel = usePanelContext();
const member = useMember();
const choosesField = computed(() => panel.manifest.members[member.key]?.formField !== undefined);
</script>

<template>
  <ObjectGraphField v-if="choosesField" :edge-ends="edgeEnds"></ObjectGraphField>
  <ObjectGraphCanvas v-else :edge-ends="edgeEnds" :editable="editable"></ObjectGraphCanvas>
</template>
