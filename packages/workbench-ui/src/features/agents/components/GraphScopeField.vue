<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LayoutPanelLeft, LayoutPanelTop, Maximize, ZoomIn, ZoomOut } from "lucide-vue-next";
import type { ObjectClassOption, OntologyRelationOption } from "../api";

/** Graph scope of an agent: panorama, or a subgraph picked by root classes and depth on the class graph. */
const props = defineProps<{
  classes: ObjectClassOption[];
  relations: OntologyRelationOption[];
  loading: boolean;
}>();
const mode = defineModel<"panorama" | "subgraph">("mode", { required: true });
const roots = defineModel<string[]>("roots", { required: true });
const depth = defineModel<number | undefined>("depth", { required: true });
const { t } = useI18n();

const scopeGraphEdges = computed(() => {
  const names = new Set(props.classes.map((item) => item.className));
  const seen = new Set<string>();
  return props.relations.flatMap((relation) => {
    const from = String(relation.fromclass || "").trim();
    const to = String(relation.toclass || "").trim();
    if (!names.has(from) || !names.has(to) || from === to) return [];
    const key = `${from}->${to}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ from, to }];
  });
});
const scopeGraphLayers = computed(() => {
  const remaining = new Set(props.classes.map((item) => item.className));
  const layers: string[][] = [];
  while (remaining.size) {
    const layer = [...remaining].filter((name) =>
      !scopeGraphEdges.value.some((edge) => edge.to === name && remaining.has(edge.from))
    );
    if (!layer.length) layer.push([...remaining][0]);
    layer.forEach((name) => remaining.delete(name));
    layers.push(layer);
  }
  return layers;
});
type ScopeGraphOrientation = "horizontal" | "vertical";
const scopeGraphOrientation = ref<ScopeGraphOrientation | null>(null);
function buildScopeGraphLayout(orientation: ScopeGraphOrientation) {
  const layers = scopeGraphLayers.value;
  const maxCount = Math.max(1, ...layers.map((layer) => layer.length));
  const classes = new Map(props.classes.map((item) => [item.className, item]));
  const layerGap = 220;
  const rowGap = orientation === "horizontal" ? 76 : 100;
  const left = 110;
  const top = 54;
  const nodes = layers.flatMap((layer, layerIndex) => {
    const offset = ((maxCount - layer.length) * rowGap) / 2;
    return layer.flatMap((name, index) => {
      const item = classes.get(name);
      if (!item) return [];
      const along = offset + index * rowGap;
      const across = layerIndex * layerGap;
      return [{
        ...item,
        x: orientation === "horizontal" ? left + across : left + along,
        y: orientation === "horizontal" ? top + along : top + across,
      }];
    });
  });
  const width = orientation === "horizontal"
    ? left + (layers.length - 1) * layerGap + 105
    : left + (maxCount - 1) * rowGap + 105;
  const height = orientation === "horizontal"
    ? top + (maxCount - 1) * rowGap + 60
    : top + (layers.length - 1) * layerGap + 60;
  return { nodes, width: Math.max(300, width), height: Math.max(160, height) };
}
const scopeGraphLayouts = computed(() => ({
  horizontal: buildScopeGraphLayout("horizontal"),
  vertical: buildScopeGraphLayout("vertical"),
}));
const scopeGraphAutoOrientation = computed<ScopeGraphOrientation>(() => {
  const { horizontal, vertical } = scopeGraphLayouts.value;
  return vertical.width / vertical.height > horizontal.width / horizontal.height ? "vertical" : "horizontal";
});
const scopeGraphEffectiveOrientation = computed<ScopeGraphOrientation>(() =>
  scopeGraphOrientation.value ?? scopeGraphAutoOrientation.value
);
const scopeReachableClasses = computed(() => {
  if (mode.value !== "subgraph") return new Set(props.classes.map(item => item.className));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of scopeGraphEdges.value) {
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const values = adjacency.get(from) || new Set<string>();
      values.add(to); adjacency.set(from, values);
    }
  }
  const result = new Set(roots.value);
  let frontier = new Set(result);
  for (let level = 0; level < (depth.value || 0); level++) {
    const next = new Set<string>();
    frontier.forEach((name) => adjacency.get(name)?.forEach((neighbor) => {
      if (!result.has(neighbor)) { result.add(neighbor); next.add(neighbor); }
    }));
    frontier = next;
  }
  return result;
});
const scopeGraphNodes = computed(() => scopeGraphLayouts.value[scopeGraphEffectiveOrientation.value].nodes);
const scopeGraphWidth = computed(() => scopeGraphLayouts.value[scopeGraphEffectiveOrientation.value].width);
const scopeGraphHeight = computed(() => scopeGraphLayouts.value[scopeGraphEffectiveOrientation.value].height);
const scopeGraphSvgHeight = computed(() => Math.min(560, Math.max(320, scopeGraphHeight.value)));
const scopeGraphZoom = ref(1);
const scopeGraphViewBox = computed(() => {
  const width = scopeGraphWidth.value;
  const height = scopeGraphHeight.value;
  const viewWidth = width / scopeGraphZoom.value;
  const viewHeight = height / scopeGraphZoom.value;
  return `${(width - viewWidth) / 2} ${(height - viewHeight) / 2} ${viewWidth} ${viewHeight}`;
});
function zoomScopeGraph(delta: number) { scopeGraphZoom.value = Math.min(2.5, Math.max(0.75, Number((scopeGraphZoom.value + delta).toFixed(2)))); }
function resetScopeGraphZoom() { scopeGraphZoom.value = 1; }
function toggleScopeGraphOrientation() {
  scopeGraphOrientation.value = scopeGraphEffectiveOrientation.value === "horizontal" ? "vertical" : "horizontal";
}
function toggleScopeRoot(className: string) {
  if (mode.value !== "subgraph") return;
  const next = new Set(roots.value);
  if (next.has(className)) next.delete(className); else next.add(className);
  roots.value = [...next];
}

function nodePosition(className: string) {
  return scopeGraphNodes.value.find((node) => node.className === className);
}

function shortLabel(cls: ObjectClassOption): string {
  const label = cls.showName || cls.className;
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}

function getClassLabel(cls: ObjectClassOption): string {
  const displayName = cls.showName || cls.classDesc || cls.className;
  return displayName === cls.className ? cls.className : `${displayName} (${cls.className})`;
}
</script>

<template>
  <el-form-item :label="t('admin.graphScope')">
    <el-radio-group v-model="mode" :aria-label="t('admin.graphScope')">
      <el-radio value="panorama">{{ t("admin.graphScopePanorama") }}</el-radio>
      <el-radio value="subgraph">{{ t("admin.graphScopeSubgraph") }}</el-radio>
    </el-radio-group>
    <p class="form-tip">{{ t("agents.graphScopeHint") }}</p>
  </el-form-item>
  <div class="scope-graph-card">
    <div class="scope-graph-toolbar">
      <div>
        <strong>{{ t(mode === "subgraph" ? "admin.graphScopeVisualSelector" : "admin.graphScopePanorama") }}</strong>
        <span>{{
          t(mode === "subgraph" ? "admin.graphScopeVisualSummary" : "admin.graphScopePanoramaSummary", {
            roots: roots.length,
            classes: scopeReachableClasses.size,
          })
        }}</span>
      </div>
      <div class="scope-graph-actions">
        <button
          type="button"
          class="scope-graph-layout-toggle"
          :title="t('admin.graphScopeToggleLayout')"
          :aria-label="t('admin.graphScopeToggleLayout')"
          @click="toggleScopeGraphOrientation"
        >
          <LayoutPanelLeft v-if="scopeGraphEffectiveOrientation === 'horizontal'" :size="15" />
          <LayoutPanelTop v-else :size="15" />
          <span>{{
            t(scopeGraphEffectiveOrientation === "horizontal" ? "admin.graphScopeHorizontal" : "admin.graphScopeVertical")
          }}</span>
        </button>
        <button type="button" :title="t('admin.graphScopeZoomIn')" :aria-label="t('admin.graphScopeZoomIn')" @click="zoomScopeGraph(0.25)">
          <ZoomIn :size="15" />
        </button>
        <button type="button" :title="t('admin.graphScopeZoomOut')" :aria-label="t('admin.graphScopeZoomOut')" @click="zoomScopeGraph(-0.25)">
          <ZoomOut :size="15" />
        </button>
        <button type="button" :title="t('admin.graphScopeResetView')" :aria-label="t('admin.graphScopeResetView')" @click="resetScopeGraphZoom">
          <Maximize :size="15" />
        </button>
      </div>
    </div>
    <div v-if="scopeGraphNodes.length" class="scope-graph-scroll">
      <svg
        :viewBox="scopeGraphViewBox"
        :style="{ height: `${scopeGraphSvgHeight}px` }"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        :aria-label="t('admin.graphScopeVisualSelector')"
      >
        <line
          v-for="edge in scopeGraphEdges"
          :key="`${edge.from}-${edge.to}`"
          class="scope-graph-edge"
          :class="{ active: scopeReachableClasses.has(edge.from) && scopeReachableClasses.has(edge.to) }"
          :x1="nodePosition(edge.from)?.x"
          :y1="nodePosition(edge.from)?.y"
          :x2="nodePosition(edge.to)?.x"
          :y2="nodePosition(edge.to)?.y"
        />
        <g
          v-for="node in scopeGraphNodes"
          :key="node.className"
          class="scope-graph-node"
          :class="{
            root: mode === 'subgraph' && roots.includes(node.className),
            reachable: scopeReachableClasses.has(node.className),
            readonly: mode === 'panorama',
          }"
          :role="mode === 'subgraph' ? 'button' : 'img'"
          :aria-label="getClassLabel(node)"
          :aria-pressed="mode === 'subgraph' ? roots.includes(node.className) : undefined"
          :tabindex="mode === 'subgraph' ? 0 : undefined"
          @click="toggleScopeRoot(node.className)"
          @keydown.enter="toggleScopeRoot(node.className)"
          @keydown.space.prevent="toggleScopeRoot(node.className)"
        >
          <title>{{ getClassLabel(node) }}</title>
          <circle :cx="node.x" :cy="node.y" r="25" />
          <text :x="node.x" :y="node.y + 42" text-anchor="middle">{{ shortLabel(node) }}</text>
        </g>
      </svg>
    </div>
    <el-empty v-else :description="t('admin.graphScopeNoClasses')" />
    <div class="scope-graph-legend">
      <span v-if="mode === 'subgraph'"><i class="root" />{{ t("admin.graphScopeRoots") }}</span>
      <span><i class="reachable" />{{ t("admin.graphScopeIncluded") }}</span>
      <span v-if="mode === 'subgraph'"><i />{{ t("admin.graphScopeExcluded") }}</span>
    </div>
  </div>
  <template v-if="mode === 'subgraph'">
    <el-form-item :label="t('admin.graphScopeRoots')" required>
      <el-select
        v-model="roots"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        clearable
        :loading="loading"
        :aria-label="t('admin.graphScopeRoots')"
        :placeholder="t('admin.graphScopeRootsHint')"
        class="full"
      >
        <el-option v-for="cls in classes" :key="cls.className" :label="getClassLabel(cls)" :value="cls.className" />
      </el-select>
      <p class="form-tip">{{ t("admin.graphScopeRootsHint") }}</p>
    </el-form-item>
    <el-form-item :label="t('admin.graphScopeMaxDepth')" required>
      <el-input-number
        v-model="depth"
        :min="0"
        :max="10"
        :step="1"
        step-strictly
        :precision="0"
        :aria-label="t('admin.graphScopeMaxDepth')"
      />
      <p class="form-tip">{{ t("admin.graphScopeDepthHint") }}</p>
    </el-form-item>
  </template>
</template>

<style scoped>
.scope-graph-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 10px; background: var(--el-fill-color-extra-light); margin-bottom: 20px; }
.scope-graph-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
.scope-graph-toolbar > div:first-child { display: grid; gap: 6px; }
.scope-graph-actions { display: flex; align-items: center; gap: 4px; }
.scope-graph-legend { display: flex; flex-wrap: wrap; gap: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
.scope-graph-legend span { display: inline-flex; align-items: center; gap: 6px; }
.scope-graph-legend i { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--el-border-color); background: var(--el-bg-color); }
.scope-graph-legend i.root { background: var(--el-color-primary); border-color: var(--el-color-primary); }
.scope-graph-legend i.reachable { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-5); }
.scope-graph-node.readonly { cursor: default; }
.scope-graph-actions button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--el-border-color-light); border-radius: 5px; background: var(--el-bg-color); color: var(--el-text-color-regular); cursor: pointer; }
.scope-graph-actions button.scope-graph-layout-toggle { display: inline-flex; align-items: center; justify-content: center; width: auto; padding: 0 8px; gap: 4px; white-space: nowrap; }
.scope-graph-actions button.scope-graph-layout-toggle span { font-size: 12px; line-height: 1; }
.scope-graph-toolbar strong { color: var(--el-text-color-primary); font-size: 13px; }
.scope-graph-scroll { width: 100%; overflow: hidden; padding: 8px 0; }
.scope-graph-scroll svg { display: block; width: 100%; height: 320px; max-width: 100%; margin: 0 auto; }
.scope-graph-edge { stroke: var(--el-border-color); stroke-width: 2; opacity: .7; transition: stroke .15s, opacity .15s; }
.scope-graph-edge.active { stroke: var(--el-color-primary-light-5); opacity: 1; }
.scope-graph-node { cursor: pointer; outline: none; }
.scope-graph-node circle { fill: var(--el-bg-color); stroke: var(--el-border-color); stroke-width: 2; transition: fill .15s, stroke .15s, stroke-width .15s; }
.scope-graph-node text { fill: var(--el-text-color-regular); font-size: 11px; pointer-events: none; paint-order: stroke; stroke: var(--el-fill-color-extra-light); stroke-width: 3px; stroke-linejoin: round; }
.scope-graph-node.reachable circle { fill: var(--el-color-primary-light-9); stroke: var(--el-color-primary-light-5); }
.scope-graph-node.root circle { fill: var(--el-color-primary); stroke: var(--el-color-primary); stroke-width: 3; }
.scope-graph-node.root text { fill: var(--el-color-primary); font-weight: 600; }
.scope-graph-node:focus-visible circle { stroke: var(--el-color-primary); stroke-width: 4; }
.full { width: 100%; }
.form-tip { flex-basis: 100%; margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--el-text-color-secondary); }
</style>
