<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-vue-next";
import type { ObjectClassOption, ObjectRelationOption } from "../api";

/**
 * The data scope of one agent, chosen on the ontology graph (as the original agent creation dialog did): clicking an
 * object type selects it, and the object types one relation away from a selected one are shown as adjacent, so that
 * "include the adjacent object types" can add them to the scope. The saved value is the class-name list either way
 * (`classNames`); nothing selected means the whole ontology. The list below is the fallback view over the same choice.
 */
const props = defineProps<{
  modelValue: string[];
  classes: ObjectClassOption[];
  relations: ObjectRelationOption[];
  loading: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const { t } = useI18n();

const includeAdjacent = ref(false);
const zoom = ref(1);

/** The saved list itself: the object types the user picked (and, while the checkbox is on, their adjacent ones). */
const chosen = computed(() => new Set(props.modelValue));

const neighbours = computed(() => {
  const map = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const current = map.get(from) ?? new Set<string>();
    current.add(to);
    map.set(from, current);
  };
  for (const relation of props.relations) {
    link(relation.from, relation.to);
    link(relation.to, relation.from);
  }
  return map;
});

/** Object types one relation away from a chosen one and not chosen themselves. */
const adjacent = computed(() => {
  const result = new Set<string>();
  for (const name of chosen.value) {
    for (const neighbour of neighbours.value.get(name) ?? []) {
      if (!chosen.value.has(neighbour)) result.add(neighbour);
    }
  }
  return result;
});

function scopeState(className: string): "chosen" | "adjacent" | "other" {
  if (chosen.value.has(className)) return "chosen";
  return adjacent.value.has(className) ? "adjacent" : "other";
}

/** Selecting adds one object type, deselecting removes it. */
function toggle(className: string) {
  const next = new Set(chosen.value);
  if (next.has(className)) {
    next.delete(className);
    includeAdjacent.value = false;
  } else next.add(className);
  emit("update:modelValue", [...next]);
}

/** The list view edits the same class-name list; the graph then shows the result. */
function selectList(value: string[]) {
  includeAdjacent.value = false;
  emit("update:modelValue", [...value]);
}

/** Including the adjacent object types writes them into the same list, so the saved value stays one class-name list. */
function includeAdjacentChanged(value: boolean) {
  if (!value) {
    includeAdjacent.value = false;
    return;
  }
  const next = new Set([...chosen.value, ...adjacent.value]);
  includeAdjacent.value = true;
  emit("update:modelValue", [...next]);
}

