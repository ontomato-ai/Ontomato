<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElButton, ElEmpty, ElInput, ElTag, vLoading } from "element-plus";
import { RefreshCw, Search } from "lucide-vue-next";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import type {
  CapabilityGrantRecord,
  PlatformAccessRecord,
  SmartAsset,
  SubjectRecord,
  WorkflowRecord,
} from "../api";
import { useManagerClient, useOntologyText } from "../context";
import { assetStatusLabel } from "../asset-status";
import { useManagerFeedback } from "../feedback";

/**
 * The governance and capability layers, drawn as one graph.
 *
 * <p>Five columns, left to right: subject, role, process, action, metric view. The order follows how
 * authority actually flows — a subject holds a role, the role may run what the process names, and the
 * process names actions. Metric views sit beside actions rather than after them: nothing in the model
 * ties one to the other, so drawing an arrow would assert a relation the platform does not have.</p>
 *
 * <p>Two kinds of edge are drawn differently on purpose. Direct edges are rows the product stores:
 * a membership names a role, a step names an action, a grant names an action for a role. Derived edges
 * are computed from those rows — a role "owns" a process only because a step of that process names the
 * role. They are dashed, because they rebuild from the steps and vanish if the steps change.</p>
 */

const { ot } = useOntologyText();
const { message } = useManagerFeedback();
const {
  loadWorkflows,
  loadSmartAssets,
  loadCapabilityGrants,
  loadPlatformAccess,
  loadSubjects,
} = useManagerClient();

const loading = ref(false);
const query = ref("");
const selected = ref<string | null>(null);

const subjects = ref<SubjectRecord[]>([]);
const workflows = ref<WorkflowRecord[]>([]);
const actions = ref<SmartAsset[]>([]);
const metrics = ref<SmartAsset[]>([]);
const grants = ref<CapabilityGrantRecord[]>([]);
const platformAccess = ref<PlatformAccessRecord[]>([]);

/** The platform operation that authorizes authoring a process; a role holding it may create workflows. */
const WORKFLOW_SAVE = "/workflow/save";

type Column = "subject" | "role" | "workflow" | "action" | "metric";

interface Node {
  key: string;
  column: Column;
  label: string;
  detail: string;
  /** Empty for a column header filler; nodes are only the drawn boxes. */
  id?: string;
}

interface Edge {
  from: string;
  to: string;
  /** A derived edge is computed from stored rows rather than stored itself. */
  derived?: boolean;
  label: string;
}

const COLUMNS: Array<{ key: Column; titleKey: Parameters<typeof ot>[0] }> = [
  { key: "subject", titleKey: "mapColumnSubject" },
  { key: "role", titleKey: "mapColumnRole" },
  { key: "workflow", titleKey: "mapColumnWorkflow" },
  { key: "action", titleKey: "mapColumnAction" },
  { key: "metric", titleKey: "mapColumnMetric" },
];

/**
 * Roles are collected from three places because each records a different fact: the directory says who
 * holds a role, the grants say what a role may run, and the platform access says what a role may author.
 * A role known only by code (a step written before the role existed) is still drawn, marked unresolved.
 */
