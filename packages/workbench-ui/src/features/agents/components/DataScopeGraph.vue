<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
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

/*
 * The graph is drawn at its natural size and clipped by a scroll area instead of being scaled to fit: a fitted drawing
 * shrank the node names to a few pixels. Node labels are at least 12px, and the three states differ by fill and border
 * weight as well as colour, so they stay apart in both modes.
 */
const NODE_WIDTH = 152;
const NODE_HEIGHT = 44;
const COLUMN_GAP = 24;
const ROW_GAP = 20;
const MARGIN = 16;

const columns = computed(() => Math.max(1, Math.ceil(Math.sqrt(props.classes.length / 1.4))));
const nodes = computed(() =>
  props.classes.map((item, index) => ({
    ...item,
    x: MARGIN + (index % columns.value) * (NODE_WIDTH + COLUMN_GAP),
    y: MARGIN + Math.floor(index / columns.value) * (NODE_HEIGHT + ROW_GAP),
  })),
);
const width = computed(
  () => Math.max(NODE_WIDTH + MARGIN * 2, ...nodes.value.map((node) => node.x + NODE_WIDTH + MARGIN)),
);
const height = computed(
  () => Math.max(NODE_HEIGHT + MARGIN * 2, ...nodes.value.map((node) => node.y + NODE_HEIGHT + MARGIN)),
);
const edges = computed(() => {
  const position = new Map(nodes.value.map((node) => [node.className, node]));
  return props.relations.flatMap((relation) => {
    const from = position.get(relation.from);
    const to = position.get(relation.to);
    if (!from || !to) return [];
    return [
      {
        key: `${relation.from}-${relation.to}`,
        x1: from.x + NODE_WIDTH / 2,
        y1: from.y + NODE_HEIGHT / 2,
        x2: to.x + NODE_WIDTH / 2,
        y2: to.y + NODE_HEIGHT / 2,
        active: scopeState(relation.from) !== "other" && scopeState(relation.to) !== "other",
      },
    ];
  });
});

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
      </div>
      <el-skeleton v-if="loading" :rows="4" animated />
      <el-empty v-else-if="!nodes.length" :image-size="60" :description="t('agents.dataScopeNoClasses')" />
      <template v-else>
        <div class="graph-canvas" :style="{ maxHeight: `${Math.min(height, 420)}px` }">
          <svg :width="width" :height="height" role="group" :aria-label="t('agents.dataScopeGraph')">
            <line
              v-for="edge in edges"
              :key="edge.key"
              class="graph-edge"
              :class="{ active: edge.active }"
              :x1="edge.x1"
              :y1="edge.y1"
              :x2="edge.x2"
              :y2="edge.y2"
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
              <rect :x="node.x" :y="node.y" :width="NODE_WIDTH" :height="NODE_HEIGHT" rx="10" />
              <text :x="node.x + NODE_WIDTH / 2" :y="node.y + NODE_HEIGHT / 2 + 4" text-anchor="middle">
                {{ (node.showName || node.className).length > 16 ? `${(node.showName || node.className).slice(0, 15)}…` : node.showName || node.className }}
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
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-blank);
}
.scope-disclosure {
  cursor: pointer;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.scope-disclosure span { margin-inline-start: var(--spacing-md); color: var(--el-text-color-secondary); font-weight: var(--font-normal); }
.scope-graph[open] > .graph-toolbar { margin-top: var(--spacing-lg); }
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
.graph-edge.active {
  stroke: var(--el-color-primary-light-5);
  opacity: 1;
  stroke-width: 2;
}
.graph-node {
  cursor: pointer;
  outline: none;
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
/* Adjacent: filled but lighter, and a dashed border, so it reads apart from both other states in dark mode too. */
.graph-node.adjacent rect {
  fill: var(--el-color-primary-light-9);
  stroke: var(--el-color-primary-light-5);
  stroke-dasharray: 4 3;
}
.graph-node.chosen rect {
  fill: var(--el-color-primary);
  stroke: var(--el-color-primary);
  stroke-width: 2;
}
.graph-node.chosen text {
  fill: var(--on-primary);
  font-weight: 600;
}
.graph-node:focus-visible rect {
  stroke: var(--el-color-primary);
  stroke-width: 3;
}
.graph-node:hover rect {
  stroke: var(--el-text-color-secondary);
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
