<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onDeactivated, ref, useId, watch } from "vue";
import { Box, Filter, ListFilter } from "lucide-vue-next";
import { ElPopover } from "@ontomato/foundation-ui/overlay";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { shellContextKey } from "../context";
import { buildSubgraphModel, type SubgraphClassNode, type SubgraphRelationEdge } from "./subgraph-layout";

/**
 * ABC-style ontology query path renderer: object classes connected by smooth SVG relation edges,
 * with each class's filters and extracted fields tucked into an anchored click popover and
 * operation/output lineage summarized compactly below.
 */
const props = defineProps<{ graph: QuerySubgraph }>();
const shell = inject(shellContextKey, null);

const instancePrefix = `sg-arrow-${useId()}`;
const markerIdFor = (bandIndex: number, active = false) =>
  `${instancePrefix}-${bandIndex}${active ? "-active" : ""}`;

const model = computed(() => buildSubgraphModel(props.graph));
const hoveredNodeId = ref<string | null>(null);
const activeNodeId = ref<string | null>(null);
const popoverRefs = new Map<string, { hide?: () => void }>();

function setPopoverRef(nodeId: string, instance: unknown) {
  if (instance && typeof instance === "object" && "hide" in instance) {
    popoverRefs.set(nodeId, instance as { hide?: () => void });
  } else {
    popoverRefs.delete(nodeId);
  }
}

function closePopovers() {
  for (const pop of popoverRefs.values()) pop.hide?.();
  activeNodeId.value = null;
}

watch(() => props.graph, closePopovers);
onDeactivated(closePopovers);
onBeforeUnmount(closePopovers);

const focusedNodeId = computed(() => activeNodeId.value ?? hoveredNodeId.value);

const adjacentByNode = computed(() => {
  const map = new Map<string, Set<string>>();
  for (const band of model.value.bands) {
    for (const edge of band.edges) {
      if (!map.has(edge.sourceId)) map.set(edge.sourceId, new Set());
      if (!map.has(edge.targetId)) map.set(edge.targetId, new Set());
      map.get(edge.sourceId)!.add(edge.targetId);
      map.get(edge.targetId)!.add(edge.sourceId);
    }
  }
  return map;
});

function isNodeHighlighted(nodeId: string) {
  const focus = focusedNodeId.value;
  if (!focus) return false;
  return focus === nodeId || Boolean(adjacentByNode.value.get(focus)?.has(nodeId));
}

function isNodeDimmed(nodeId: string) {
  return Boolean(focusedNodeId.value) && !isNodeHighlighted(nodeId);
}

function isEdgeHighlighted(edge: SubgraphRelationEdge) {
  const focus = focusedNodeId.value;
  if (!focus) return false;
  return edge.sourceId === focus || edge.targetId === focus;
}

function isEdgeDimmed(edge: SubgraphRelationEdge) {
  return Boolean(focusedNodeId.value) && !isEdgeHighlighted(edge);
}

function onPopoverHide(nodeId: string) {
  if (activeNodeId.value === nodeId) activeNodeId.value = null;
}

function clearHover(nodeId: string) {
  if (hoveredNodeId.value === nodeId) hoveredNodeId.value = null;
}

const DEFAULT_OP_KINDS: Record<string, string> = {
  project: "Project",
  filter: "Filter",
  group: "Group",
  aggregate: "Aggregate",
  join: "Join",
  calculate: "Calculate",
  constant: "Constant",
  unknown: "Unknown",
};

const DEFAULT_ROLES: Record<string, string> = {
  value: "value",
  group: "group",
  filter: "filter",
  join: "join",
};

const text = computed(() => {
  const l = shell?.labels.value;
  return {
    filters: l?.lineageFilters ?? "Filters",
    fields: l?.lineageFields ?? "Fields",
    operations: l?.lineageOperations ?? "Calculations",
    outputs: l?.lineageOutputs ?? "Result columns",
    filterCount: l?.lineageFilterCount ?? ((n: number) => `${n} ${n === 1 ? "filter" : "filters"}`),
    fieldCount: l?.lineageFieldCount ?? ((n: number) => `${n} ${n === 1 ? "field" : "fields"}`),
    pathOnly: l?.lineagePathOnly ?? "Traversal class only — no extracted fields or filters",
    opKinds: l?.lineageOperationKinds ?? DEFAULT_OP_KINDS,
    roles: l?.lineageRoles ?? DEFAULT_ROLES,
  };
});