const roles = computed(() => {
  const byId = new Map<string, { id: string; code: string }>();
  const byCode = new Map<string, { id: string; code: string }>();
  const add = (id?: string | null, code?: string | null) => {
    if (!code) return;
    const existing = (id && byId.get(id)) || byCode.get(code);
    const entry = { id: id ?? existing?.id ?? `code:${code}`, code };
    if (id) byId.set(id, entry);
    byCode.set(code, entry);
  };
  for (const access of platformAccess.value) add(access.roleId, access.roleCode);
  for (const grant of grants.value) add(grant.roleId, grant.roleCode);
  for (const workflow of workflows.value) {
    for (const step of workflow.steps ?? []) {
      if (step.roleCode) add(null, step.roleCode);
    }
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
});

const nodes = computed<Node[]>(() => {
  const result: Node[] = [];
  for (const subject of subjects.value) {
    result.push({
      key: `subject:${subject.id}`,
      column: "subject",
      label: subject.displayName || subject.loginCode || subject.id,
      detail: subject.loginCode ?? "",
      id: subject.id,
    });
  }
  for (const role of roles.value) {
    result.push({
      key: `role:${role.code}`,
      column: "role",
      label: role.code,
      detail: "",
      id: role.id,
    });
  }
  for (const workflow of workflows.value) {
    result.push({
      key: `workflow:${workflow.id}`,
      column: "workflow",
      label: workflow.name,
      detail: `v${workflow.version ?? 0}`,
      id: workflow.id,
    });
  }
  for (const action of actions.value) {
    if (!action.id) continue;
    result.push({
      key: `action:${action.id}`,
      column: "action",
      label: action.name,
      detail: assetStatusLabel(action.status, ot),
      id: action.id,
    });
  }
  for (const metric of metrics.value) {
    if (!metric.id) continue;
    result.push({
      key: `metric:${metric.id}`,
      column: "metric",
      label: metric.name,
      detail: assetStatusLabel(metric.status, ot),
      id: metric.id,
    });
  }
  return result;
});

const edges = computed<Edge[]>(() => {
  const result: Edge[] = [];
  const roleByCode = new Map(roles.value.map((role) => [role.code, role]));
  const actionKeys = new Set(actions.value.filter((item) => item.id).map((item) => `action:${item.id}`));
  const metricKeys = new Set(metrics.value.filter((item) => item.id).map((item) => `metric:${item.id}`));

  // subject -> role: stored membership, with organization and position grants already folded in.
  for (const subject of subjects.value) {
    for (const roleId of subject.roleIds ?? []) {
      const role = roles.value.find((candidate) => candidate.id === roleId);
      if (!role) continue;
      result.push({ from: `subject:${subject.id}`, to: `role:${role.code}`, label: ot("mapEdgeHolds") });
    }
  }

  // role -> action: a stored grant, the same row the executor consults before it runs anything.
  for (const grant of grants.value) {
    if (grant.capabilityKind !== "ACTION" || !grant.capabilityId) continue;
    const role = grant.roleCode ? roleByCode.get(grant.roleCode) : undefined;
    if (!role) continue;
    const target = `action:${grant.capabilityId}`;
    if (!actionKeys.has(target)) continue;
    result.push({ from: `role:${role.code}`, to: target, label: ot("mapEdgeRuns") });
  }

  // role -> workflow: platform authority to author one, read from the chain the interceptor enforces.
  // A management role holds every enabled operation by rule, so it passes on the flag rather than on a
  // listed path — reading only the list would silently omit the roles that can actually author.
  for (const access of platformAccess.value) {
    if (!access.roleCode) continue;
    const mayAuthor =
      access.managementRole === true || (access.apiPermissions ?? []).includes(WORKFLOW_SAVE);
    if (!mayAuthor) continue;
    for (const workflow of workflows.value) {
      if (!workflow.id) continue;
      result.push({
        from: `role:${access.roleCode}`,
        to: `workflow:${workflow.id}`,
        label: ot("mapEdgeAuthors"),
      });
    }
  }

  // workflow -> action: the steps name it. A step naming an unknown action draws nothing.
  for (const workflow of workflows.value) {
    if (!workflow.id) continue;
    for (const step of workflow.steps ?? []) {
      const target = `action:${step.actionId}`;
      if (!step.actionId || !actionKeys.has(target)) continue;
      result.push({ from: `workflow:${workflow.id}`, to: target, label: ot("mapEdgeNames") });
    }
  }

  // role -> workflow (derived): a step names the role, so the process needs it to run. Nothing stores
  // this edge; it is rebuilt from the steps, which is why it is drawn dashed.
  for (const workflow of workflows.value) {
    if (!workflow.id) continue;
    const codes = new Set((workflow.steps ?? []).map((step) => step.roleCode).filter(Boolean));
    for (const code of codes) {
      if (!roleByCode.has(code as string)) continue;
      result.push({
        from: `role:${code as string}`,
        to: `workflow:${workflow.id}`,
        derived: true,
        label: ot("mapEdgeOwnsStep"),
      });
    }
  }

  // subject -> what they authored or published. Publication is the review moment, so both edges read
  // the same two stored fields and differ only in which one they name.
  type Provenance = { id?: string; createdBy?: string | null; reviewedBy?: string | null };
  const linkProvenance = (
    items: Provenance[],
    key: (id: string) => string,
    field: "createdBy" | "reviewedBy",
    label: string,
    derived: boolean
  ) => {
    const drawn = new Set(nodes.value.map((node) => node.key));
    for (const item of items) {
      const subject = item[field];
      if (!item.id || !subject || !subjectKeys.has(`subject:${subject}`)) continue;
      const target = key(item.id);
      if (!drawn.has(target)) continue;
      result.push({ from: `subject:${subject}`, to: target, label, derived });
    }
  };
  const subjectKeys = new Set(subjects.value.map((subject) => `subject:${subject.id}`));
  linkProvenance(workflows.value, (id) => `workflow:${id}`, "createdBy", ot("mapEdgeCreated"), false);
  linkProvenance(actions.value, (id) => `action:${id}`, "createdBy", ot("mapEdgeCreated"), false);
  linkProvenance(metrics.value, (id) => `metric:${id}`, "createdBy", ot("mapEdgeCreated"), false);
  // The reviewer is the principal on the newest activation event, so this edge is read back from the
  // event rather than stored on the object; it still rebuilds from rows, hence not derived.
  linkProvenance(workflows.value, (id) => `workflow:${id}`, "reviewedBy", ot("mapEdgeReviewed"), true);
  linkProvenance(actions.value, (id) => `action:${id}`, "reviewedBy", ot("mapEdgeReviewed"), true);
  linkProvenance(metrics.value, (id) => `metric:${id}`, "reviewedBy", ot("mapEdgeReviewed"), true);

  // One row per pairing: a process that names the same action twice is still one line.
  const seen = new Set<string>();
  return result.filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.derived ? "d" : "s"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return nodes.value;
  const keep = new Set(
    nodes.value
      .filter(
        (node) =>
          node.label.toLowerCase().includes(text) || node.detail.toLowerCase().includes(text)
      )
      .map((node) => node.key)
  );
  // Keep one hop of context: a match without its neighbours loses the point of a graph.
  for (const edge of edges.value) {
    if (keep.has(edge.from)) keep.add(edge.to);
    else if (keep.has(edge.to)) keep.add(edge.from);
  }
  return nodes.value.filter((node) => keep.has(node.key));
});

/**
 * Fixed geometry rather than measured layout: the columns are known, so positions cannot drift. The five columns share
 * the width the map is given, so all of them show at once on an ordinary screen; below a readable node width the map
 * scrolls sideways in its own frame instead.
 */
const MIN_COLUMN_WIDTH = 176;
const body = ref<HTMLElement | null>(null);
const bodyWidth = ref(0);
let bodyObserver: ResizeObserver | null = null;
onMounted(() => {
  bodyObserver = new ResizeObserver(([entry]) => (bodyWidth.value = entry!.contentRect.width));
  bodyObserver.observe(body.value!);
});
onBeforeUnmount(() => bodyObserver?.disconnect());
// The frame's 1px border on either side is not the map's.
const columnWidth = computed(() => Math.max(MIN_COLUMN_WIDTH, Math.floor((bodyWidth.value - 2) / COLUMNS.length)));
const NODE_HEIGHT = 52;
const ROW_GAP = 12;
const HEADER_HEIGHT = 44;

interface Placed {
  node: Node;
  x: number;
  y: number;
}

const placed = computed<Placed[]>(() => {
  const counters = new Map<Column, number>();
  return filtered.value.map((node) => {
    const columnIndex = COLUMNS.findIndex((column) => column.key === node.column);
    const row = counters.get(node.column) ?? 0;
    counters.set(node.column, row + 1);
    return {
      node,
      x: columnIndex * columnWidth.value + 8,
      y: HEADER_HEIGHT + row * (NODE_HEIGHT + ROW_GAP),
    };
  });
});

const placedByKey = computed(() => new Map(placed.value.map((item) => [item.node.key, item])));

const canvas = computed(() => {
  const columns = COLUMNS.length * columnWidth.value;
  const rows = Math.max(
    1,
    ...COLUMNS.map((column) => filtered.value.filter((node) => node.column === column.key).length)
  );
  return {
    width: columns,
    height: HEADER_HEIGHT + rows * (NODE_HEIGHT + ROW_GAP) + 24,
  };
});

interface DrawnEdge {
  key: string;
  path: string;
  derived: boolean;
  dimmed: boolean;
  label: string;
}

const drawnEdges = computed<DrawnEdge[]>(() => {
  const lines: DrawnEdge[] = [];
  for (const edge of edges.value) {
    const from = placedByKey.value.get(edge.from);
    const to = placedByKey.value.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + columnWidth.value - 16;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const mid = (x1 + x2) / 2;
    // A cubic keeps overlapping edges readable: two arrows between the same columns separate by their rows.
    const path = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
    const related =
      !selected.value || edge.from === selected.value || edge.to === selected.value;
    lines.push({
      key: `${edge.from}|${edge.to}|${edge.derived ? "d" : "s"}`,
      path,
      derived: Boolean(edge.derived),
      dimmed: !related,
      label: `${from.node.label} · ${edge.label} → ${to.node.label}`,
    });
  }
  return lines;
});

const selectedRelations = computed(() => selected.value ? drawnEdges.value.filter(line => !line.dimmed) : []);

const summary = computed(() => ({
  subjects: subjects.value.length,
  roles: roles.value.length,
  workflows: workflows.value.length,
  actions: actions.value.filter((item) => item.id).length,
  metrics: metrics.value.filter((item) => item.id).length,
  edges: edges.value.length,
}));

async function refresh() {
  loading.value = true;
  try {
    // Every column is a separate fact; one failing must not empty the whole graph.
    const [nextSubjects, nextWorkflows, nextActions, nextMetrics, nextGrants, nextAccess] =
      await Promise.allSettled([
        loadSubjects(),
        loadWorkflows(),
        loadSmartAssets("actions"),
        loadSmartAssets("metrics"),
        loadCapabilityGrants(),
        loadPlatformAccess(),
      ]);
    subjects.value = nextSubjects.status === "fulfilled" ? nextSubjects.value : [];
    workflows.value = nextWorkflows.status === "fulfilled" ? nextWorkflows.value : [];
    actions.value = nextActions.status === "fulfilled" ? nextActions.value : [];
    metrics.value = nextMetrics.status === "fulfilled" ? nextMetrics.value : [];
    grants.value = nextGrants.status === "fulfilled" ? nextGrants.value : [];
    platformAccess.value = nextAccess.status === "fulfilled" ? nextAccess.value : [];
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => void refresh());
</script>

<template>
  <section v-loading="loading" class="capability-map">
    <!-- The platform's one page header: the title, its line of description, and this page's own tools. -->
    <PlatformPageHeader compact :title="ot('mapTitle')" :description="ot('mapDesc')">
      <template #actions>
        <el-input v-model="query" class="map-filter" :prefix-icon="Search" :placeholder="ot('mapFilter')" clearable />
        <el-button @click="refresh">
          <RefreshCw :size="16" />
          <span>{{ ot("mapRefresh") }}</span>
        </el-button>
      </template>
    </PlatformPageHeader>

    <div ref="body" class="map-body platform-page-gutter">
      <div class="map-legend">
        <span class="legend-item"><i class="legend-line" />{{ ot("mapLegendDirect") }}</span>
        <span class="legend-item"><i class="legend-line dashed" />{{ ot("mapLegendDerived") }}</span>
        <span class="legend-sep" />
        <el-tag size="small" effect="plain">{{ ot("mapCountSubject") }} {{ summary.subjects }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("mapCountRole") }} {{ summary.roles }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("mapCountWorkflow") }} {{ summary.workflows }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("mapCountAction") }} {{ summary.actions }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("mapCountMetric") }} {{ summary.metrics }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("mapCountEdge") }} {{ summary.edges }}</el-tag>
      </div>

      <ul v-if="selectedRelations.length" class="map-relations" :aria-label="ot('mapCountEdge')">
        <li v-for="line in selectedRelations" :key="line.key">{{ line.label }}</li>
      </ul>

      <div v-if="!loading && nodes.length === 0" class="map-empty">
        <el-empty :description="ot('mapEmpty')" />
      </div>

      <div v-else class="map-scroll">
        <div class="map-canvas" :style="{ width: `${canvas.width}px`, height: `${canvas.height}px` }">
          <div
            v-for="(column, index) in COLUMNS"
            :key="column.key"
            class="map-column-head"
            :style="{ left: `${index * columnWidth}px`, width: `${columnWidth - 16}px` }"
          >
            {{ ot(column.titleKey) }}
          </div>

          <svg class="map-edges" :width="canvas.width" :height="canvas.height">
            <g v-for="line in drawnEdges" :key="line.key" :class="{ dimmed: line.dimmed }">
              <path
                :d="line.path"
                :class="['map-edge', { derived: line.derived }]"
                fill="none"
              />
            </g>
          </svg>

          <button
            v-for="item in placed"
            :key="item.node.key"
            :aria-pressed="selected === item.node.key"
            :class="['map-node', `column-${item.node.column}`, { selected: selected === item.node.key }]"
            :style="{ left: `${item.x}px`, top: `${item.y}px`, width: `${columnWidth - 16}px` }"
            @click="selected = selected === item.node.key ? null : item.node.key"
          >
            <span class="map-node-label">{{ item.node.label }}</span>
            <span v-if="item.node.detail" class="map-node-detail">{{ item.node.detail }}</span>
          </button>
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
  gap: 12px;
  min-height: 0;
  padding-block: var(--page-content-gap) var(--spacing-xl);
}

.map-filter {
  width: 240px;
}

.map-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-line {
  display: inline-block;
  width: 26px;
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

.map-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.map-scroll {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}

.map-canvas {
  position: relative;
}

.map-column-head {
  position: absolute;
  top: 14px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}

.map-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.map-edge {
  stroke: var(--el-border-color-darker);
  stroke-width: 1.4;
}

.map-edge.derived {
  stroke-dasharray: 5 4;
  stroke: var(--el-text-color-disabled);
}

g.dimmed {
  opacity: 0.16;
}

.map-relations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  max-block-size: 7rem;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.map-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  height: 52px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color-light);
  border-left: 3px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.map-node:hover {
  box-shadow: var(--el-box-shadow-lighter);
}

.map-node.selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-7);
}

.map-node.column-subject {
  border-left-color: var(--el-color-primary);
}

.map-node.column-role {
  border-left-color: var(--el-color-success);
}

.map-node.column-workflow {
  border-left-color: var(--el-color-warning);
}

.map-node.column-action {
  border-left-color: var(--el-color-danger);
}

.map-node.column-metric {
  border-left-color: var(--el-color-info);
}

.map-node-label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-node-detail {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
