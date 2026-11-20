<script setup lang="ts">
import {
  G6GraphCanvas,
  G6_LABEL_SIZE,
  G6_LABEL_WIDTH,
  G6_NODE_SIZE,
  graphCategorySlot,
  readGraphPalette,
  type GraphCanvasEdge,
  type GraphCanvasElement,
  type GraphCanvasNode,
  type GraphCanvasPoint,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
import type { ObjectReference } from "@ontomato/contracts/object-views";
import ManagerIconButton from "../components/ManagerIconButton.vue";
import { actionTooltipProps } from "@ontomato/foundation-ui/overlay";
import {
  Box,
  ArrowLeft,
  Settings2,
  Download,
  Maximize,
  Network,
  MousePointerClick,
  RefreshCw,
  Search,
  Unplug,
  Plus,
  Minus,
  GitFork,
  Waypoints,
  SlidersHorizontal,
  X,
  Info,
  Eye,
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElButton, ElPopover, ElSelect, ElOption, ElCheckbox, ElSwitch, ElSelectV2, ElTooltip, vLoading } from "element-plus";
import { useManagerFeedback } from "../feedback";
import type { InstanceGraphEdge, InstanceGraphNode, InstanceGraphStatus, InstanceGraphSummary } from "../api";
import { useManagerClient, useManagerContext, useOntologyText, useSharedText } from "../context";
import {
  instanceNodePosition,
  isLargeInstanceGraph,
  neighborNodePosition,
  overviewPositions,
  overviewRelations,
  overviewClassHeadings,
  type OverviewRect,
} from "./instance-graph-rendering";

const context = useManagerContext();
const props = defineProps<{ summaryTarget?: HTMLElement | null }>();
const emit = defineEmits<{ openObject: [reference: ObjectReference] }>();
function openSelectedObject() {
  const node = selectedNode.value;
  if (!node) return;
  emit("openObject", { className: node.class, primaryKey: node.id.startsWith(`${node.class}:`) ? node.id.slice(node.class.length + 1) : node.id });
}
const { message } = useManagerFeedback();
const { ot } = useOntologyText();
const { t } = useSharedText();
const { loadInstanceGraphSummary, loadInstanceGraphConnections, searchInstanceGraph, loadInstanceNeighborhood, queryInstanceInfo, loadOntology } =
  useManagerClient();

const root = ref<HTMLElement | null>(null);
const statisticsButton = ref<HTMLButtonElement | null>(null);
const canvas = ref<InstanceType<typeof G6GraphCanvas> | null>(null);
const loading = ref(false);
const connectionsLoading = ref(false);
const error = ref("");
const status = ref<InstanceGraphStatus>("READY");
const nodes = shallowRef<InstanceGraphNode[]>([]);
const edges = shallowRef<InstanceGraphEdge[]>([]);
/** Where each instance is drawn: the page's layout, and where the reader dragged a node to. */
const positions = shallowRef<Record<string, GraphCanvasPoint>>({});
const viewport = shallowRef<GraphCanvasViewport | null>(null);
const selectedNode = ref<InstanceGraphNode | null>(null);
const selectedClassLabel = ref("");
const selectedAttributes = ref<Array<{ name: string; showName: string; value: unknown }>>([]);
const detailsLoading = ref(false);
const detailsError = ref("");
const neighborClass = ref<string | null | undefined>("");
const relationType = ref<string | null | undefined>("");
const direction = ref("both");
const fitAfterExpand = ref(false);
const appliedNeighborFilters = shallowRef<{ neighborClass?: string; relationType?: string; direction?: string }>({});
const filtersDirty = computed(() => (appliedNeighborFilters.value.neighborClass ?? "") !== (neighborClass.value ?? "")
  || (appliedNeighborFilters.value.relationType ?? "") !== (relationType.value ?? "")
  || (appliedNeighborFilters.value.direction || "both") !== direction.value);
const versionChanged = ref(false);
const relationLabels = ref<Record<string, string>>({});
const showRelationLabels = ref(true);
const classLabels = ref<Record<string, string>>({});
const layouting = ref(false);
/** The canvas's progress through a change it draws in batches: the elements drawn so far, and how many there are. */
const drawing = ref({ drawn: 0, total: 0 });
const rendering = computed(() => drawing.value.drawn < drawing.value.total);
const largeGraph = computed(() => isLargeInstanceGraph(nodes.value.length, edges.value.length));
const summary = shallowRef<InstanceGraphSummary | null>(null);
const overview = ref(true);
const aggregateRelations = ref(true);
const selectedClass = ref("");
const searchNodes = shallowRef<InstanceGraphNode[]>([]);
const searching = ref(false);
const searchMore = ref(false);
const expanding = ref(false);
const neighborPages = shallowRef<Record<string, { nextOffset: number | null; total: number | null; loaded: number }>>({});
const currentPage = computed(() => selectedNode.value ? neighborPages.value[selectedNode.value.id] : undefined);
/** How many colours the edition's categorical palette has; class headings take the slot the canvas gives the class. */
const paletteSize = ref(0);
let searchRequest = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let nodeInfoRequest = 0;
let graphRequest = 0;
let generationTimer: ReturnType<typeof setTimeout> | undefined;

const layoutKey = () => `ontology-instance-overview:${context.apiBase}`;

function saveOverviewLayout() {
  if (!overview.value || !summary.value) return;
  const saved = Object.fromEntries(nodes.value.map((node) => [node.id, positions.value[node.id]]));
  try {
    localStorage.setItem(layoutKey(), JSON.stringify({ version: summary.value.version, positions: saved }));
  } catch { /* Storage may be unavailable in embedded browsers. */ }
}

function readOverviewLayout(): Record<string, { x: number; y: number }> {
  if (!overview.value || !summary.value) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey()) || "null");
    if (!saved?.positions) return {};
    return Object.fromEntries(nodes.value.filter((node) => Number.isFinite(saved.positions[node.id]?.x)
      && Number.isFinite(saved.positions[node.id]?.y)).map((node) => [node.id, saved.positions[node.id]]));
  } catch { return {}; }
}

