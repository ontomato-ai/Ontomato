<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElFormItem } from "element-plus/es/components/form/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasNode } from "@ontomato/foundation-ui/graph";
import { useFormField } from "../panel/context";
import { valueAt } from "../panel/form-values";
import { useMember, useMemberData } from "../panel/member";

interface EdgeEndsConfig {
  readonly source: string;
  readonly target: string;
}

/**
 * Objects of one type as a graph, joined by the objects of another (classes joined by their relationships), with a form
 * field of this panel chosen on it. The member's `nodes` and `edges` datums (`panelRecordList`) supply the records, and
 * `config.edgeEnds` (`source`, `target`) points to the endpoint keys inside each edge's fields. Choosing a node adds it
 * to or removes it from the field its member's formField port names; the nodes one drawn edge away from a chosen one
 * are marked, and one action adds them all. What the field means — that an empty list is the default scope, say — is
 * its owner's, in its help; who may read what the nodes stand for is decided where the data is read, never on this
 * graph.
 */
const props = defineProps<{
  /** JSON Pointers into each edge record's `fields` naming its source and target node keys. */
  edgeEnds?: EdgeEndsConfig;
}>();

const { t } = useI18n();
const field = useFormField();
const member = useMember();

/** The node an edge record names at a declared pointer: its owner's key there, or a visible failure. */
function endpoint(edge: string, fields: Readonly<Record<string, string>>, path: string): string {
  const value = valueAt({ ...fields }, path);
  if (typeof value !== "string") throw new Error(`Edge '${edge}' names no node at ${path}`);
  return value;
}

function resolveEdgeEnds(raw: unknown): EdgeEndsConfig {
  const candidate = raw as Partial<EdgeEndsConfig> | undefined;
  if (!candidate || typeof candidate.source !== "string" || typeof candidate.target !== "string") {
    throw new Error(`The projection in member '${member.key}' declares no edgeEnds (source, target)`);
  }
  return { source: candidate.source, target: candidate.target };
}

const edgeEnds = resolveEdgeEnds(props.edgeEnds ?? member.projection.config.edgeEnds);
const nodesState = useMemberData("nodes");
const edgesState = useMemberData("edges");

const resolved = computed<{
  nodes: readonly GraphCanvasNode[];
  links: readonly GraphCanvasEdge[];
  loading: boolean;
  error: string | null;
}>(() => {
  const n = nodesState.value;
  const e = edgesState.value;
  if (n.status === "loading" || e.status === "loading") {
    return { nodes: [], links: [], loading: true, error: null };
  }
  if (n.status === "forbidden" || e.status === "forbidden") {
    return { nodes: [], links: [], loading: false, error: t("platform.dataForbidden") };
  }
  if (n.status === "error") {
    return { nodes: [], links: [], loading: false, error: n.message };
  }
  if (e.status === "error") {
    return { nodes: [], links: [], loading: false, error: e.message };
  }
  if (n.status !== "ready" || (e.status !== "ready" && e.status !== "empty")) {
    return { nodes: [], links: [], loading: false, error: null };
  }
  const nodeRecords = n.value as unknown as readonly PanelRecord[];
  const edgeRecords = e.status === "ready" ? (e.value as unknown as readonly PanelRecord[]) : [];
  try {
    return {
      nodes: nodeRecords.map((record) => ({ id: record.primaryKey, label: record.label })),
      links: edgeRecords.map((record) => ({
        id: record.primaryKey,
        source: endpoint(record.primaryKey, record.fields, edgeEnds.source),
        target: endpoint(record.primaryKey, record.fields, edgeEnds.target),
      })),
      loading: false,
      error: null,
    };
  } catch (reason: unknown) {
    return {
      nodes: [],
      links: [],
      loading: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
});

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
