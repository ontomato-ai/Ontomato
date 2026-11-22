<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElFormItem } from "element-plus/es/components/form/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { GraphCanvas } from "@ontomato/foundation-ui/graph";
import { useFormField } from "../panel/context";
import { useGraphRecords, type EdgeEndsConfig } from "./object-graph-data";

/**
 * The graph as a form field's choice (an agent's data scope): choosing a node adds it to or removes it from the list of
 * node keys the field its member's formField port names holds; the nodes one drawn edge away from a chosen one are
 * marked, and one action adds them all. What the field means — that an empty list is the default scope, say — is its
 * owner's, in its help; who may read what the nodes stand for is decided where the data is read, never on this graph.
 */
const props = defineProps<{ edgeEnds?: EdgeEndsConfig }>();

const { t } = useI18n();
const field = useFormField();
const resolved = useGraphRecords(props.edgeEnds);

const nodes = computed(() => resolved.value.nodes);
const links = computed(() => resolved.value.links);
const loading = computed(() => resolved.value.loading);
const readError = computed(() => resolved.value.error);

const selected = computed(() => {
  const value = field.value.value;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
});
/** The nodes one drawn edge away from a chosen node, and not chosen themselves. */
const adjacent = computed(() => {
  const chosen = new Set(selected.value);
  const found = new Set<string>();
  for (const edge of links.value) {
    if (chosen.has(edge.source) && !chosen.has(edge.target)) found.add(edge.target);
    if (chosen.has(edge.target) && !chosen.has(edge.source)) found.add(edge.source);
  }
  return found;
});
const drawnNodes = computed(() =>
  nodes.value.map((node) => ({ ...node, tone: adjacent.value.has(node.id) ? ("accent" as const) : ("default" as const) })));
const drawnEdges = computed(() => {
  const marked = new Set([...selected.value, ...adjacent.value]);
  return links.value.map((edge) => ({
    ...edge,
    tone: marked.has(edge.source) && marked.has(edge.target) ? ("accent" as const) : ("default" as const),
  }));
});

function includeAdjacent() {
  field.set([...selected.value, ...adjacent.value]);
}
</script>

<template>
  <el-form-item
    v-if="field.field.value"
    class="sdk-object-graph"
    :class="{ 'sdk-object-graph-changed': field.changed.value }"
    :label="field.field.value.label"
    :error="field.error.value ?? readError ?? undefined"
    :data-field="field.field.value.path"
  >
    <el-skeleton v-if="loading" :rows="4" animated></el-skeleton>
    <template v-else-if="readError"></template>
    <el-empty v-else-if="!nodes.length" :image-size="48"></el-empty>
    <div v-else class="sdk-object-graph-body">
      <!-- The choice summed up; what an empty one means is the owner's, in the field's help. -->
      <p class="sdk-object-graph-summary">
        {{ selected.length ? t("platform.graphChosenCount", { count: selected.length }) : t("platform.graphChosenNone") }}
      </p>
      <GraphCanvas
        :label="field.field.value.label"
        :nodes="drawnNodes"
        :edges="drawnEdges"
        :selected="selected"
        :selection="field.disabled.value ? 'none' : 'multiple'"
        @update:selected="field.set($event)"
      ></GraphCanvas>
      <el-button
        class="sdk-object-graph-adjacent"
        :disabled="field.disabled.value || adjacent.size === 0"
        @click="includeAdjacent"
      >{{ t("platform.graphIncludeAdjacent", { count: adjacent.size }) }}</el-button>
      <!-- The three looks the graph draws, named as the agent settings page named them. -->
      <div class="sdk-object-graph-legend">
        <span><i class="chosen"></i>{{ t("platform.graphLegendChosen") }}</span>
        <span><i class="adjacent"></i>{{ t("platform.graphLegendAdjacent") }}</span>
        <span><i></i>{{ t("platform.graphLegendOther") }}</span>
      </div>
      <!-- The same choice by name, for a reader who would rather pick from a list than on the graph. -->
      <el-select
        class="sdk-object-graph-list"
        :model-value="selected"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        clearable
        :max-collapse-tags="4"
        :disabled="field.disabled.value"
        :aria-label="field.field.value.label"
        :placeholder="t('platform.graphChosenNone')"
        @update:model-value="field.set($event)"
      >
        <el-option v-for="node in nodes" :key="node.id" :label="node.label" :value="node.id"></el-option>
      </el-select>
    </div>
    <p v-if="field.field.value.readOnly && field.field.value.readOnlyReason" class="sdk-object-graph-help">
      {{ field.field.value.readOnlyReason }}
    </p>
    <p v-else-if="field.field.value.help" class="sdk-object-graph-help">{{ field.field.value.help }}</p>
  </el-form-item>
</template>

<style scoped>
.sdk-object-graph {
  display: block;
}
.sdk-object-graph-summary {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.sdk-object-graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-object-graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}
/* The swatches draw as the graph's own nodes do: plain, adjacent (light, dashed) and chosen (filled). */
.sdk-object-graph-legend i {
  width: 10px;
  height: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
  background: var(--el-bg-color);
}
.sdk-object-graph-legend i.adjacent {
  border-style: dashed;
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.sdk-object-graph-legend i.chosen {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
}
.sdk-object-graph-list {
  width: 100%;
}
.sdk-object-graph-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  width: 100%;
}
.sdk-object-graph-adjacent {
  align-self: flex-start;
}
.sdk-object-graph-changed :deep(.el-form-item__label) {
  color: var(--brand-link);
}
.sdk-object-graph-help {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: var(--spacing-xs) 0 0;
}
</style>
