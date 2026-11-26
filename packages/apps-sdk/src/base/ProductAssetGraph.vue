<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElTooltip } from "element-plus/es/components/tooltip/index";
import { productDefaultTexts } from "@ontomato/contracts/product-assets";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMember, useMemberData, useMemberOutput, useMemberParam } from "../panel/member";
import { useDataStateLabels } from "./data-state-labels";
import {
  computeProductAssetGraphLayout,
  extractProductAssetGraph,
  PRODUCT_ASSET_CARD_HEIGHT,
  PRODUCT_ASSET_CARD_WIDTH,
  PRODUCT_ASSET_COLUMN_OFFSET_X,
  PRODUCT_ASSET_COLUMN_PITCH,
  productAssetEdgePath,
  resolveProductAssetTarget,
  type ProductAssetGraphCategory,
  type ProductAssetGraphData,
  type ProductAssetGraphEdge,
  type ProductAssetGraphNode,
  type ProductAssetGraphTarget,
} from "./product-asset-graph-types";

defineOptions({ name: "ProductAssetGraph" });

/**
 * Platform-dedicated layered product asset reference graph (`panelUsable: false`).
 *
 * Shared across Product Overview, Projection Detail, Panel Detail, and Application Detail. Accepts either a bound
 * `graph` datum (`panelRecord` or raw `{ nodes, edges }`) or a direct `graph` prop, lays out asset cards in fixed
 * category columns connected by SVG cubic Bezier arrows, highlights all incident edges and relation labels on pointer
 * hover or keyboard focus while muting unrelated edges, emits `open` and `navigate` (and writes the optional `navigate`
 * member state) with real asset identity on click or Enter, and provides zoom, fit, actual-size, and built-in
 * fullscreen dialog preview controls.
 */