const searchOptions = computed(() =>
  searchNodes.value.map((node) => ({
    value: node.id,
    label: `${node.name || node.id} · ${node.id} · ${classLabels.value[node.class] || node.class} · ${node.class}`,
    name: node.name || node.id,
    description: `${classLabels.value[node.class] || node.class} · ${node.id}`,
  }))
);

/** A class's colour for the HTML beside the canvas: the slot the canvas gives the same category, following the mode. */
function colorForClass(className: string) {
  return paletteSize.value ? `var(--chart-${graphCategorySlot(className, [], paletteSize.value) + 1})` : undefined;
}

function relationLabel(type: string | undefined, count?: number) {
  if (!showRelationLabels.value) return undefined;
  const label = (type && relationLabels.value[type]) || type || "";
  return count === undefined ? label : `${label} · ${count.toLocaleString(context.locale)}`;
}

/** The instances the canvas draws, and in the overview each class's anchor for the aggregated relations. */
const overviewLinks = computed(() =>
  overview.value ? overviewRelations(nodes.value, edges.value, positions.value, selectedNode.value?.id) : null,
);
const canvasNodes = computed<GraphCanvasNode[]>(() => [
  ...nodes.value.map((node) => ({ id: node.id, label: node.name?.trim() || "—", category: node.class, ...positions.value[node.id]! })),
  ...(overviewLinks.value?.anchors ?? []),
]);
const canvasEdges = computed<GraphCanvasEdge[]>(() => {
  if (overviewLinks.value && aggregateRelations.value) {
    return overviewLinks.value.edges.map((edge) => ({ ...edge, label: relationLabel(edge.type, edge.count) }));
  }
  return edges.value.map((edge, index) => ({ id: `edge:${index}`, source: edge.source, target: edge.target, label: relationLabel(edge.type) }));
});

async function fitGraph() {
  await canvas.value?.fit({
    maxZoom: Math.min(1, context.presentation.maxFitZoom ?? 1),
    // The overview keeps room above the top cluster for its class heading.
    padding: overview.value ? [64, 48, 48, 48] : 48,
  });
}

/** Draws `nodes` at the layout's places (in the overview, where the reader last left them) and fits them in view. */
async function renderGraph() {
  const defaults = overviewPositions(nodes.value);
  positions.value = { ...defaults, ...readOverviewLayout() };
  await fitGraph();
}

function moveNode(id: string, position: GraphCanvasPoint) {
  positions.value = { ...positions.value, [id]: position };
  saveOverviewLayout();
}

async function relayoutGraph() {
  if (layouting.value || loading.value || rendering.value || expanding.value) return;
  layouting.value = true;
  try {
    positions.value = !overview.value && largeGraph.value
      ? Object.fromEntries(nodes.value.map((node, index) => [node.id, instanceNodePosition(index, nodes.value.length)]))
      : overviewPositions(nodes.value);
    await canvas.value?.relayout();
    await fitGraph();
    saveOverviewLayout();
  } finally {
    layouting.value = false;
  }
}

function clearSelection() {
  nodeInfoRequest += 1;
  selectedNode.value = null;
  selectedClassLabel.value = "";
  selectedAttributes.value = [];
  detailsLoading.value = false;
  detailsError.value = "";
}