const newNodeSize = 132;
const columns = computed(() => Math.max(1, Math.ceil(Math.sqrt(props.classes.length))));
const nodes = computed(() =>
  props.classes.map((item, index) => ({
    ...item,
    x: 40 + (index % columns.value) * (newNodeSize + 44) + newNodeSize / 2,
    y: 40 + Math.floor(index / columns.value) * (newNodeSize + 56) + newNodeSize / 2,
  })),
);
const width = computed(() => Math.max(320, ...nodes.value.map((node) => node.x + newNodeSize)));
const height = computed(() => Math.max(200, ...nodes.value.map((node) => node.y + 60)));
const viewBox = computed(() => {
  const viewWidth = width.value / zoom.value;
  const viewHeight = height.value / zoom.value;
  return `${(width.value - viewWidth) / 2} ${(height.value - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
});
const edges = computed(() => {
  const position = new Map(nodes.value.map((node) => [node.className, node]));
  return props.relations.flatMap((relation) => {
    const from = position.get(relation.from);
    const to = position.get(relation.to);
    return from && to ? [{ key: `${relation.from}-${relation.to}`, from, to }] : [];
  });
});

function zoomBy(delta: number) {
  zoom.value = Math.min(2.5, Math.max(0.75, Number((zoom.value + delta).toFixed(2))));
}

function labelOf(cls: ObjectClassOption) {
  const name = cls.showName || cls.classDesc || cls.className;
  return name === cls.className ? cls.className : `${name} (${cls.className})`;
}

const summary = computed(() =>
  props.modelValue.length === 0
    ? t("agents.dataScopeAll")
    : t("agents.dataScopeCount", { count: props.modelValue.length }),
);
</script>

<template>
  <div class="data-scope">
    <div class="scope-graph">
      <div class="graph-toolbar">
        <span class="graph-summary">{{ summary }}</span>
        <div class="graph-actions">
          <button type="button" :title="t('agents.dataScopeZoomIn')" :aria-label="t('agents.dataScopeZoomIn')" @click="zoomBy(0.25)">
            <ZoomIn :size="15" />
          </button>
          <button type="button" :title="t('agents.dataScopeZoomOut')" :aria-label="t('agents.dataScopeZoomOut')" @click="zoomBy(-0.25)">
            <ZoomOut :size="15" />
          </button>
          <button type="button" :title="t('agents.dataScopeReset')" :aria-label="t('agents.dataScopeReset')" @click="zoom = 1">
            <Maximize2 :size="15" />
          </button>
        </div>
      </div>
      <el-skeleton v-if="loading" :rows="4" animated />
      <el-empty v-else-if="!nodes.length" :image-size="60" :description="t('agents.dataScopeNoClasses')" />
      <template v-else>
        <div class="graph-canvas">
          <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="group" :aria-label="t('agents.dataScopeGraph')">
            <line
              v-for="edge in edges"
              :key="edge.key"
              class="graph-edge"
              :class="{
                active:
                  (scopeState(edge.from.className) !== 'other' && scopeState(edge.to.className) !== 'other'),
              }"
              :x1="edge.from.x"
              :y1="edge.from.y"
              :x2="edge.to.x"
              :y2="edge.to.y"
            />
            <g
              v-for="node in nodes"
              :key="node.className"
              class="graph-node"
              :class="scopeState(node.className)"
              role="button"
              :tabindex="0"
              :aria-pressed="chosen.has(node.className)"
              :aria-label="labelOf(node)"
              @click="toggle(node.className)"
              @keydown.enter.prevent="toggle(node.className)"
              @keydown.space.prevent="toggle(node.className)"
            >
              <title>{{ labelOf(node) }}</title>
              <circle :cx="node.x" :cy="node.y" :r="newNodeSize / 2" />
              <text :x="node.x" :y="node.y + 4" text-anchor="middle">
                {{ (node.showName || node.className).length > 14 ? `${(node.showName || node.className).slice(0, 13)}…` : node.showName || node.className }}
              </text>
            </g>
          </svg>
        </div>
        <div class="graph-legend">
          <span><i class="chosen" />{{ t("agents.dataScopeChosen") }}</span>
          <span><i class="adjacent" />{{ t("agents.dataScopeAdjacent") }}</span>
          <span><i />{{ t("agents.dataScopeExcluded") }}</span>
        </div>
        <el-checkbox
          :model-value="includeAdjacent"
          :disabled="chosen.size === 0"
          class="adjacent-choice"
          @update:model-value="includeAdjacentChanged"
        >
          {{ t("agents.dataScopeIncludeAdjacent") }}
        </el-checkbox>
      </template>
    </div>
    <el-form-item :label="t('agents.dataScopeList')">
      <el-select
        :model-value="props.modelValue"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        clearable
        :max-collapse-tags="4"
        :loading="loading"
        :placeholder="t('agents.dataScopeAll')"
        class="full"
        @update:model-value="selectList"
      >        <el-option v-for="cls in classes" :key="cls.className" :label="labelOf(cls)" :value="cls.className" />
      </el-select>
      <p class="form-tip">{{ t("agents.relatedClassesHint") }}</p>
    </el-form-item>
  </div>
</template>

<style scoped>
.data-scope {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.scope-graph {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
}
.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.graph-summary {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.graph-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.graph-actions button {
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  padding: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.graph-actions button:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}
.graph-actions button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.graph-canvas svg {
  display: block;
  width: 100%;
  height: 320px;
}
.graph-edge {
  stroke: var(--el-border-color);
  stroke-width: 1.5;
  opacity: 0.7;
}
.graph-edge.active {
  stroke: var(--el-color-primary-light-5);
  opacity: 1;
}
.graph-node {
  cursor: pointer;
  outline: none;
}
.graph-node circle {
  fill: var(--el-bg-color);
  stroke: var(--el-border-color);
  stroke-width: 1.5;
  transition: fill var(--transition-fast), stroke var(--transition-fast);
}
.graph-node text {
  fill: var(--el-text-color-regular);
  font-size: 11px;
  pointer-events: none;
}
.graph-node.adjacent circle {
  fill: var(--el-color-primary-light-9);
  stroke: var(--el-color-primary-light-5);
}
.graph-node.chosen circle {
  fill: var(--el-color-primary);
  stroke: var(--el-color-primary);
}
.graph-node.chosen text {
  fill: var(--el-bg-color);
  font-weight: 600;
}
.graph-node:focus-visible circle {
  stroke: var(--el-color-primary);
  stroke-width: 3;
}
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.graph-legend i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.graph-legend i.chosen {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
.graph-legend i.adjacent {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}
.adjacent-choice {
  align-self: flex-start;
}
.full {
  width: 100%;
}
.form-tip {
  flex-basis: 100%;
  margin: 6px 0 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