const props = withDefaults(
  defineProps<{
    /** Direct product asset graph payload (standalone usage outside a bound `graph` datum). */
    graph?: ProductAssetGraphData | Record<string, unknown> | null;
    /** Whether this instance is already rendered in the expanded fullscreen preview dialog. */
    expanded?: boolean;
    /** Optional title shown in the fullscreen preview dialog header. */
    title?: string;
    /** Whether to render the explanatory legend caption strip below the controls (default `true`). */
    showCaption?: boolean;
    /** Optional custom empty state description when no nodes are present. */
    emptyText?: string;
  }>(),
  {
    graph: undefined,
    expanded: false,
    title: undefined,
    showCaption: true,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader clicks or presses Enter on an asset card. */
  open: [target: ProductAssetGraphTarget];
  /** Emitted alongside `open` with the same resolved asset identity for navigation bindings. */
  navigate: [target: ProductAssetGraphTarget];
}>();

const member = (() => {
  try {
    return useMember();
  } catch {
    return null;
  }
})();

const graphDatum = (() => {
  if (!member?.projection.data?.graph) return null;
  try {
    return useMemberData("graph");
  } catch {
    return null;
  }
})();

const navigateParam = member ? useMemberParam("navigate") : null;

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

function translate(keys: readonly string[], fallback: string, params?: Record<string, unknown>): string {
  if (i18n) {
    for (const key of keys) {
      if (i18n.te(key)) {
        return params ? i18n.t(key, params) : i18n.t(key);
      }
    }
  }
  if (!params) return fallback;
  return fallback.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
}

const dataStateLabels = useDataStateLabels();

const DEFAULT_TEXT_KEYS = new Map<string, readonly [string, string]>([
  [productDefaultTexts.homeName, ["ontology.productDefaultHomeName", "Home"]],
  [productDefaultTexts.homeDescription, ["ontology.productDefaultHomeDescription", "Default home page"]],
  [productDefaultTexts.initialHomeName, ["ontology.productHomeTitle", "Home"]],
  [productDefaultTexts.apps, ["ontology.productHomeResources", "Resources"]],
  [productDefaultTexts.data, ["ontology.productHomeFollowedData", "Followed data"]],
  [productDefaultTexts.tasks, ["ontology.productSourceTasks", "Task activity"]],
  [productDefaultTexts.conversations, ["ontology.productDefaultContinueWork", "Continue work"]],
  [productDefaultTexts.objects, ["ontology.productDefaultFavorites", "Favorites"]],
  [productDefaultTexts.recent, ["ontology.productSourceRecent", "Recent visits"]],
  [productDefaultTexts.legacyAssistant, ["ontology.productHomeAskHeading", "Data Q&A"]],
  [productDefaultTexts.legacyAssistantDescription, ["ontology.productHomeAskDescription", "Ask questions about your data"]],
  [productDefaultTexts.legacyConversations, ["ontology.productHomeContinueAnalysis", "Analysis conversations"]],
  [productDefaultTexts.legacyObjects, ["ontology.productDefaultPinnedObjects", "Pinned objects"]],
  [productDefaultTexts.platformPageDescription, ["ontology.productDefaultPlatformPageDescription", "Platform page"]],
  [productDefaultTexts.graphDomainMembers, ["ontology.productDomainMembers", "Domain members"]],
  [productDefaultTexts.graphNameUnavailable, ["ontology.productNameUnavailable", "Name unavailable"]],
  [productDefaultTexts.graphAgentDefinition, ["ontology.productAgentDefinition", "Referenced agent"]],
  [productDefaultTexts.graphRoleUnavailable, ["ontology.productRoleNameUnavailable", "Role name unavailable"]],
  [productDefaultTexts.graphPrincipalUnavailable, ["ontology.productPrincipalNameUnavailable", "Member name unavailable"]],
  [productDefaultTexts.graphMetricUnavailable, ["ontology.productMetricViewNameUnavailable", "Metric view name unavailable"]],
  [productDefaultTexts.graphActionUnavailable, ["ontology.productActionNameUnavailable", "Action name unavailable"]],
  [productDefaultTexts.graphDefinitionUnavailable, ["ontology.productDefinitionNameUnavailable", "Definition name unavailable"]],
  [productDefaultTexts.graphObjectTypeUnavailable, ["ontology.productObjectTypeNameUnavailable", "Object type name unavailable"]],
  [productDefaultTexts.graphApplicationUnavailable, ["ontology.productApplicationNameUnavailable", "Application name unavailable"]],
]);

function displayNodeName(value: string): string {
  const mapped = DEFAULT_TEXT_KEYS.get(value);
  if (!mapped) return value;
  return translate([mapped[0]], mapped[1]);
}

const COLUMN_LABELS: Record<ProductAssetGraphCategory, readonly [string, string]> = {
  principal: ["ontology.productGraphPrincipals", "Members and roles"],
  bundle: ["ontology.productBundle", "Delivery bundles"],
  composition: ["ontology.productComposition", "Composition assets"],
  element: ["ontology.productProjection", "Projection assets"],
  ontology: ["ontology.productOntologyElements", "Ontology elements"],
  legacy: ["ontology.productLegacyAssets", "Assets to migrate"],
};

function columnLabel(category: ProductAssetGraphCategory): string {
  const [key, fallback] = COLUMN_LABELS[category];
  return translate([key], fallback);
}

const EDGE_LABELS: Record<string, readonly [string, string]> = {
  renders: ["ontology.productEdgeRenders", "Renders"],
  contains: ["ontology.productEdgeContains", "Contains"],
  navigates: ["ontology.productEdgeNavigates", "Navigates to"],
  tools: ["ontology.productTools", "Tools"],
  context: ["ontology.productEdgeContext", "Context"],
  embodies: ["ontology.productEdgeEmbodies", "Embodies"],
  identity: ["ontology.productApplicationIdentity", "Application identity"],
  "depends-on": ["ontology.productEdgeDependsOn", "Depends on"],
  use: ["ontology.productEdgeUse", "Use grant"],
  edit: ["ontology.productEditGrant", "Edit access"],
};

function edgeLabel(relation: string): string {
  const entry = EDGE_LABELS[relation];
  return entry ? translate([entry[0]], entry[1]) : relation;
}

const KIND_LABELS: Record<string, readonly [string, string]> = {
  "object-projection": ["ontology.productObjectView", "Object View"],
  "collection-view": ["ontology.productCollectionView", "Collection View"],
  "metric-widget": ["ontology.productMetricWidget", "Metric Widget"],
  "action-view": ["ontology.productActionView", "Action View"],
  navigation: ["ontology.productNavigation", "Navigation"],
  application: ["ontology.productApplication", "Application"],
  "object-type": ["ontology.productTargetObjectType", "Object type"],
  metric: ["ontology.productTargetMetricView", "Metric view"],
  action: ["ontology.productTargetAction", "Action"],
  definition: ["ontology.productTargetDefinition", "Business definition"],
  AgentDefinition: ["ontology.productAgentDefinition", "Referenced agent"],
  principal: ["ontology.productPrincipal", "Member"],
  role: ["ontology.productRole", "Role"],
  domain: ["ontology.productDomainMembers", "Domain members"],
};

function nodeKindLabel(node: ProductAssetGraphNode): string {
  if (node.kind === "page") {
    if (node.isTemplate) return translate(["ontology.productPageTemplate"], "Page template");
    if (node.embeddable) return translate(["ontology.productEmbeddablePage"], "Embeddable page");
    return translate(["ontology.productPage"], "Page");
  }
  const entry = KIND_LABELS[node.kind];
  return entry ? translate([entry[0]], entry[1]) : node.kind;
}

const graphState = computed<DataStateResult<ProductAssetGraphData>>(() => {
  if (props.graph !== undefined) {
    const parsed = extractProductAssetGraph(props.graph);
    if (!parsed || !parsed.nodes.length) return { status: "empty" };
    return { status: "ready", value: parsed };
  }
  if (!graphDatum) return { status: "empty" };
  const state = graphDatum.value;
  if (state.status !== "ready") return state as DataStateResult<ProductAssetGraphData>;
  const parsed = extractProductAssetGraph(state.value);
  if (!parsed || !parsed.nodes.length) return { status: "empty" };
  return { status: "ready", value: parsed };
});

const resolvedGraph = computed<ProductAssetGraphData | null>(() =>
  graphState.value.status === "ready" ? graphState.value.value : null,
);

const layout = computed(() =>
  resolvedGraph.value ? computeProductAssetGraphLayout(resolvedGraph.value) : null,
);

if (member) {
  useMemberOutput("status", () => graphState.value.status);
  useMemberOutput("nodeCount", () => resolvedGraph.value?.nodes.length ?? 0);
  useMemberOutput("edgeCount", () => layout.value?.validEdges.length ?? 0);
}

const graphId = useId().replace(/:/g, "");
const fullscreen = ref(false);
const scale = ref(1);
const canvasEl = ref<HTMLElement | null>(null);
const focusedNode = ref<string | null>(null);

const MIN_SCALE = 0.08;
const MAX_SCALE = 2;
const SCALE_STEP = 1.25;

function zoomOut(): void {
  scale.value = Math.max(MIN_SCALE, scale.value / SCALE_STEP);
}

function zoomIn(): void {
  scale.value = Math.min(MAX_SCALE, scale.value * SCALE_STEP);
}

function actualSize(): void {
  scale.value = 1;
}

function fit(): void {
  const el = canvasEl.value;
  const current = layout.value;
  if (!el || !current || current.width <= 0 || current.height <= 0) return;
  const availableWidth = el.clientWidth - 32;
  const availableHeight = el.clientHeight - 32;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  scale.value = Math.max(
    MIN_SCALE,
    Math.min(1, availableWidth / current.width, availableHeight / current.height),
  );
}

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  if (props.expanded && canvasEl.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(canvasEl.value);
    fit();
  }
});

