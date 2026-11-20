<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElEmpty, ElInput, ElTag, vLoading } from "element-plus";
import { Download, Maximize, Network, RefreshCw, Search } from "lucide-vue-next";
import ManagerIconButton from "./ManagerIconButton.vue";
import { Graph } from "@antv/g6";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import type {
  CapabilityGrantRecord,
  PlatformAccessRecord,
  SmartAsset,
  SubjectRecord,
  TriggerRecord,
  WorkflowRecord,
} from "../api";
import { useManagerClient, useOntologyText, useSharedText } from "../context";
import { readGraphColors } from "../graph-colors";
import { useManagerFeedback } from "../feedback";
import type { MessageKey } from "../i18n";
import {
  CAPABILITY_LABEL_SIZE,
  CAPABILITY_LABEL_WIDTH,
  CAPABILITY_NODE_SIZE,
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
const { t } = useSharedText();
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
const rendering = ref(false);
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

const graphRef = ref<HTMLDivElement | null>(null);
let graph: Graph | null = null;
let graphRequest = 0;

function graphColors() {
  return readGraphColors(graphRef.value ?? document.body);
}

const palette = computed(() => [
  "var(--el-color-primary)",
  "var(--el-color-success)",
  "var(--el-color-danger)",
  "var(--el-color-warning)",
  "var(--el-color-info)",
  "#7c3aed",
  "#0891b2",
  "#db2777",
]);

/** Colour names the kind, not the layer: two objects of one layer are not the same thing. */
function colorFor(kind: CapabilityKind) {
  const index = capabilityKinds.indexOf(kind);
  const value = palette.value[index % palette.value.length]!;
  // G6 draws on a canvas, so a CSS custom property has to be resolved before it is handed over.
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || value;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function renderGraph() {
  if (!graphRef.value) return;
  await yieldToBrowser();
  const request = ++graphRequest;
  // The host may be gone by the time the yield returns: reading it again after the await is the only safe order,
  // because a page that unmounted while a draw was queued must not touch the graph.
  const host = graphRef.value;
  if (!host) return;
  const { width, height } = host.getBoundingClientRect();
  if (!width || !height) return;
  graph?.destroy();
  const colors = graphColors();
  const target = new Graph({
    container: host,
    width: Math.round(width),
    height: Math.round(height),
    autoResize: false,
    padding: 48,
    animation: false,
    data: { nodes: [], edges: [] },
    behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
    node: {
      type: "circle",
      style: {
        size: CAPABILITY_NODE_SIZE,
        fill: (datum: Record<string, any>) => datum.data.color,
        stroke: colors.nodeStroke,
        lineWidth: 4,
        shadowColor: colors.shadow,
        labelText: (datum: Record<string, any>) => capabilityNodeLabel(datum.data.node.label),
        labelFill: colors.text,
        labelFontSize: CAPABILITY_LABEL_SIZE,
        labelFontWeight: 600,
        labelPlacement: "bottom",
        labelOffsetY: 6,
        labelMaxWidth: CAPABILITY_LABEL_WIDTH,
        // Edges cross the columns between their ends; drawn under the nodes, and masked by each name's backing, they
        // cannot cover a name.
        labelBackground: true,
        labelBackgroundFill: colors.surface,
        labelBackgroundPadding: [1, 4],
        zIndex: 1,
        cursor: "pointer",
      },
      state: { selected: { stroke: colors.primary, lineWidth: 5 } },
    },
    edge: {
      type: "line",
      style: {
        stroke: colors.edge,
        lineWidth: 1.5,
        endArrow: true,
        labelText: (datum: Record<string, any>) => datum.data.label ?? "",
        labelFill: colors.muted,
        labelBackground: true,
        labelBackgroundFill: colors.surface,
        labelBackgroundPadding: [2, 4],
      },
    },
  });
  graph = target;
  target.on("node:click", (event: Record<string, any>) => {
    const id = String(event.target.id);
    const node = nodes.value.find((item) => item.id === id) ?? null;
    selected.value = node;
    if (graph) void graph.setElementState({ [id]: ["selected"] }, false);
  });
  target.on("canvas:click", () => {
    selected.value = null;
  });

  rendering.value = true;
  try {
    await target.render();
    const layout = capabilityMapLayout(filtered.value.nodes, { width, height });
    target.addData({
      nodes: filtered.value.nodes.map((node) => ({
        id: node.id,
        data: { node, color: colorFor(node.kind) },
        style: layout.positions[node.id],
      })),
      edges: filtered.value.edges.map((edge, index) => ({
        id: `edge:${index}:${edge.from}:${edge.to}`,
        source: edge.from,
        target: edge.to,
        data: { label: edge.label, derived: edge.derived },
        style: edge.derived ? { lineDash: [5, 4], stroke: colors.muted } : {},
      })),
    });
    if (request !== graphRequest) return;
    await target.draw();
    if (request !== graphRequest) return;
    await openAt(target, layout);
  } finally {
    if (request === graphRequest) rendering.value = false;
  }
}

/**
 * Open where the layout says the names can be read, instead of fitting every node whatever size that draws them at.
 * The fit button still shows the whole map on request.
 */
async function openAt(target: Graph, layout: CapabilityMapLayout) {
  await target.zoomTo(layout.zoom, false);
  const [x, y] = target.getViewportByCanvas([0, 0]);
  await target.translateBy([layout.offset.x - x, layout.offset.y - y], false);
}

function fitView() {
  if (graph) void graph.fitView({ when: "always", direction: "both" });
}

function downloadPng() {
  const container = graphRef.value;
  const layers = container ? Array.from(container.querySelectorAll("canvas")) : [];
  if (!container || !layers.length) return;
  const width = Math.max(...layers.map((canvas) => canvas.width));
  const height = Math.max(...layers.map((canvas) => canvas.height));
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context2d = output.getContext("2d");
  if (!context2d) return;
  context2d.fillStyle = getComputedStyle(container.parentElement || container).backgroundColor;
  context2d.fillRect(0, 0, width, height);
  layers.forEach((canvas) => context2d.drawImage(canvas, 0, 0, width, height));
  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `capability-map-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
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
  await renderGraph();
}

let resizeObserver: ResizeObserver | null = null;
onMounted(async () => {
  await redraw();
  if (graphRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!graph || !graphRef.value || rendering.value) return;
      const { width, height } = graphRef.value.getBoundingClientRect();
      if (width && height) graph.resize(Math.round(width), Math.round(height));
    });
    resizeObserver.observe(graphRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  graph?.destroy();
  graph = null;
});
</script>

<template>
  <section v-loading="loading" class="capability-map">
    <PlatformPageHeader compact :title="t('nav.capabilityMap')" :description="ot('mapDesc')">
      <template #actions>
        <el-input v-model="query" class="map-filter" :prefix-icon="Search" :placeholder="ot('mapFilter')" clearable @change="renderGraph" />
        <ManagerIconButton :icon="RefreshCw" :label="ot('mapRefresh')" :loading="loading" :disabled="rendering" @click="redraw" />
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
        <div ref="graphRef" class="map-canvas" />
        <div class="map-tools">
          <ManagerIconButton :icon="Maximize" :label="ot('mapFit')" @click="fitView" />
          <ManagerIconButton :icon="Network" :label="ot('mapRelayout')" :disabled="rendering" @click="renderGraph" />
          <ManagerIconButton :icon="Download" :label="ot('mapDownload')" @click="downloadPng" />
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
  inset-block-start: var(--spacing-sm);
  inset-inline-end: var(--spacing-sm);
  display: flex;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}

.map-totals {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  gap: 6px;
}
</style>