/** Show a raw expression subline when it adds non-JSON context beyond the human-readable label. */
function showExpressionSubline(label: string, expression: string) {
  const trimmed = expression.trim();
  if (!trimmed || trimmed === label.trim()) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return true;
}

function nodeSummaryAria(node: SubgraphClassNode) {
  const parts = [node.label];
  if (node.filters.length) parts.push(text.value.filterCount(node.filters.length));
  if (node.fields.length) parts.push(text.value.fieldCount(node.fields.length));
  return parts.join(" · ");
}
</script>

<template>
  <div v-if="model.hasClasses || model.hasDetails" class="subgraph">
    <div v-if="model.hasClasses" class="subgraph-bands">
      <div v-for="(band, bandIndex) in model.bands" :key="band.queryId" class="query-band">
        <div v-if="model.bands.length > 1" class="band-heading">{{ band.queryLabel }}</div>
        <div class="band-scroll">
          <div class="band-stage" :style="{ width: `${band.width}px`, height: `${band.height}px` }">
            <svg
              class="band-svg"
              :width="band.width"
              :height="band.height"
              :viewBox="`0 0 ${band.width} ${band.height}`"
              aria-hidden="true"
            >
              <defs>
                <marker
                  :id="markerIdFor(bandIndex)"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1.2 L 7.2 4 L 1 6.8 z" class="arrow-fill" />
                </marker>
                <marker
                  :id="markerIdFor(bandIndex, true)"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1.2 L 7.2 4 L 1 6.8 z" class="arrow-fill-active" />
                </marker>
              </defs>
              <path
                v-for="edge in band.edges"
                :key="edge.id"
                :d="edge.path"
                class="relation-path"
                :class="{ active: isEdgeHighlighted(edge), dimmed: isEdgeDimmed(edge) }"
                :marker-start="edge.startArrow ? `url(#${markerIdFor(bandIndex, isEdgeHighlighted(edge))})` : undefined"
                :marker-end="edge.endArrow ? `url(#${markerIdFor(bandIndex, isEdgeHighlighted(edge))})` : undefined"
              />
            </svg>

            <span
              v-for="edge in band.edges"
              :key="`lbl-${edge.id}`"
              class="relation-pill"
              :class="{ active: isEdgeHighlighted(edge), dimmed: isEdgeDimmed(edge) }"
              :style="{ left: `${edge.labelX}px`, top: `${edge.labelY}px` }"
              :title="edge.tooltip"
            >
              {{ edge.displayLabel }}
            </span>

            <div
              v-for="node in band.classes"
              :key="node.id"
              class="class-anchor"
              :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
            >
              <ElPopover
                :ref="(el) => setPopoverRef(node.id, el)"
                trigger="click"
                placement="bottom"
                :width="312"
                :persistent="false"
                popper-class="subgraph-node-popover"
                @show="activeNodeId = node.id"
                @hide="onPopoverHide(node.id)"
              >
                <template #reference>
                  <button
                    type="button"
                    class="class-node"
                    :class="{
                      filtered: node.filters.length > 0,
                      active: activeNodeId === node.id,
                      highlighted: isNodeHighlighted(node.id),
                      dimmed: isNodeDimmed(node.id),
                    }"
                    :aria-expanded="activeNodeId === node.id"
                    :aria-label="nodeSummaryAria(node)"
                    @mouseenter="hoveredNodeId = node.id"
                    @mouseleave="clearHover(node.id)"
                  >
                    <span class="class-head">
                      <Box :size="13" class="class-icon" aria-hidden="true" />
                      <span class="class-label" :title="node.label">{{ node.label }}</span>
                      <span v-if="node.showVariable" class="class-var">{{ node.variable }}</span>
                    </span>
                    <span class="class-meta">
                      <template v-if="node.filters.length || node.fields.length">
                        <span v-if="node.filters.length" class="meta-filter">
                          <Filter :size="10" aria-hidden="true" />
                          {{ text.filterCount(node.filters.length) }}
                        </span>
                        <span v-if="node.filters.length && node.fields.length" class="meta-sep" aria-hidden="true">·</span>
                        <span v-if="node.fields.length" class="meta-fields">{{ text.fieldCount(node.fields.length) }}</span>
                      </template>
                      <span v-else class="meta-path">{{ node.className }}</span>
                    </span>
                  </button>
                </template>

                <div class="node-detail">
                  <div class="node-detail-head">
                    <span class="node-detail-title">{{ node.label }}</span>
                    <span v-if="node.showVariable" class="node-detail-var">{{ node.variable }}</span>
                    <span v-if="node.className !== node.label" class="node-detail-class">{{ node.className }}</span>
                  </div>

                  <div v-if="node.filters.length" class="node-detail-section">
                    <div class="detail-section-title">
                      <ListFilter :size="12" aria-hidden="true" />
                      <span>{{ text.filters }} ({{ node.filters.length }})</span>
                    </div>
                    <ul class="detail-filter-list">
                      <li v-for="filter in node.filters" :key="filter.id" class="detail-filter-item">
                        <div class="detail-filter-main">
                          <span class="detail-filter-label" :title="filter.expression">{{ filter.label }}</span>
                          <span
                            v-for="fieldLabel in filter.targetFieldLabels"
                            :key="fieldLabel"
                            class="detail-target-tag"
                          >
                            {{ fieldLabel }}
                          </span>
                        </div>
                        <code v-if="showExpressionSubline(filter.label, filter.expression)" class="detail-expr">
                          {{ filter.expression }}
                        </code>
                      </li>
                    </ul>
                  </div>

                  <div v-if="node.fields.length" class="node-detail-section">
                    <div class="detail-section-title">
                      <span>{{ text.fields }} ({{ node.fields.length }})</span>
                    </div>
                    <ul class="detail-field-list">
                      <li v-for="field in node.fields" :key="field.id" class="detail-field-item" :class="{ filtered: field.filtered }">
                        <Filter v-if="field.filtered" :size="10" class="detail-field-filter-icon" aria-hidden="true" />
                        <span class="detail-field-label">{{ field.label }}</span>
                        <span v-if="field.attrName !== field.label" class="detail-field-attr">{{ field.attrName }}</span>
                      </li>
                    </ul>
                  </div>

                  <p v-if="!node.filters.length && !node.fields.length" class="node-detail-empty">
                    {{ text.pathOnly }}
                  </p>
                </div>
              </ElPopover>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="model.hasDetails" class="subgraph-details">
      <div v-if="model.operations.length" class="detail-group">
        <span class="detail-group-label">{{ text.operations }}</span>
        <ul class="op-list">
          <li v-for="op in model.operations" :key="op.id" class="op-item">
            <span class="op-kind">{{ text.opKinds[op.operation] ?? op.operation }}</span>
            <span class="op-label" :title="op.expression">{{ op.label }}</span>
            <span v-if="op.inputs.length" class="op-inputs">
              <span class="op-arrow" aria-hidden="true">←</span>
              <span v-for="(input, idx) in op.inputs" :key="`${op.id}:${input.id}:${input.role}:${idx}`" class="op-input">
                <span>{{ input.label }}</span>
                <span v-if="input.role !== 'value'" class="op-role">{{ text.roles[input.role] ?? input.role }}</span>
                <span v-if="idx < op.inputs.length - 1" class="op-comma">, </span>
              </span>
            </span>
            <code v-if="showExpressionSubline(op.label, op.expression)" class="op-expr" :title="op.expression">
              {{ op.expression }}
            </code>
            <span
              v-for="filter in op.filters"
              :key="filter.id"
              class="op-filter-chip"
              :title="filter.expression"
            >
              <Filter :size="10" aria-hidden="true" />
              {{ filter.label }}
            </span>
          </li>
        </ul>
      </div>

      <div v-if="model.outputs.length" class="detail-group">
        <span class="detail-group-label">{{ text.outputs }}</span>
        <ul class="output-list">
          <li v-for="out in model.outputs" :key="out.id" class="output-pill" :title="out.key">
            <span class="output-label">{{ out.label }}</span>
            <template v-if="out.sourceLabel && out.sourceLabel !== out.label">
              <span class="op-arrow" aria-hidden="true">←</span>
              <span class="output-source">{{ out.sourceLabel }}</span>
            </template>
            <span
              v-for="filter in out.filters"
              :key="filter.id"
              class="op-filter-chip"
              :title="filter.expression"
            >
              <Filter :size="10" aria-hidden="true" />
              {{ filter.label }}
            </span>
          </li>
        </ul>
      </div>

      <div v-if="model.unattachedFilters.length" class="detail-group">
        <span class="detail-group-label">{{ text.filters }}</span>
        <div class="unattached-filters">
          <span
            v-for="filter in model.unattachedFilters"
            :key="filter.id"
            class="op-filter-chip"
            :title="filter.expression"
          >
            <Filter :size="10" aria-hidden="true" />
            {{ filter.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subgraph {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.subgraph-bands {
  display: flex;
  flex-direction: column;
}

.query-band + .query-band {
  border-top: 1px dashed var(--el-border-color-lighter);
}

.band-heading {
  padding: 8px 14px 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  font-weight: 500;
}

.band-scroll {
  width: 100%;
  min-width: 0;
  max-height: 400px;
  overflow: auto;
}

.band-stage {
  position: relative;
  margin: 0 auto;
}

.band-svg {
  display: block;
  pointer-events: none;
}

.arrow-fill {
  fill: var(--el-text-color-placeholder);
}

.arrow-fill-active {
  fill: var(--el-color-primary);
}

.relation-path {
  fill: none;
  stroke: var(--el-border-color-darker, var(--el-text-color-placeholder));
  stroke-width: 1.5;
  stroke-linecap: round;
  transition: stroke 140ms ease, opacity 140ms ease, stroke-width 140ms ease;
}

.relation-path.active {
  stroke: var(--el-color-primary);
  stroke-width: 2;
}

.relation-path.dimmed {
  opacity: 0.3;
}

.relation-pill {
  position: absolute;
  transform: translate(-50%, -50%);
  max-width: 176px;
  padding: 1px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: border-color 140ms ease, color 140ms ease, opacity 140ms ease;
}

.relation-pill.active {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.relation-pill.dimmed {
  opacity: 0.35;
}

.class-anchor {
  position: absolute;
}

.class-node {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  width: 100%;
  height: 100%;
  padding: 7px 11px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease,
    opacity 140ms ease;
}

.class-node.filtered {
  border-left: 3px solid var(--el-color-primary);
  padding-left: 9px;
}

.class-node:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-lighter);
}

.class-node.highlighted:not(.active) {
  border-color: var(--el-color-primary-light-5);
}

.class-node.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
}

.class-node.dimmed {
  opacity: 0.42;
}

.class-node:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.class-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.class-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.class-node.filtered .class-icon,
.class-node.active .class-icon {
  color: var(--el-color-primary);
}

.class-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  line-height: 1.35;
}