watch(
  () => [props.expanded, canvasEl.value, layout.value?.width, layout.value?.height] as const,
  ([isExpanded, el]) => {
    if (!isExpanded || !el) return;
    if (!resizeObserver && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(el);
    }
    fit();
  },
);

onBeforeUnmount(() => resizeObserver?.disconnect());

function isRelatedEdge(edge: ProductAssetGraphEdge): boolean {
  return focusedNode.value !== null && (edge.source === focusedNode.value || edge.target === focusedNode.value);
}

function edgePath(edge: ProductAssetGraphEdge): string {
  const current = layout.value;
  return current ? productAssetEdgePath(edge, current.positions) : "";
}

function activateNode(node: ProductAssetGraphNode): void {
  const target = resolveProductAssetTarget(node);
  if (!target) return;
  if (navigateParam) {
    navigateParam.set({ className: target.ref.className, primaryKey: target.ref.primaryKey });
  }
  emit("open", target);
  emit("navigate", target);
}

function handleExpandedSelect(target: ProductAssetGraphTarget): void {
  fullscreen.value = false;
  if (navigateParam) {
    navigateParam.set({ className: target.ref.className, primaryKey: target.ref.primaryKey });
  }
  emit("open", target);
  emit("navigate", target);
}

const countsText = computed(() =>
  translate(
    ["ontology.productGraphCounts", "platform.graphCounts"],
    "{nodes} nodes · {edges} relationships",
    {
      nodes: resolvedGraph.value?.nodes.length ?? 0,
      edges: layout.value?.validEdges.length ?? 0,
    },
  ),
);

