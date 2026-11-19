<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElEmpty, ElInput, ElTag, vLoading } from "element-plus";
import { Download, Maximize, RefreshCw, Search } from "lucide-vue-next";
import { G6GraphCanvas, graphCategorySlot, readGraphPalette, type GraphCanvasEdge, type GraphCanvasNode } from "@ontomato/foundation-ui/graph/g6";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import type {
  CapabilityGrantRecord,
  PlatformAccessRecord,
  SmartAsset,
  SubjectRecord,
  TriggerRecord,
  WorkflowRecord,
} from "../api";
import { useManagerClient, useOntologyText } from "../context";
import { useManagerFeedback } from "../feedback";
import type { MessageKey } from "../i18n";
import {
  CAPABILITY_LABEL_WIDTH,
  capabilityKinds,
  capabilityMapLayout,
  capabilityNodeLabel,
  type CapabilityKind,
  type CapabilityMapLayout,
  type CapabilityNode,
} from "./capability-map-rendering";
import { buildCapabilityMap } from "./capability-map-model";

/**
 * The governance and capability layers, drawn the way the instance graph draws a domain.
 *
 * <p>Two kinds of object, seven kinds of node. Governance contributes subjects and roles; the capability layer
 * contributes actions, processes, triggers, metric views, functions and skills. Nothing of the fact layer appears: no
 * object type, no instance, because this page answers "what authority exists over what capability", not "what data is
 * there". That is the object browser's question, and it has its own graph.</p>
 *
 * <p>Nodes are coloured by kind rather than by a column they sit in, so a relation that skips a layer still reads as a
 * relation. Stored edges are solid, edges rebuilt from other rows (a role owns a process only because a step names it)
 * are dashed — the same distinction the instance graph draws between a real foreign key and a derived one.</p>
 */
const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const {
  loadWorkflows,
  loadSmartAssets,
  loadCapabilityGrants,
  loadPlatformAccess,
  loadSubjects,
  loadTriggers,
  loadSkills,
} = useManagerClient();

const loading = ref(false);
const query = ref("");
const selected = ref<CapabilityNode | null>(null);

const subjects = ref<SubjectRecord[]>([]);
const workflows = ref<WorkflowRecord[]>([]);
const actions = ref<SmartAsset[]>([]);
const metrics = ref<SmartAsset[]>([]);
const functions = ref<SmartAsset[]>([]);
const skills = ref<Array<{ id: string; title: string }>>([]);
const triggers = ref<TriggerRecord[]>([]);
const grants = ref<CapabilityGrantRecord[]>([]);
const platformAccess = ref<PlatformAccessRecord[]>([]);

/**
 * What to draw, computed from the domain's rows.
 *
 * The claim "one member who both created and published an action yields two relations" is a statement about the model,
 * not about the canvas, so it is built by a pure function that can be checked without mounting a renderer.
 */
const model = computed(() =>
  buildCapabilityMap(
    {
      subjects: subjects.value,
      workflows: workflows.value,
      actions: actions.value,
      metrics: metrics.value,
      functions: functions.value,
      skills: skills.value,
      triggers: triggers.value,
      grants: grants.value,
      platformAccess: platformAccess.value,
    },
    (key) => ot(key),
  ),
);

const roles = computed(() => model.value.roles);
const nodes = computed<CapabilityNode[]>(() => model.value.nodes);
const edges = computed(() => model.value.edges);

/** Searching keeps one hop of context: a match drawn alone loses the point of a graph. */
const filtered = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return { nodes: nodes.value, edges: edges.value };
  const keep = new Set(
    nodes.value
      .filter((node) => node.label.toLowerCase().includes(text) || node.detail.toLowerCase().includes(text))
      .map((node) => node.id),
  );
  for (const edge of edges.value) {
    if (keep.has(edge.from)) keep.add(edge.to);
    else if (keep.has(edge.to)) keep.add(edge.from);
  }
  return {
    nodes: nodes.value.filter((node) => keep.has(node.id)),
    edges: edges.value.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
  };
});

const counts = computed(() => {
  const byKind = new Map<CapabilityKind, number>();
  for (const node of nodes.value) byKind.set(node.kind, (byKind.get(node.kind) ?? 0) + 1);
  return byKind;
});