.class-var {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.4;
}

.class-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding-left: 19px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--el-text-color-secondary);
}

.meta-filter {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--el-color-primary);
  font-weight: 500;
}

.meta-sep {
  color: var(--el-text-color-placeholder);
}

.meta-fields,
.meta-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-path {
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono, ui-monospace, monospace);
}

/* Popover detail content */
.node-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: var(--text-xs, 12px);
  line-height: 1.45;
}

.node-detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.node-detail-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 13px);
  font-weight: 600;
}

.node-detail-var {
  padding: 0 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.node-detail-class {
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.node-detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-section-title {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.detail-filter-list,
.detail-field-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.detail-filter-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-filter-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
}

.detail-filter-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.detail-filter-label {
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}

.detail-target-tag {
  padding: 0 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
}

.detail-expr {
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.detail-field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.detail-field-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-xs, 4px);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
}

.detail-field-item.filtered {
  border-color: color-mix(in srgb, var(--el-color-primary) 35%, var(--el-border-color-lighter));
  background: var(--el-color-primary-light-9);
}

.detail-field-filter-icon {
  flex-shrink: 0;
  color: var(--el-color-primary);
}

.detail-field-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-field-attr {
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.node-detail-empty {
  margin: 0;
  color: var(--el-text-color-secondary);
}

/* Compact calculations & output columns footer */
.subgraph-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
}

.detail-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.detail-group-label {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.op-list,
.output-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  flex: 1;
}

.op-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.op-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  color: var(--el-text-color-regular);
}

.op-kind {
  padding: 0 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.op-label {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.op-inputs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  color: var(--el-text-color-secondary);
}

.op-arrow {
  color: var(--el-text-color-placeholder);
  margin: 0 2px;
}

.op-input {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.op-role {
  padding: 0 4px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 10px;
}

.op-expr {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-tertiary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.op-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11px;
}

.output-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.output-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-xs, 4px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.output-source {
  color: var(--el-text-color-secondary);
}

.unattached-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

@media (max-width: 560px) {
  .detail-group {
    flex-direction: column;
    gap: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .relation-path,
  .relation-pill,
  .class-node {
    transition: none;
  }
}
</style>