async function loadNodeInfo(node: InstanceGraphNode) {
  const request = ++nodeInfoRequest;
  selectedClassLabel.value = classLabels.value[node.class] || node.class;
  selectedAttributes.value = [];
  detailsLoading.value = true;
  detailsError.value = "";
  try {
    const info = await queryInstanceInfo(node.id, node.class);
    if (request !== nodeInfoRequest) return;
    const classDef = (info.classDef ?? {}) as Record<string, unknown>;
    const attrs = Array.isArray(classDef.attrs) ? (classDef.attrs as Array<Record<string, unknown>>) : [];
    const row = (info.data ?? {}) as Record<string, unknown>;
    selectedAttributes.value = attrs
      .filter(
        (attr) => typeof attr.name === "string" && !Array.isArray(row[attr.name as string])
      )
      .map((attr) => ({
        name: attr.name as string,
        showName: (attr.showName as string) || (attr.name as string),
        value: row[attr.name as string],
      }));
  } catch (reason) {
    if (request !== nodeInfoRequest) return;
    selectedAttributes.value = [];
    detailsError.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
    message.error(reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed"));
  } finally {
    if (request === nodeInfoRequest) detailsLoading.value = false;
  }
}

function selectNode(id: string) {
  const node = nodes.value.find((item) => item.id === id);
  if (!node) return;
  if (selectedClass.value) {
    selectedClass.value = "";
    clearTimeout(searchTimer);
    searchRequest += 1;
    searchNodes.value = [];
    searchMore.value = false;
    searching.value = false;
  }
  selectedNode.value = node;
  void loadNodeInfo(node);
}

/** A reader's choice on the canvas; ignored while the graph is still being drawn or grown. */
function chooseNode(ids: string[]) {
  if (rendering.value || expanding.value) return;
  if (ids[0]) selectNode(ids[0]);
  else clearSelection();
}

function activate(element: GraphCanvasElement) {
  if (element.kind !== "node" || rendering.value || expanding.value) return;
  selectNode(element.id);
  void expandNeighbors();
}

/** Screen pixels inside the canvas for a graph point, or null where the point is out of view. */
function onScreen(point: GraphCanvasPoint) {
  const view = viewport.value!;
  const x = (point.x - view.x) * view.zoom;
  const y = (point.y - view.y) * view.zoom;
  return x < 0 || x > view.width * view.zoom || y < 0 || y > view.height * view.zoom ? null : { x, y };
}

const nodeActionPosition = computed(() => {
  const node = selectedNode.value;
  const point = node && viewport.value && positions.value[node.id];
  const at = point ? onScreen(point) : null;
  if (!at) return null;
  // Node geometry scales with the canvas; the gap and HTML toolbar stay in screen pixels.
  const nodeRadius = (G6_NODE_SIZE / 2 + 2.5) * viewport.value!.zoom;
  return { x: at.x, y: (canvas.value!.$el as HTMLElement).offsetTop + at.y - nodeRadius - 12 };
});

/** Screen-space headings follow pan, zoom and dragged nodes, including their visible labels. */
const classGroups = computed(() => {
  const view = viewport.value;
  if (!view || !overview.value || !root.value) return [];
  const width = view.width * view.zoom;
  const height = view.height * view.zoom;
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  const instances: OverviewRect[] = [];
  const measure = document.createElement("canvas").getContext("2d");
  const fontFamily = getComputedStyle(root.value).fontFamily;
  const textWidth = (text: string, size: number) => {
    if (!measure) return Array.from(text).length * size;
    measure.font = `600 ${size}px ${fontFamily}`;
    return measure.measureText(text).width;
  };
  for (const node of nodes.value) {
    const position = positions.value[node.id];
    if (!position) continue;
    const point = { x: (position.x - view.x) * view.zoom, y: (position.y - view.y) * view.zoom };
    const points = groups.get(node.class) || [];
    points.push(point); groups.set(node.class, points);
    const halfWidth = Math.max(18, Math.min(G6_LABEL_WIDTH, textWidth(node.name?.trim() || "—", G6_LABEL_SIZE)) / 2) * view.zoom;
    instances.push({ x: point.x - halfWidth, y: point.y - 18 * view.zoom,
      width: halfWidth * 2, height: 58 * view.zoom });
  }
  const toolbar = root.value.querySelector('.graph-toolbar')?.getBoundingClientRect();
  const frame = root.value.querySelector('.graph-canvas')?.getBoundingClientRect();
  if (frame && toolbar?.width && toolbar.height) {
    instances.push({ x: toolbar.left - frame.left, y: toolbar.top - frame.top, width: toolbar.width, height: toolbar.height });
  }
  return overviewClassHeadings([...groups].map(([name, points]) => {
    const label = classLabels.value[name] || name;
    const count = classCount(name, points.length);
    const headingWidth = Math.min(Math.max(64, textWidth(label, 12) + textWidth(count, 12) + 30), 240, Math.max(80, width - 32));
    const left = Math.min(...points.map(p => p.x));
    const right = Math.max(...points.map(p => p.x));
    const top = Math.min(...points.map(p => p.y)) - 18 * view.zoom;
    const bottom = Math.max(...points.map(p => p.y)) + 40 * view.zoom;
    return { name, bounds: { x: left, y: top, width: right - left, height: bottom - top }, width: headingWidth, height: 26 };
  }), instances, { x: 8, y: 8, width: width - 16, height: height - 16 });
});

function classCount(name: string, shown: number) {
  const total = summary.value?.classes.find((item) => item.class === name)?.instanceCount;
  return `${shown.toLocaleString(context.locale)} / ${total == null ? '…' : total.toLocaleString(context.locale)}`;
}

async function showDirectNeighborhood() {
  if (!selectedNode.value || !summary.value || rendering.value || expanding.value || versionChanged.value) return;
  const node = selectedNode.value;
  const request = graphRequest;
  expanding.value = true;
  try {
    const result = await loadInstanceNeighborhood(node.id, summary.value.version, 0, {});
    if (request !== graphRequest) return;
    overview.value = false;
    neighborClass.value = "";
    relationType.value = "";
    direction.value = "both";
    appliedNeighborFilters.value = {};
    nodes.value = result.nodes;
    edges.value = result.edges;
    neighborPages.value = { [node.id]: {
      nextOffset: result.nextOffset, total: result.total, loaded: result.edges.length,
    } };
    graphRequest += 1;
    selectNode(node.id);
    await renderGraph();
  } catch (reason) {
    if (request === graphRequest) reportGraphError(reason);
  } finally {
    expanding.value = false;
  }
}

async function focusNode(id: string | undefined) {
  if (!id || loading.value || rendering.value || layouting.value || expanding.value) return;
  const match = searchNodes.value.find((node) => node.id === id);
  if (!match) return;
  overview.value = false;
  clearSelection();
  nodes.value = [match];
  edges.value = [];
  neighborPages.value = {};
  graphRequest += 1;
  selectNode(id);
  await renderGraph();
  await showDirectNeighborhood();
  await canvas.value?.focus(id);
}

function scheduleSearch(term: string) {
  clearTimeout(searchTimer);
  const request = ++searchRequest;
  searchNodes.value = [];
  searchMore.value = false;
  searching.value = false;
  if (!term.trim() && !selectedClass.value) return;
  searching.value = true;
  searchTimer = setTimeout(() => { void runSearch(term, request); }, 250);
}

async function runSearch(term: string, request: number) {
  const version = summary.value?.version;
  if (!version) { searching.value = false; return; }
  try {
    const result = await searchInstanceGraph(term, version, selectedClass.value || undefined);
    if (request !== searchRequest) return;
    searchNodes.value = result.nodes;
    searchMore.value = result.hasMore;
  } catch (reason) {
    if (request === searchRequest) reportGraphError(reason);
  } finally {
    if (request === searchRequest) searching.value = false;
  }
}

function reportGraphError(reason: unknown) {
  if ((reason as { code?: string })?.code === "GRAPH_VERSION_CHANGED") versionChanged.value = true;
  else message.error(reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed"));
}

async function chooseClass(id: string) {
  clearSelection();
  selectedClass.value = id;
  clearTimeout(searchTimer);
  searching.value = true;
  await runSearch("", ++searchRequest);
}

async function showOverview() {
  if (!summary.value) return;
  graphRequest += 1;
  clearSelection();
  clearTimeout(searchTimer);
  searchRequest++;
  searching.value = false;
  searchNodes.value = [];
  searchMore.value = false;
  selectedClass.value = "";
  neighborPages.value = {};
  neighborClass.value = "";
  relationType.value = "";
  direction.value = "both";
  appliedNeighborFilters.value = {};
  overview.value = true;
  nodes.value = summary.value.overviewNodes || [];
  edges.value = summary.value.overviewEdges || [];
  await renderGraph();
}

async function expandNeighbors() {
  const node = selectedNode.value;
  const version = summary.value?.version;
  if (!node || !version || expanding.value || rendering.value || filtersDirty.value || versionChanged.value) return;
  const page = neighborPages.value[node.id];
  if (page?.nextOffset === null) return;
  const request = graphRequest;
  expanding.value = true;
  try {
    const result = await loadInstanceNeighborhood(node.id, version, page?.nextOffset ?? 0, appliedNeighborFilters.value);
    if (request !== graphRequest) return;
    const knownNodes = new Set(nodes.value.map((item) => item.id));
    const knownEdges = new Set(edges.value.map((item) => JSON.stringify([item.source, item.target, item.type])));
    const addedNodes = result.nodes.filter((item) => !knownNodes.has(item.id));
    const addedEdges = result.edges.filter((item) => !knownEdges.has(JSON.stringify([item.source, item.target, item.type])));
    const center = positions.value[node.id] ?? { x: 0, y: 0 };
    positions.value = { ...positions.value, ...Object.fromEntries(addedNodes.map((item, index) =>
      [item.id, neighborNodePosition((page?.loaded ?? 0) + index, center)])) };
    nodes.value = [...nodes.value, ...addedNodes];
    edges.value = [...edges.value, ...addedEdges];
    neighborPages.value = { ...neighborPages.value, [node.id]: {
      nextOffset: result.nextOffset, total: result.total,
      loaded: (page?.loaded ?? 0) + result.edges.length,
    } };
    if (fitAfterExpand.value) await fitGraph();
  } catch (reason) {
    if (request === graphRequest) reportGraphError(reason);
  } finally {
    expanding.value = false;
  }
}

async function applyNeighborhoodFilters() {
  if (!selectedNode.value || expanding.value || rendering.value) return;
  const node = selectedNode.value;
  appliedNeighborFilters.value = {
    ...(neighborClass.value ? { neighborClass: neighborClass.value } : {}),
    ...(relationType.value ? { relationType: relationType.value } : {}),
    ...(direction.value !== 'both' ? { direction: direction.value } : {}),
  };
  overview.value = false;
  nodes.value = [node];
  edges.value = [];
  neighborPages.value = {};
  graphRequest += 1;
  await renderGraph();
  await expandNeighbors();
}

function zoomIn() {
  void canvas.value?.zoomBy(1.2);
}

function zoomOut() {
  void canvas.value?.zoomBy(0.8);
}

function fitGraphView() {
  void fitGraph();
}

async function downloadGraph() {
  const blob = await canvas.value!.exportImage();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `instance-graph-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refresh() {
  connectionsLoading.value = false;
  clearTimeout(generationTimer);
  versionChanged.value = false;
  const request = ++graphRequest;
  clearTimeout(searchTimer);
  searchRequest++;
  summary.value = null;
  selectedClass.value = "";
  searchMore.value = false;
  searching.value = false;
  searchNodes.value = [];
  clearSelection();
  layouting.value = false;
  nodes.value = [];
  edges.value = [];
  loading.value = true;
  error.value = "";
  try {
    const [result, ontology] = await Promise.all([loadInstanceGraphSummary(), loadOntology()]);
    if (request !== graphRequest) return;
    classLabels.value = Object.fromEntries(
      ontology.objects.map((object) => [object.className, object.showName])
    );
    relationLabels.value = Object.fromEntries(ontology.relations.map((relation) => [relation.relationship, relation.showName || relation.relationship]));
    status.value = result.status;
    if (result.status === "READY") {
      summary.value = result.summary;
      loading.value = false;
      const overviewRequest = graphRequest + 1;
      await showOverview();
      connectionsLoading.value = true;
      void loadInstanceGraphConnections(result.summary.version, result.summary.sampleToken).then(connections => {
        if (overviewRequest !== graphRequest || !summary.value || connections.version !== summary.value.version) return;
        const visible = new Set(summary.value.overviewNodes?.map(node => node.id));
        const connectedEdges = connections.overviewEdges.filter(edge => visible.has(edge.source) && visible.has(edge.target));
        summary.value = { ...summary.value, overviewEdges: connectedEdges, overviewEdgesTruncated: connections.overviewEdgesTruncated };
        if (overview.value) edges.value = connectedEdges;
      }).catch(reason => { if (overviewRequest === graphRequest) reportGraphError(reason); })
        .finally(() => { if (overviewRequest === graphRequest) connectionsLoading.value = false; });
    } else if (result.status === "GENERATING") {
      generationTimer = setTimeout(() => { void refresh(); }, 2000);
    }
  } catch (reason) {
    if (request !== graphRequest) return;
    error.value = reason instanceof Error ? reason.message : ot("loadInstanceGraphFailed");
  } finally {
    if (request === graphRequest) loading.value = false;
  }
}

const isEmpty = computed(() => !loading.value && !error.value && nodes.value.length === 0);

onMounted(() => {
  paletteSize.value = readGraphPalette(root.value!).length;
  void refresh();
});

onBeforeUnmount(() => {
  clearTimeout(generationTimer);
  clearTimeout(searchTimer);
  searchRequest++;
  graphRequest += 1;
  nodeInfoRequest += 1;
});
</script>

<template>
  <section
    ref="root"
    v-loading="loading || rendering"
    :element-loading-text="rendering ? ot('instanceGraphRenderProgress', { completed: drawing.drawn, total: drawing.total }) : undefined"
    class="instance-graph"
  >
    <div class="graph-canvas">
      <G6GraphCanvas
        ref="canvas"
        class="graph-viewport"
        :label="ot('instanceGraphTitle')"
        :nodes="canvasNodes"
        :edges="canvasEdges"
        :selected="selectedNode ? [selectedNode.id] : []"
        :layout="{ type: 'preset' }"
        @update:selected="chooseNode"
        @blank="clearSelection"
        @activate="activate"
        @move="moveNode"
        @viewport="viewport = $event"
        @progress="(drawn, total) => (drawing = { drawn, total })"
      />
      <div v-if="summary && overview" class="sample-legend class-groups" :aria-label="t('nav.objectTypes')">
        <div v-for="group in classGroups" :key="group.name" class="class-group"
          :style="{ left: `${group.x}px`, top: `${group.y}px`, width: `${group.width}px`, height: `${group.height}px`, '--group-color': colorForClass(group.name) }">
          <ElTooltip v-bind="actionTooltipProps" placement="top" :content="classLabels[group.name] || group.name">
            <button type="button" :class="{ 'is-selected': selectedClass === group.name }"
              :aria-pressed="selectedClass === group.name" @click.stop="chooseClass(group.name)">
              <span class="legend-label">{{ classLabels[group.name] || group.name }}</span>
              <span class="legend-count">{{ classCount(group.name, nodes.filter(node => node.class === group.name).length) }}</span>
            </button>
          </ElTooltip>
        </div>
      </div>
    </div>
    <el-button v-if="summary && !overview" class="back-to-overview" :icon="ArrowLeft" :disabled="loading || rendering || expanding || layouting" @click="showOverview()">{{ ot('instanceGraphBackToOverview') }}</el-button>
    <div v-if="selectedNode && nodeActionPosition" class="node-actions"
      :style="{ left: `${nodeActionPosition.x}px`, top: `${nodeActionPosition.y}px` }"
      role="toolbar" :aria-label="selectedNode.name || selectedNode.id">
      <ManagerIconButton :icon="GitFork" :label="ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand')"
        :loading="expanding" :disabled="rendering || filtersDirty || versionChanged || currentPage?.nextOffset === null" @click="expandNeighbors" />
      <ManagerIconButton :icon="Waypoints" :label="ot('instanceGraphCollapse')"
        :disabled="expanding || rendering || versionChanged" @click="showDirectNeighborhood" />
    </div>
    <div v-if="error" class="graph-empty" role="alert"><strong>{{ error }}</strong></div>

    <div v-if="isEmpty" class="graph-empty">
      <Unplug :size="30" />
      <template v-if="status === 'NOT_GENERATED'">
        <strong>{{ ot("instanceGraphNotGenerated") }}</strong>
        <el-button type="primary" :icon="RefreshCw" @click="refresh">
          {{ t("common.refresh") }}
        </el-button>
      </template>
      <strong v-else-if="status === 'GENERATING'">{{ ot("instanceGraphGenerating") }}</strong>
      <template v-else>
        <strong>{{ ot("instanceGraphEmpty") }}</strong>
        <span>{{ ot("instanceGraphEmptyDesc") }}</span>
      </template>
    </div>

    <div class="graph-toolbar" role="toolbar" :aria-label="ot('instanceGraphTitle')">
      <ManagerIconButton :icon="Plus" :label="ot('zoomIn')" @click="zoomIn" />
      <ManagerIconButton :icon="Minus" :label="ot('zoomOut')" @click="zoomOut" />
      <ManagerIconButton :icon="Maximize" :label="ot('fitCanvas')" @click="fitGraphView" />
      <span class="toolbar-separator" aria-hidden="true" />
      <el-popover trigger="click" :width="260" placement="top-start" :teleported="false">
        <template #reference>
          <button type="button" class="manager-icon-button" :title="ot('instanceGraphDisplaySettings')" :aria-label="ot('instanceGraphDisplaySettings')"><Settings2 :size="16" aria-hidden="true" /></button>
        </template>
        <div class="graph-display-settings">
          <strong>{{ ot('instanceGraphDisplaySettings') }}</strong>
          <label class="display-setting">
            <span>{{ ot('instanceGraphRelationLabels') }}</span>
            <el-switch :model-value="showRelationLabels" :aria-label="ot('instanceGraphRelationLabels')" :disabled="loading || rendering || expanding" size="small" @change="showRelationLabels = !showRelationLabels" />
          </label>
          <label v-if="summary && overview" class="display-setting" :title="ot('instanceGraphAggregateHint')">
            <span>{{ ot('instanceGraphAggregateRelations') }}</span>
            <el-switch :model-value="aggregateRelations" :aria-label="ot('instanceGraphAggregateRelations')" :disabled="loading || rendering || expanding || layouting" size="small" @change="aggregateRelations = !aggregateRelations" />
          </label>
        </div>
      </el-popover>
      <ManagerIconButton :icon="Network" :label="ot('relayout')" :loading="layouting" :disabled="loading || rendering || expanding" @click="relayoutGraph" />
      <span class="toolbar-separator" aria-hidden="true" />
      <ManagerIconButton :icon="Download" :label="ot('downloadPng')" @click="downloadGraph" />
      <ManagerIconButton :icon="RefreshCw" :label="t('common.refresh')" :loading="loading" :disabled="expanding" @click="refresh" />
    </div>

    <div class="graph-hint">
      <span />
      {{ ot("instanceGraphHint") }}
    </div>

    <Teleport :to="props.summaryTarget || 'body'" :disabled="!props.summaryTarget">
    <div v-if="summary" class="graph-summary">
      <div class="summary-row">
        <strong class="summary-title">{{ overview ? ot('instanceGraphOverview') : selectedNode?.name }}</strong>
        <span class="summary-counts">{{ ot('instanceGraphLiveCount', { nodes: nodes.length.toLocaleString(context.locale), totalNodes: summary.nodeCount == null ? '…' : summary.nodeCount.toLocaleString(context.locale), edges: edges.length.toLocaleString(context.locale) }) }}</span>
        <span v-if="connectionsLoading && overview" class="summary-counts" role="status">{{ ot('instanceGraphGenerating') }}</span>
        <el-popover trigger="click" :width="300" :teleported="false" placement="bottom-start">
          <template #reference>
            <button ref="statisticsButton" type="button" class="summary-info" :aria-label="ot('instanceGraphStatistics')"><Info :size="15" aria-hidden="true" /></button>
          </template>
          <div class="summary-details">
            <strong>{{ ot('instanceGraphStatistics') }}</strong>
            <span>{{ ot('instanceGraphLiveDescription') }}</span>
            <span v-if="overview && aggregateRelations">{{ ot('instanceGraphAggregateHint') }}</span>
            <span v-if="overview">{{ ot('instanceGraphSample', { shown: nodes.length, total: summary.nodeCount == null ? '…' : summary.nodeCount, edges: edges.length }) }}</span>
            <span v-if="overview && summary.overviewEdgesTruncated" class="graph-warning">{{ ot('instanceGraphSampleEdgesLimited') }}</span>
          </div>
        </el-popover>
        <ElTooltip v-if="statisticsButton" v-bind="actionTooltipProps" virtual-triggering :virtual-ref="statisticsButton" :content="ot('instanceGraphStatistics')" />
      </div>
      <small v-if="overview && summary.overviewEdgesTruncated" class="graph-warning">{{ ot('instanceGraphSampleEdgesLimited') }}</small>
      <small v-if="summary.complete === false" role="alert" class="graph-warning">{{ ot('instanceGraphPartial', { failures: (summary.failures || []).join(', ') }) }}</small>
      <el-button v-if="versionChanged" size="small" :icon="RefreshCw" @click="refresh">{{ ot('instanceGraphVersionChanged') }}</el-button>
    </div>
    </Teleport>

    <aside class="inspector-panel">
      <div class="node-search">
        <el-select v-if="summary && overview" :model-value="selectedClass" filterable clearable
          :placeholder="ot('allObjectTypes')" :aria-label="t('nav.objectTypes')"
          :disabled="loading || layouting || rendering || expanding" @change="chooseClass($event || '')">
          <el-option v-for="item in summary.classes" :key="item.class" :value="item.class"
            :label="classLabels[item.class] || item.class">
            <span>{{ classLabels[item.class] || item.class }}</span>
            <small class="class-option-count">{{ item.instanceCount?.toLocaleString(context.locale) ?? '…' }}</small>
          </el-option>
        </el-select>
        <el-select-v2
          class="instance-search"
          :model-value="selectedNode?.id"
          :options="searchOptions"
          :placeholder="ot('searchInstanceNodes')"
          :aria-label="ot('searchInstanceNodes')"
          :no-match-text="ot('noMatchingResources')"
          :disabled="loading || layouting || rendering || expanding || !summary"
          :loading="searching"
          remote
          :debounce="0"
          :remote-method="scheduleSearch"
          :item-height="52"
          filterable
          clearable
          @change="focusNode"
          @clear="clearSelection"
        >
          <template #prefix><Search :size="15" /></template>
          <template #label="{ value }">
            {{ selectedNode?.name || value }}
          </template>
          <template #default="{ item }">
            <div class="node-search-option">
              <strong :title="item.name">{{ item.name }}</strong>
              <small :title="item.description">{{ item.description }}</small>
            </div>
          </template>
        </el-select-v2>
        <div v-if="selectedClass" class="search-scope">
          <Box :size="13" aria-hidden="true" />
          <span :title="classLabels[selectedClass] || selectedClass">{{ classLabels[selectedClass] || selectedClass }}</span>
          <button :title="ot('instanceGraphClearScope')" :aria-label="ot('instanceGraphClearScope')" @click="selectedClass = ''; scheduleSearch('')"><X :size="13" /></button>
        </div>
        <p v-if="searchMore" class="search-status" role="status">{{ ot('instanceGraphSearchMore') }}</p>
        <div v-if="overview && searchNodes.length" class="instance-candidates">
          <button v-for="node in searchNodes" :key="node.id" :disabled="rendering || expanding" @click="focusNode(node.id)">
            <span class="candidate-copy">
              <span class="candidate-name" :title="node.name || node.id">{{ node.name || node.id }}</span>
              <span class="candidate-meta" :title="`${classLabels[node.class] || node.class} · ${node.id}`">{{ classLabels[node.class] || node.class }} · {{ node.id }}</span>
            </span>
          </button>
        </div>
      </div>
      <div v-if="selectedNode" class="detail-content">
        <div class="neighbor-filters">
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphNeighbor') }}</span>
          <el-select v-model="neighborClass" clearable :placeholder="ot('allObjectTypes')" :aria-label="ot('instanceGraphNeighbor')" :disabled="expanding || rendering">
            <el-option v-for="item in summary?.classes" :key="item.class" :value="item.class" :label="classLabels[item.class] || item.class" />
          </el-select>
          </div>
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphRelation') }}</span>
          <el-select v-model="relationType" clearable :placeholder="ot('instanceGraphAllRelations')" :aria-label="ot('instanceGraphRelation')" :disabled="expanding || rendering">
            <el-option v-for="type in summary?.relationTypes" :key="type" :value="type" :label="relationLabels[type] || type" />
          </el-select>
          </div>
          <div class="neighbor-field neighbor-field-wide">
          <span class="neighbor-label">{{ ot('instanceGraphDirection') }}</span>
          <el-select v-model="direction" :aria-label="ot('instanceGraphDirection')" :disabled="expanding || rendering">
            <el-option value="both" :label="ot('instanceGraphBoth')" />
            <el-option value="incoming" :label="ot('instanceGraphIncoming')" />
            <el-option value="outgoing" :label="ot('instanceGraphOutgoing')" />
          </el-select>
          </div>
          <div class="neighbor-filter-actions">
            <el-checkbox v-model="fitAfterExpand">{{ ot('instanceGraphKeepView') }}</el-checkbox>
            <el-button :icon="SlidersHorizontal" type="primary" :loading="expanding" :disabled="expanding || rendering" @click="applyNeighborhoodFilters">{{ ot('instanceGraphApply') }}</el-button>
            <el-button :icon="GitFork" :loading="expanding" :disabled="rendering || filtersDirty || versionChanged || currentPage?.nextOffset === null" @click="expandNeighbors">{{ ot(currentPage ? 'instanceGraphMore' : 'instanceGraphExpand') }}</el-button>
          </div>
        </div>
        <div class="detail-title">
          <span class="resource-icon"><Box :size="16" /></span>
          <div class="detail-title-copy">
            <h2>{{ selectedNode.name || selectedNode.id }}</h2>
            <code>{{ selectedNode.id }}</code>
          </div>
          <el-button class="object-view-entry" :icon="Eye" @click="openSelectedObject">{{ ot('ovViewDetails') }}</el-button>
        </div>
        <div class="detail-section">
          <div class="section-label">
            <span>{{ ot("instanceClass") }}</span>
          </div>
          <p class="class-label">{{ selectedClassLabel }}</p>
        </div>
        <div class="detail-section">
          <div class="section-label">
            <span>{{ ot("attributes") }}</span>
            <small>{{ selectedAttributes.length }}</small>
          </div>
          <div v-if="selectedAttributes.length" class="attribute-list">
            <div
              v-for="attribute in selectedAttributes"
              :key="attribute.name"
              class="attribute-row"
            >
              <span>{{ attribute.showName }}</span>
              <code>{{ attribute.value == null ? "-" : String(attribute.value) }}</code>
            </div>
          </div>
          <p v-else class="empty-hint" :role="detailsError ? 'alert' : 'status'">{{ detailsLoading ? ot('instanceGraphDetailsLoading') : detailsError || ot("noAttributes") }}</p>
        </div>
      </div>
      <div v-else class="inspector-empty">
        <div class="empty-mark"><MousePointerClick :size="24" /></div>
        <strong>{{ ot("selectGraphElement") }}</strong>
        <span>{{ ot("instanceGraphChoose") }}</span>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.instance-graph {
  --inspector-width: var(--shell-inspector);
  --el-font-size-base: var(--text-sm);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--inspector-width);
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-shell);
   background-color: var(--el-bg-color-page);
  background-image: radial-gradient(var(--el-border-color) 1px, transparent 1px);
  background-size: 20px 20px;
}
.graph-canvas {
  position: relative;
  display: flex;
  flex-direction: column;
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.graph-viewport { flex: 1; min-width: 0; min-height: 0; position: relative; }
.class-groups { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.class-group { position: absolute; box-sizing: border-box; pointer-events: none; }
.class-group > button { pointer-events: auto; width: 100%; }
.back-to-overview { position: absolute; top: 16px; left: 16px; z-index: 3; margin: 0; max-width: calc(100% - var(--inspector-width) - 32px); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); }
.neighbor-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  order: 1;
  gap: var(--manager-content-gap) var(--manager-control-gap);
  margin: 0;
  padding-top: var(--manager-content-gap);
  border-top: 1px solid var(--el-border-color-light);
  font-size: var(--text-sm);
}
.neighbor-field { display: grid; min-width: 0; gap: var(--spacing-xs); }
.neighbor-field-wide { grid-column: 1 / -1; }
.neighbor-label { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 16px; font-weight: var(--font-medium); }
.neighbor-filters :deep(.el-select) { min-width: 0; width: 100%; }
.neighbor-filters :deep(.el-select__wrapper) { min-height: 32px; padding: 4px var(--spacing-sm); }
.neighbor-filters :deep(.el-select__placeholder),
.neighbor-filters :deep(.el-select__selected-item),
.neighbor-filters :deep(.el-select__input),
.neighbor-filters :deep(.el-button) { font-size: var(--text-sm); line-height: 20px; }
.neighbor-filter-actions { display: grid; grid-column: 1 / -1; gap: var(--spacing-sm); padding-top: var(--spacing-xs); }
.neighbor-filter-actions .el-checkbox { height: 24px; margin: 0; }
.neighbor-filter-actions :deep(.el-checkbox__label) { padding-left: var(--spacing-sm); font-size: var(--text-xs); line-height: 16px; }
.neighbor-filter-actions .el-button { width: 100%; margin: 0; }
.neighbor-filter-actions :deep(.el-button .el-icon) { font-size: 15px; }
.node-actions { position: absolute; z-index: 3; transform: translate(-50%, -100%); }
.node-actions,
.graph-toolbar {
  display: flex;
  align-items: center;
  padding: var(--spacing-xs);
  gap: var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.graph-warning { color: var(--el-color-warning); }
.graph-toolbar {
  position: absolute;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  max-width: calc(100% - var(--inspector-width) - 32px);
  flex-wrap: wrap;
  z-index: 2;
  padding: var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.toolbar-separator { flex: 0 0 1px; height: 18px; margin: 0 3px; background: var(--el-border-color-light); }
.graph-toolbar button[aria-expanded="true"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.graph-toolbar button[aria-pressed="true"] { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.graph-toolbar button,
.node-actions button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: var(--el-text-color-secondary);
  background: transparent;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.graph-toolbar button:hover:not(:disabled),
.node-actions button:hover:not(:disabled) {
  color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}
.graph-toolbar button[aria-pressed="true"]:hover:not(:disabled) { background: var(--el-color-primary-light-8); }
.graph-hint {
  position: absolute;
  right: calc(var(--inspector-width) + 18px);
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: var(--manager-control-gap);
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
}
.graph-hint span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
}
.graph-empty {
  position: absolute;
  inset: 0;
  right: var(--inspector-width);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  pointer-events: none;
}
.graph-empty strong {
  color: var(--el-text-color-primary);
}
.graph-empty span {
  font-size: var(--text-sm);
}
.graph-empty .el-button {
  margin-top: 8px;
  pointer-events: auto;
}
.inspector-panel {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 0;
  width: var(--inspector-width);
  flex: 0 0 var(--inspector-width);
  flex-direction: column;
  margin-left: auto;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  overflow: auto;
  grid-column: 2;
  grid-row: 1;
}
.panel-heading {
  display: flex;
  box-sizing: border-box;
  min-height: var(--panel-header-height);
  align-items: center;
  justify-content: space-between;
  padding: var(--manager-content-gap) var(--manager-module-padding);
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-secondary);
}
.graph-display-settings { display: grid; gap: var(--spacing-sm); }
.graph-display-settings > strong { color: var(--el-text-color-primary); font-size: var(--text-sm); }
.display-setting { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md); min-height: 28px; color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.display-setting > span { min-width: 0; }
.display-setting .el-switch { flex-shrink: 0; }
.node-search {
  display: grid;
  min-width: 0;
  gap: var(--spacing-sm);
  padding: var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.node-search :deep(.el-select-v2) {
  width: 100%;
  min-width: 0;
  --el-font-size-base: var(--text-sm);
}
.node-search :deep(.el-select__wrapper) {
  min-height: 32px;
  padding: 4px var(--spacing-md);
  gap: var(--spacing-sm);
}
.node-search :deep(.el-select__input),
.node-search :deep(.el-select__placeholder),
.node-search :deep(.el-select__selected-item) {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 20px;
}
.node-search :deep(.el-select__prefix) {
  color: var(--el-text-color-secondary);
}
.search-scope {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px var(--spacing-sm);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.search-scope > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-scope > svg { flex-shrink: 0; }
.search-scope button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--el-text-color-secondary);
}
.search-scope button:hover { color: var(--el-color-primary); background: var(--el-fill-color); }
.search-status {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
}
.graph-summary {
  position: relative;
  padding: 0;
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
  gap: var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.graph-summary .el-button { pointer-events: auto; }
.summary-row { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; gap: var(--spacing-sm); min-height: 24px; }
.summary-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--el-text-color-primary); }
.summary-counts { font-size: var(--text-xs); line-height: var(--leading-relaxed); overflow-wrap: anywhere; }
.summary-row > .el-button { margin-left: auto; flex-shrink: 0; }
.summary-info { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--el-text-color-secondary); }
.summary-info:hover { color: var(--el-color-primary); background: var(--el-fill-color-light); }
.summary-details { display: grid; gap: var(--spacing-sm); font-size: var(--text-xs); line-height: var(--leading-relaxed); }
.summary-details strong { font-size: var(--text-sm); }
.sample-legend button { display: flex; box-sizing: border-box; height: 100%; max-width: 100%; min-width: 0; align-items: center; padding: 4px 9px; border: 1px solid var(--el-border-color-light); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--group-color) 8%, var(--el-bg-color)); color: var(--el-text-color-primary); font: inherit; font-size: 12px; font-weight: 600; line-height: 16px; text-align: center; cursor: pointer; }
.sample-legend button:hover { background: color-mix(in srgb, var(--group-color) 26%, var(--el-bg-color)); }
.sample-legend button.is-selected { background: color-mix(in srgb, var(--group-color) 32%, var(--el-bg-color)); color: var(--el-text-color-primary); font-weight: var(--font-semibold); }
.sample-legend button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.legend-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--el-text-color-primary); }
.legend-count { flex: none; margin-left: 6px; color: var(--el-text-color-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.class-option-count { float: right; margin-left: 12px; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.instance-candidates { display: grid; gap: 2px; min-width: 0; max-height: 260px; overflow: auto; }
.instance-candidates button {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 6px var(--spacing-sm);
  text-align: left;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: 18px;
}
.instance-candidates button:hover { background: var(--el-fill-color-light); }
.instance-candidates button:disabled { opacity: 0.5; }
.candidate-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.candidate-name, .candidate-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.candidate-name { font-size: var(--text-sm); font-weight: var(--font-medium); }
.candidate-meta { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 16px; }
.node-search-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  height: 52px;
  line-height: 20px;
}
.node-search-option strong,
.node-search-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-search-option strong {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.node-search-option small {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.panel-heading strong {
  display: block;
}
.panel-heading strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.detail-content {
  display: flex;
  flex-direction: column;
  gap: var(--manager-module-gap);
  padding: var(--manager-module-padding);
}
.detail-title {
  display: flex;
  align-items: flex-start;
  gap: var(--manager-content-gap);
  padding-bottom: var(--manager-content-gap);
  border-bottom: 1px solid var(--el-border-color-light);
}
.resource-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--brand-link);
  background: var(--brand-primary-tint);
}
.detail-title-copy {
  min-width: 0;
  flex: 1;
}
.object-view-entry { flex-shrink: 0; margin: 0; }
.detail-title h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  overflow: hidden;
  font-size: var(--text-sm);
  line-height: 20px;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: normal;
  overflow-wrap: anywhere;
}
code {
  display: block;
  overflow: hidden;
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--manager-content-gap);
}
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.section-label small {
  color: var(--el-text-color-tertiary);
}
.class-label {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.attribute-list {
  margin: 0;
}
.attribute-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.attribute-row span {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.attribute-row code {
  max-width: 60%;
  color: var(--el-text-color-secondary);
  text-align: right;
  white-space: normal;
  overflow-wrap: anywhere;
  user-select: text;
}
.empty-hint {
  margin: 0;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
}
.inspector-empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: var(--manager-control-gap);
  padding: var(--manager-module-padding);
  color: var(--el-text-color-secondary);
  text-align: center;
}
.inspector-empty strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
.inspector-empty span {
  max-width: 220px;
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
  white-space: normal;
}
.empty-mark {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 50%;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
@container ontology-manager (max-width: 768px) {
  .back-to-overview { max-width: calc(100% - 32px); }
  .instance-graph { grid-template-columns: minmax(0, 1fr); grid-template-rows: 320px auto; overflow: auto; }
  .graph-canvas,
  .graph-empty {
    right: 0;
    bottom: auto;
    height: 320px;
  }
  .inspector-panel {
    position: relative;
    width: 100%;
    flex: 0 0 auto;
    margin-top: 0;
    grid-column: 1;
    grid-row: 2;
    border-left: 0;
    border-top: 1px solid var(--el-border-color);
    overflow: visible;
  }
  .graph-hint {
    display: none;
  }
  .graph-toolbar { position: relative; grid-column: 1; grid-row: 1; align-self: end; justify-self: start; z-index: 2; top: auto; bottom: 10px; left: 10px; max-width: calc(100% - 20px); }
}
</style>