const captionText = computed(() =>
  translate(
    ["ontology.productGraphCaption"],
    "Reference arrows point to the referenced asset; use and edit grants point from members and roles to applications. Only visible assets are shown, and grant details are limited to editable applications. Zoom to see the whole graph and scroll for details.",
  ),
);

const ariaLabel = computed(() =>
  translate(["ontology.productGraphAria"], "Layered product asset reference graph"),
);

const dialogTitle = computed(() =>
  props.title ?? translate(["ontology.productAssetGraph"], "Asset reference graph"),
);

const emptyDescription = computed(() =>
  props.emptyText ?? translate(["platform.graphEmpty"], "No graph nodes to display"),
);

const zoomOutLabel = computed(() => translate(["ontology.productZoomOut", "platform.graphZoomOut"], "Zoom out"));
const zoomInLabel = computed(() => translate(["ontology.productZoomIn", "platform.graphZoomIn"], "Zoom in"));
const fitLabel = computed(() => translate(["ontology.productFitCanvas", "platform.graphFit"], "Fit to canvas"));
const actualSizeLabel = computed(() => translate(["ontology.productActualSize"], "Actual size"));
const expandLabel = computed(() => translate(["ontology.productExpandView"], "Expand view"));

defineExpose({ fit, zoomIn, zoomOut, actualSize, scale });
</script>