/** Each kind's name: a template cannot build a message key by concatenation and still be checked. */
const kindNames: Record<CapabilityKind, MessageKey> = {
  subject: "mapKindSubject",
  role: "mapKindRole",
  action: "mapKindAction",
  workflow: "mapKindWorkflow",
  trigger: "mapKindTrigger",
  metric: "mapKindMetric",
  function: "mapKindFunction",
  skill: "mapKindSkill",
};

/** The legend, in draw order. */
const legend = computed(() =>
  capabilityKinds.map((kind) => ({ kind, key: kindNames[kind], count: counts.value.get(kind) ?? 0 })),
);

const summary = computed(() => ({
  governance: nodes.value.filter((node) => node.layer === "governance").length,
  capability: nodes.value.filter((node) => node.layer === "capability").length,
  edges: edges.value.length,
}));

const relations = computed(() => {
  const chosen = selected.value;
  if (!chosen) return [];
  const byId = new Map(nodes.value.map((node) => [node.id, node]));
  return edges.value
    .filter((edge) => edge.from === chosen.id || edge.to === chosen.id)
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      return `${from?.label ?? edge.from} · ${edge.label} → ${to?.label ?? edge.to}`;
    });
});

/**
 * What the canvas draws: the nodes and edges that matched when the map was last placed, at the places the layout gave
 * them. A filter or a refresh takes effect when the map is placed again, as the reader confirms the filter.
 */