<template>
  <div class="sdk-product-asset-graph-host">
    <DataState
      :result="graphState"
      :labels="dataStateLabels"
      :empty-hint="emptyDescription"
    >
    <template #default>
      <div
        v-if="resolvedGraph && layout"
        class="sdk-product-asset-graph"
        :class="{ 'is-expanded': expanded }"
        data-product-asset-graph
      >
        <div class="sdk-product-asset-graph-controls" data-product-graph-controls>
          <span class="sdk-product-asset-graph-counts" data-product-graph-counts>{{ countsText }}</span>
          <el-tooltip :content="zoomOutLabel" placement="top">
            <el-button
              text
              size="small"
              class="sdk-product-asset-graph-btn"
              data-product-graph-action="zoom-out"
              :aria-label="zoomOutLabel"
              :disabled="scale <= MIN_SCALE"
              @click="zoomOut"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M3.5 8h9" />
              </svg>
            </el-button>
          </el-tooltip>
          <span class="sdk-product-asset-graph-scale" data-product-graph-scale>{{ Math.round(scale * 100) }}%</span>
          <el-tooltip :content="zoomInLabel" placement="top">
            <el-button
              text
              size="small"
              class="sdk-product-asset-graph-btn"
              data-product-graph-action="zoom-in"
              :aria-label="zoomInLabel"
              :disabled="scale >= MAX_SCALE"
              @click="zoomIn"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="fitLabel" placement="top">
            <el-button
              text
              size="small"
              class="sdk-product-asset-graph-btn"
              data-product-graph-action="fit"
              :aria-label="fitLabel"
              @click="fit"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
              </svg>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="actualSizeLabel" placement="top">
            <el-button
              text
              size="small"
              class="sdk-product-asset-graph-btn"
              data-product-graph-action="actual-size"
              :aria-label="actualSizeLabel"
              @click="actualSize"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M2.5 5.5V3.5a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M13.5 10.5v2a1 1 0 0 1-1 1h-2M5.5 13.5h-2a1 1 0 0 1-1-1v-2" />
                <circle cx="8" cy="8" r="1.5" />
              </svg>
            </el-button>
          </el-tooltip>
          <el-tooltip v-if="!expanded" :content="expandLabel" placement="top">
            <el-button
              text
              size="small"
              class="sdk-product-asset-graph-btn"
              data-product-graph-action="expand"
              :aria-label="expandLabel"
              @click="fullscreen = true"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
              </svg>
            </el-button>
          </el-tooltip>
        </div>
        <p v-if="showCaption" class="sdk-product-asset-graph-caption" data-product-graph-caption>
          {{ captionText }}
        </p>
        <div ref="canvasEl" class="sdk-product-asset-graph-canvas" data-product-graph-canvas>
          <svg
            :viewBox="`0 0 ${layout.width} ${layout.height}`"
            :style="{ width: `${layout.width * scale}px`, height: `${layout.height * scale}px` }"
            role="img"
            :aria-label="ariaLabel"
          >
            <defs>
              <marker
                :id="`${graphId}-arrow`"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M 2 1 L 8 5 L 2 9"
                  fill="none"
                  stroke="context-stroke"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </marker>
            </defs>
            <text
              v-for="(column, index) in layout.visibleColumns"
              :key="column.id"
              :x="index * PRODUCT_ASSET_COLUMN_PITCH + PRODUCT_ASSET_COLUMN_OFFSET_X"
              y="22"
              class="column-label"
              :data-product-graph-column="column.id"
            >
              {{ columnLabel(column.id) }}
            </text>
            <g
              v-for="(edge, index) in layout.validEdges"
              :key="`${edge.source}:${edge.target}:${edge.relation}`"
              :class="{ 'related-edge': isRelatedEdge(edge), 'muted-edge': focusedNode !== null && !isRelatedEdge(edge) }"
              :data-product-graph-edge="`${edge.source}:${edge.target}:${edge.relation}`"
            >
              <title>{{ edgeLabel(edge.relation) }}</title>
              <path
                :id="`${graphId}-edge-${index}`"
                :d="edgePath(edge)"
                class="edge"
                :marker-end="`url(#${graphId}-arrow)`"
              />
              <text v-if="isRelatedEdge(edge)" class="edge-label" data-product-graph-edge-label>
                <textPath :href="`#${graphId}-edge-${index}`" startOffset="45%">{{ edgeLabel(edge.relation) }}</textPath>
              </text>
            </g>
            <g
              v-for="node in resolvedGraph.nodes"
              :key="node.id"
              :transform="`translate(${layout.positions.get(node.id)?.x ?? 0},${layout.positions.get(node.id)?.y ?? 0})`"
              :class="['node', { 'is-asset': Boolean(node.assetId) }]"
              :role="node.assetId ? 'link' : undefined"
              :tabindex="node.assetId ? 0 : undefined"
              :data-product-graph-node="node.id"
              :data-product-graph-asset-id="node.assetId ?? undefined"
              @mouseenter="focusedNode = node.id"
              @mouseleave="focusedNode = null"
              @focus="focusedNode = node.id"
              @blur="focusedNode = null"
              @click="activateNode(node)"
              @keydown.enter.prevent="activateNode(node)"
            >
              <title>{{ displayNodeName(node.name) }} · {{ nodeKindLabel(node) }} · {{ node.assetId ?? node.id }}</title>
              <rect :width="PRODUCT_ASSET_CARD_WIDTH" :height="PRODUCT_ASSET_CARD_HEIGHT" rx="6" />
              <svg x="10" y="6" :width="PRODUCT_ASSET_CARD_WIDTH - 20" height="24">
                <text x="0" y="16">{{ displayNodeName(node.name) }}</text>
              </svg>
              <text x="10" y="42" class="node-kind">
                {{ nodeKindLabel(node) }}{{ node.revision ? ` · r${node.revision}` : "" }}
              </text>
            </g>
          </svg>
        </div>

        <el-dialog
          v-if="!expanded"
          v-model="fullscreen"
          :title="dialogTitle"
          fullscreen
          destroy-on-close
          append-to-body
          class="sdk-product-asset-graph-dialog"
        >
          <ProductAssetGraph
            class="sdk-product-asset-graph-expanded"
            :graph="resolvedGraph"
            expanded
            :show-caption="showCaption"
            @open="handleExpandedSelect"
          />
        </el-dialog>
      </div>
    </template>
  </DataState>
  </div>
</template>

<style scoped>
.sdk-product-asset-graph-host {
  min-width: 0;
  max-width: 100%;
}

.sdk-product-asset-graph {
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.sdk-product-asset-graph-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.sdk-product-asset-graph-counts {
  margin-inline-end: auto;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.sdk-product-asset-graph-scale {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  min-width: 38px;
  text-align: center;
}

.sdk-product-asset-graph-controls :deep(.el-button + .el-button) {
  margin: 0;
}

.sdk-product-asset-graph-btn {
  padding: 4px 6px;
}

.sdk-product-asset-graph-caption {
  flex-shrink: 0;
  margin: 0;
  padding: var(--spacing-md);
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-light);
}

.sdk-product-asset-graph-canvas {
  overflow: auto;
  min-height: 320px;
  max-height: 480px;
  padding: var(--spacing-sm);
  overscroll-behavior: contain;
}

.sdk-product-asset-graph.is-expanded {
  height: calc(100dvh - 110px);
}

.sdk-product-asset-graph.is-expanded .sdk-product-asset-graph-canvas {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.sdk-product-asset-graph svg {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.column-label {
  fill: var(--el-text-color-primary);
  font-weight: 600;
}

.edge {
  fill: none;
  stroke: var(--el-border-color-dark);
  stroke-width: 1;
  opacity: 0.65;
}

.related-edge .edge {
  stroke: var(--el-color-primary);
  stroke-width: 1.5;
  opacity: 1;
}

.muted-edge {
  opacity: 0.15;
}

.edge-label {
  fill: var(--el-text-color-secondary);
  font-size: 10px;
  paint-order: stroke;
  stroke: var(--el-bg-color);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.node rect {
  fill: var(--el-bg-color);
  stroke: var(--el-border-color);
  stroke-width: 1;
}

.node:hover rect,
.node:focus rect {
  stroke: var(--el-color-primary);
  stroke-width: 1.5;
}

.node text {
  fill: var(--el-text-color-primary);
}

.node .node-kind {
  fill: var(--el-text-color-secondary);
  font-size: 10px;
}

.is-asset {
  cursor: pointer;
}

.is-asset:hover rect,
.is-asset:focus rect {
  stroke: var(--el-color-primary);
}
</style>