const placed = shallowRef<{ layout: CapabilityMapLayout; nodes: CapabilityNode[]; edges: typeof edges.value } | null>(null);
const canvasNodes = computed<GraphCanvasNode[]>(() =>
  (placed.value?.nodes ?? []).map((node) => ({
    id: node.id,
    label: capabilityNodeLabel(node.label),
    category: node.kind,
    ...placed.value!.layout.positions[node.id]!,
  })),
);
const canvasEdges = computed<GraphCanvasEdge[]>(() =>
  (placed.value?.edges ?? []).map((edge, index) => ({
    id: `edge:${index}:${edge.from}:${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    line: edge.derived ? "dashed" : "solid",
  })),
);

const root = ref<HTMLElement | null>(null);
const canvas = ref<InstanceType<typeof G6GraphCanvas> | null>(null);
/** How many colours the edition's categorical palette has, read once the page is drawn; the legend picks the same slots. */
const paletteSize = ref(0);

/** The legend's colour for a kind: the slot the canvas gives the same category, as a variable that follows the mode. */
function colorFor(kind: CapabilityKind) {
  return paletteSize.value ? `var(--chart-${graphCategorySlot(kind, capabilityKinds, paletteSize.value) + 1})` : undefined;
}

function chooseNode(ids: string[]) {
  selected.value = nodes.value.find((node) => node.id === ids[0]) ?? null;
}

/**
 * Lay the matching nodes out for the canvas's size and open where the layout says the names can be read, instead of
 * fitting every node whatever size that draws them at. The fit button still shows the whole map on request.
 */
async function place() {
  await nextTick();
  if (!canvas.value) return;
  const { width, height } = (canvas.value.$el as HTMLElement).getBoundingClientRect();
  const layout = capabilityMapLayout(filtered.value.nodes, { width, height });
  placed.value = { layout, nodes: filtered.value.nodes, edges: filtered.value.edges };
  await canvas.value.relayout();
  await canvas.value.setViewport({ x: -layout.offset.x / layout.zoom, y: -layout.offset.y / layout.zoom, zoom: layout.zoom });
}

function fitView() {
  void canvas.value?.fit();
}

async function downloadPng() {
  const blob = await canvas.value!.exportImage();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `capability-map-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refresh() {
  loading.value = true;
  try {
    // Every source is a separate fact; one failing must not empty the whole graph.
    const [nextSubjects, nextWorkflows, nextActions, nextMetrics, nextFunctions, nextSkills, nextTriggers, nextGrants, nextAccess] =
      await Promise.allSettled([
        loadSubjects(),
        loadWorkflows(),
        loadSmartAssets("actions"),
        loadSmartAssets("metrics"),
        loadSmartAssets("functions"),
        loadSkills(),
        loadTriggers(),
        loadCapabilityGrants(),
        loadPlatformAccess(),
      ]);
    const take = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
      result.status === "fulfilled" && Array.isArray(result.value) ? result.value : fallback;
    subjects.value = take(nextSubjects, []);
    workflows.value = take(nextWorkflows, []);
    actions.value = take(nextActions, []);
    metrics.value = take(nextMetrics, []);
    functions.value = take(nextFunctions, []);
    skills.value = take(nextSkills, []);
    triggers.value = take(nextTriggers, []);
    grants.value = take(nextGrants, []);
    platformAccess.value = take(nextAccess, []);
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

async function redraw() {
  await refresh();
  await place();
}

onMounted(async () => {
  paletteSize.value = readGraphPalette(root.value!).length;
  await redraw();
});
</script>

<template>
  <section ref="root" v-loading="loading" class="capability-map">
    <PlatformPageHeader compact :title="ot('mapTitle')" :description="ot('mapDesc')">
      <template #actions>
        <el-input v-model="query" class="map-filter" :prefix-icon="Search" :placeholder="ot('mapFilter')" clearable @change="place" />
        <el-button @click="redraw">
          <RefreshCw :size="16" />
          <span>{{ ot("mapRefresh") }}</span>
        </el-button>
      </template>
    </PlatformPageHeader>

    <div class="map-body platform-page-gutter">
      <div class="map-legend">
        <span v-for="item in legend" :key="item.kind" class="legend-item">
          <i class="legend-dot" :style="{ background: colorFor(item.kind) }" />
          {{ ot(item.key) }}
          <b>{{ item.count }}</b>
        </span>
        <span class="legend-sep" />
        <span class="legend-item"><i class="legend-line" />{{ ot("mapLegendDirect") }}</span>
        <span class="legend-item"><i class="legend-line dashed" />{{ ot("mapLegendDerived") }}</span>
      </div>

      <ul v-if="relations.length" class="map-relations">
        <li v-for="line in relations" :key="line">{{ line }}</li>
      </ul>
      <p v-else-if="selected" class="map-relations map-isolated">{{ ot("mapIsolated") }}</p>

      <div v-if="!loading && nodes.length === 0" class="map-empty">
        <el-empty :description="ot('mapEmpty')" />
      </div>

      <div v-else class="map-frame">
        <G6GraphCanvas
          ref="canvas"
          class="map-canvas"
          :label="ot('mapTitle')"
          :nodes="canvasNodes"
          :edges="canvasEdges"
          :selected="selected ? [selected.id] : []"
          :layout="{ type: 'preset' }"
          :categories="capabilityKinds"
          :label-width="CAPABILITY_LABEL_WIDTH"
          @update:selected="chooseNode"
          @blank="selected = null"
        />
        <div class="map-tools">
          <button :title="ot('mapFit')" :aria-label="ot('mapFit')" @click="fitView"><Maximize :size="16" /></button>
          <button :title="ot('mapRelayout')" :aria-label="ot('mapRelayout')" @click="place"><RefreshCw :size="16" /></button>
          <button :title="ot('mapDownload')" :aria-label="ot('mapDownload')" @click="downloadPng"><Download :size="16" /></button>
        </div>
        <div class="map-totals">
          <el-tag size="small" effect="plain">{{ ot("mapGroupGovernance") }} {{ summary.governance }}</el-tag>
          <el-tag size="small" effect="plain">{{ ot("mapGroupCapability") }} {{ summary.capability }}</el-tag>
          <el-tag size="small" effect="plain">{{ ot("mapCountEdge") }} {{ summary.edges }}</el-tag>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.capability-map {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.map-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding-block: var(--page-content-gap) var(--spacing-xl);
}

.map-filter {
  width: 220px;
}

.map-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-item b {
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}

.legend-line {
  display: inline-block;
  width: 24px;
  height: 0;
  border-top: 1.5px solid var(--el-text-color-secondary);
}

.legend-line.dashed {
  border-top-style: dashed;
}

.legend-sep {
  width: 1px;
  height: 14px;
  background: var(--el-border-color);
}

.map-relations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  max-block-size: 6rem;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.map-isolated {
  color: var(--el-text-color-secondary);
}

.map-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.map-frame {
  position: relative;
  flex: 1;
  min-height: 420px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background-color: var(--el-fill-color-blank);
}

.map-canvas {
  width: 100%;
  height: 100%;
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 18px 18px;
}

.map-tools {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 4px;
}

.map-tools button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  cursor: pointer;
}

.map-tools button:disabled {
  cursor: default;
  opacity: 0.5;
}

.map-totals {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  gap: 6px;
}
</style>
