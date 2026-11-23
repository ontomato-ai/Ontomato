<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { PanelObjectRef } from "@ontomato/contracts/panel-manifest";
import type { PlatformOntologyEdgeBinding } from "@ontomato/contracts/platform-ontology";
import {
  ONTOLOGY_RELATION_KIND,
  platformObjectTypes,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberOutput, useMemberParam, useMemberRead } from "../panel/member";
import type {
  PlatformGraphEdge,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphStatus,
} from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";

type PanelObjectValue = PanelObjectRef;
type RelationGraphEdge = PlatformGraphEdge & {
  readonly binding?: PlatformOntologyEdgeBinding;
};

/**
 * Displays one-hop relations of the currently selected node, shared by the four-layer capability map (M3) and the
 * object browser instance graph (M4). Reads the member's `neighbors` datum (in both direct and framed panels).
 *
 * Groups edges by relation kind, distinguishes no-neighbors, owner-refused, read-failed and unavailable statuses per
 * relation kind, renders direction, solid/dashed line semantics and optional edge binding details, supports relation
 * kind filtering (`visibleRelationKinds` / `showRelationFilter`), header summary (`showSummary`), collapsing empty
 * `ok` relation groups (`collapseEmptyGroups`), moving selection (`selected`), and promoting a peer node as start
 * (`allowSetStart` / `start`).
 */
const props = withDefaults(
  defineProps<{
    /** Selected node identity whose relations are inspected. */
    selected?: PanelObjectValue | null;
    /** Fallback slot input name holding the selected node when `selected` is not passed directly. */
    input?: string;
    /** Prompt shown when no node is selected. */
    emptyText?: string;
    /**
     * Relation kinds to display (`platform:OntologyRelationKind` refs or relation kind IDs). When omitted, reads and
     * writes the member's `visibleRelationKinds` parameter (bound panel state or local filter).
     */
    visibleRelationKinds?: readonly (PanelObjectValue | string)[] | null;
    /** Show a multi-select relation kind filter control (default `false`). */
    showRelationFilter?: boolean;
    /** Show a "Set as start" button beside each peer node (default `false`; also enabled when `start` output is bound). */
    allowSetStart?: boolean;
    /** Show a header edge count and distinct notices for no-neighbors, refused, failed and unavailable kinds (default `false`). */
    showSummary?: boolean;
    /** Collapse `ok` relation kinds that have zero edges into one count line while keeping non-empty and non-`ok` groups expanded (default `false`). */
    collapseEmptyGroups?: boolean;
  }>(),
  {
    selected: undefined,
    input: "selected",
    emptyText: undefined,
    visibleRelationKinds: undefined,
    showRelationFilter: false,
    allowSetStart: false,
    showSummary: false,
    collapseEmptyGroups: false,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a peer node to move selection. */
  "update:selected": [node: PanelObjectValue];
  /** Emitted when a reader promotes a peer node to be the graph start. */
  "update:start": [node: PanelObjectValue];
  /** Emitted when a reader updates the active relation kind filter (`null` clears the filter to show all kinds). */
  "update:visibleRelationKinds": [kinds: PanelObjectValue[] | null];
}>();

const { t, te } = useI18n();
const panel = usePanelContext();
const member = useMember();

const neighborsDatum = member.projection.data.neighbors;
if (!neighborsDatum) {
  throw new Error(`Member '${member.key}' declares no 'neighbors' datum`);
}
const nodeParam = neighborsDatum.params.node;
const memberNodeInput = nodeParam && "input" in nodeParam ? nodeParam.input : undefined;
const memberNeighbors = useMemberData("neighbors");
const readMemberNeighbors = useMemberRead("neighbors");
const visibleKindsParam = useMemberParam("visibleRelationKinds");

const relationMetaById = new Map(platformRelationKinds.map((kind) => [kind.id, kind]));

const manualLoading = ref(false);
const manualForbidden = ref(false);
const manualFailure = shallowRef<Error | null>(null);
const manualResult = shallowRef<PlatformGraphNeighborsResult | null>(null);

function nodeKey(ref: PanelObjectValue): string {
  return `${ref.className}\u0000${ref.primaryKey}`;
}

const memberBoundNode = computed<PanelObjectValue | null>(() => {
  if (!memberNodeInput) return null;
  const value = stateObject(member.inputs.value[memberNodeInput] as PanelFieldValue | undefined);
  return value && { className: value.className, primaryKey: value.primaryKey };
});

const activeSelected = computed<PanelObjectValue | null>(() => {
  if (props.selected !== undefined) return props.selected;
  const raw = member.inputs.value[props.input] as PanelFieldValue | undefined;
  const value = stateObject(raw);
  return value ? { className: value.className, primaryKey: value.primaryKey } : memberBoundNode.value;
});

const usesMemberDatum = computed(() => {
  if (!memberNodeInput) return true;
  if (!activeSelected.value && !memberBoundNode.value) return true;
  if (!activeSelected.value || !memberBoundNode.value) return false;
  return nodeKey(activeSelected.value) === nodeKey(memberBoundNode.value);
});

const loading = computed(() =>
  usesMemberDatum.value ? memberNeighbors.value.status === "loading" : manualLoading.value,
);
const forbidden = computed(() =>
  usesMemberDatum.value ? memberNeighbors.value.status === "forbidden" : manualForbidden.value,
);
const failure = computed<Error | null>(() => {
  if (!usesMemberDatum.value) return manualFailure.value;
  return memberNeighbors.value.status === "error" ? new Error(memberNeighbors.value.message) : null;
});
const result = computed<PlatformGraphNeighborsResult | null>(() => {
  if (!usesMemberDatum.value) return manualResult.value;
  return memberNeighbors.value.status === "ready"
    ? (memberNeighbors.value.value as unknown as PlatformGraphNeighborsResult)
    : null;
});

function nameNodes(nodes: readonly PlatformGraphNode[]) {
  const byType = new Map<string, { primaryKey: string; label: string }[]>();
  for (const node of nodes) {
    let bucket = byType.get(node.className);
    if (!bucket) {
      bucket = [];
      byType.set(node.className, bucket);
    }
    bucket.push({ primaryKey: node.primaryKey, label: node.label });
  }
  for (const [className, items] of byType) panel.instance.nameObjects(className, items);
}

watch(
  result,
  (data) => {
    if (data) nameNodes([data.node, ...data.neighbors]);
  },
  { immediate: true },
);

function resolveKey(key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  if (te(key)) return t(key);
  const fromPanel = panel.t(key);
  return fromPanel !== key ? fromPanel : fallback;
}

function typeDisplayName(className: string): string {
  return resolveKey(platformObjectTypes[className]?.labelKey, className);
}

function relationDisplayName(relationKind: string, explicitLabel?: string): string {
  if (explicitLabel) return resolveKey(explicitLabel, explicitLabel);
  const meta = relationMetaById.get(relationKind);
  return resolveKey(meta?.labelKey, relationKind);
}

interface RelationEdgeRow {
  readonly id: string;
  readonly direction: "outgoing" | "incoming";
  readonly derived: boolean;
  readonly peer: PanelObjectValue;
  readonly peerLabel: string;
  readonly peerTypeLabel: string;
  readonly binding?: PlatformOntologyEdgeBinding;
}

interface RelationGroup {
  readonly relationKind: string;
  readonly label: string;
  readonly status: PlatformGraphStatus;
  readonly reason?: string;
  readonly derived?: boolean;
  readonly truncated?: boolean;
  readonly edges: readonly RelationEdgeRow[];
}

const currentNodeLabel = computed(() => {
  if (result.value) return result.value.node.label;
  if (!activeSelected.value) return "";
  return activeSelected.value.primaryKey;
});

const currentNodeTypeLabel = computed(() => {
  const className = result.value?.node.className ?? activeSelected.value?.className;
  return className ? typeDisplayName(className) : "";
});

function hasBindingDetails(binding: PlatformOntologyEdgeBinding | undefined): binding is PlatformOntologyEdgeBinding {
  if (!binding) return false;
  return Boolean(binding.reads?.length || binding.operations?.length || binding.viaInput);
}

const groups = computed<readonly RelationGroup[]>(() => {
  const data = result.value;
  if (!data) return [];

  const nodesByKey = new Map<string, PlatformGraphNode>();
  nodesByKey.set(nodeKey(data.node), data.node);
  for (const neighbor of data.neighbors) nodesByKey.set(nodeKey(neighbor), neighbor);

  const edgesByKind = new Map<string, RelationGraphEdge[]>();
  for (const edge of data.edges as readonly RelationGraphEdge[]) {
    let bucket = edgesByKind.get(edge.relationKind);
    if (!bucket) {
      bucket = [];
      edgesByKind.set(edge.relationKind, bucket);
    }
    bucket.push(edge);
  }

  const toRows = (edges: readonly RelationGraphEdge[], kindDerived: boolean | undefined): RelationEdgeRow[] =>
    edges.map((edge) => {
      const peerRef = edge.direction === "outgoing" ? edge.to : edge.from;
      const peerNode = nodesByKey.get(nodeKey(peerRef));
      return {
        id: edge.id,
        direction: edge.direction,
        derived: edge.derived ?? kindDerived ?? false,
        peer: { className: peerRef.className, primaryKey: peerRef.primaryKey },
        peerLabel: peerNode?.label ?? peerRef.primaryKey,
        peerTypeLabel: typeDisplayName(peerRef.className),
        ...(hasBindingDetails(edge.binding) ? { binding: edge.binding } : {}),
      };
    });

  const seen = new Set<string>();
  const built: RelationGroup[] = [];

  for (const statusEntry of data.relations) {
    seen.add(statusEntry.relationKind);
    const kindEdges = edgesByKind.get(statusEntry.relationKind) ?? [];
    const meta = relationMetaById.get(statusEntry.relationKind);
    const derived = kindEdges[0]?.derived ?? meta?.derived;
    const truncated = "truncated" in statusEntry ? Boolean((statusEntry as { truncated?: boolean }).truncated) : false;
    built.push({
      relationKind: statusEntry.relationKind,
      label: relationDisplayName(statusEntry.relationKind, kindEdges[0]?.label),
      status: statusEntry.status,
      reason: statusEntry.reason,
      derived,
      ...(truncated ? { truncated: true } : {}),
      edges: toRows(kindEdges, derived),
    });
  }

  for (const [relationKind, kindEdges] of edgesByKind) {
    if (seen.has(relationKind)) continue;
    const meta = relationMetaById.get(relationKind);
    const derived = kindEdges[0]?.derived ?? meta?.derived;
    built.push({
      relationKind,
      label: relationDisplayName(relationKind, kindEdges[0]?.label),
      status: "ok",
      derived,
      edges: toRows(kindEdges, derived),
    });
  }

  return built;
});

function extractRelationKindIds(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("visibleRelationKinds holds a list of relation kinds");
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.length > 0) ids.push(entry);
    } else if (entry && typeof entry === "object" && typeof (entry as { primaryKey?: unknown }).primaryKey === "string") {
      const pk = (entry as { primaryKey: string }).primaryKey;
      if (pk.length > 0) ids.push(pk);
    }
  }
  return ids;
}

const selectedRelationKindIds = computed<string[]>(() => {
  const raw = props.visibleRelationKinds !== undefined ? props.visibleRelationKinds : visibleKindsParam.value.value;
  return extractRelationKindIds(raw);
});

const shownRelationKinds = computed<ReadonlySet<string> | null>(() =>
  selectedRelationKindIds.value.length > 0 ? new Set(selectedRelationKindIds.value) : null,
);

function updateRelationFilter(ids: readonly string[]) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const next: PanelObjectValue[] | null = unique.length
    ? unique.map((id) => ({ className: ONTOLOGY_RELATION_KIND, primaryKey: id }))
    : null;
  visibleKindsParam.set(next);
  emit("update:visibleRelationKinds", next);
}

const relationFilterModel = computed<string[]>({
  get: () => selectedRelationKindIds.value,
  set: (ids) => updateRelationFilter(ids),
});

const relationFilterOptions = computed(() => {
  const byId = new Map<string, { value: string; label: string }>();
  for (const group of groups.value) {
    byId.set(group.relationKind, { value: group.relationKind, label: group.label });
  }
  for (const id of selectedRelationKindIds.value) {
    if (!byId.has(id)) byId.set(id, { value: id, label: relationDisplayName(id) });
  }
  return [...byId.values()];
});

const filteredGroups = computed<readonly RelationGroup[]>(() => {
  const active = shownRelationKinds.value;
  if (!active) return groups.value;
  return groups.value.filter((group) => active.has(group.relationKind));
});

const GROUP_STATUS_PRIORITY: Readonly<Record<PlatformGraphStatus, number>> = {
  refused: 0,
  failed: 1,
  unavailable: 2,
  ok: 3,
};

const displayedGroups = computed<readonly RelationGroup[]>(() => {
  if (!props.collapseEmptyGroups) return filteredGroups.value;
  return filteredGroups.value
    .filter((group) => group.edges.length > 0 || group.status !== "ok")
    .sort((left, right) => GROUP_STATUS_PRIORITY[left.status] - GROUP_STATUS_PRIORITY[right.status]);
});

const collapsedEmptyGroups = computed<readonly RelationGroup[]>(() => {
  if (!props.collapseEmptyGroups) return [];
  return filteredGroups.value.filter((group) => group.edges.length === 0 && group.status === "ok");
});

const relationSummary = computed(() => {
  const data = result.value;
  if (!data) return null;
  const allGroups = groups.value;
  const edgeCount = data.edges.length;
  const refused = allGroups.filter((group) => group.status === "refused");
  const failed = allGroups.filter((group) => group.status === "failed");
  const unavailable = allGroups.filter((group) => group.status === "unavailable");
  const noNeighbors = edgeCount === 0 && refused.length === 0 && failed.length === 0 && unavailable.length === 0;
  return { edgeCount, refused, failed, unavailable, noNeighbors };
});

const hasSummaryNotices = computed(() => {
  const summary = relationSummary.value;
  if (!summary) return false;
  return summary.noNeighbors || summary.refused.length > 0 || summary.failed.length > 0 || summary.unavailable.length > 0;
});

function formatSummaryKinds(items: readonly RelationGroup[]): string {
  return items.map((item) => item.label).join(", ");
}

const canSetStart = computed(() =>
  props.allowSetStart
  || Boolean(panel.manifest.members[member.key]?.outputs?.start || member.projection.outputs?.start),
);

const memberStatus = computed<"idle" | "loading" | "ready" | "forbidden" | "error">(() => {
  if (!activeSelected.value) return "idle";
  if (forbidden.value) return "forbidden";
  if (failure.value) return "error";
  if (loading.value) return "loading";
  return result.value ? "ready" : "idle";
});

useMemberOutput("status", () => memberStatus.value);
useMemberOutput("edgeCount", () => (result.value ? result.value.edges.length : null));
useMemberOutput("label", () => currentNodeLabel.value || null);

let requestSeq = 0;

function load(target: PanelObjectValue | null) {
  const seq = ++requestSeq;
  manualForbidden.value = false;
  manualFailure.value = null;
  if (!target || usesMemberDatum.value) {
    manualResult.value = null;
    manualLoading.value = false;
    return;
  }
  manualLoading.value = true;
  void readMemberNeighbors({ node: { className: target.className, primaryKey: target.primaryKey } }).then((state) => {
    if (seq !== requestSeq) return;
    manualLoading.value = false;
    if (state.status === "ready") {
      manualResult.value = state.value as unknown as PlatformGraphNeighborsResult;
    } else if (state.status === "forbidden") {
      manualResult.value = null;
      manualForbidden.value = true;
    } else if (state.status === "error") {
      manualResult.value = null;
      manualFailure.value = new Error(state.message);
    } else {
      manualResult.value = null;
    }
  }, (reason: unknown) => {
    if (seq !== requestSeq) return;
    manualResult.value = null;
    manualFailure.value = reason instanceof Error ? reason : new Error(String(reason));
    manualLoading.value = false;
  });
}

watch(
  () => [usesMemberDatum.value, activeSelected.value ? nodeKey(activeSelected.value) : null] as const,
  () => load(activeSelected.value),
  { immediate: true },
);

onBeforeUnmount(
  panel.instance.onObjectChanged(() => {
    if (!usesMemberDatum.value && activeSelected.value) load(activeSelected.value);
  }),
);

function selectPeer(peer: PanelObjectValue) {
  const next: PanelObjectValue = { className: peer.className, primaryKey: peer.primaryKey };
  void panel.instance.output(member.key, "selected", next);
  emit("update:selected", next);
}

function setStartPeer(peer: PanelObjectValue) {
  const next: PanelObjectValue = { className: peer.className, primaryKey: peer.primaryKey };
  void panel.instance.output(member.key, "start", next);
  emit("update:start", next);
}

function statusText(status: PlatformGraphStatus): string {
  if (status === "refused") return t("platform.graphStatusRefused");
  if (status === "failed") return t("platform.graphStatusFailed");
  if (status === "unavailable") return t("platform.graphStatusUnavailable");
  return t("platform.relationsNoNeighbors");
}
</script>

<template>
  <section class="sdk-object-relations" :aria-label="member.projection.name">
    <p v-if="!activeSelected" class="sdk-object-relations-prompt">
      {{ emptyText ? panel.t(emptyText) : t("platform.relationsEmptySelection") }}
    </p>
    <template v-else>
      <header class="sdk-object-relations-header">
        <span class="sdk-object-relations-subject">{{ currentNodeLabel }}</span>
        <span v-if="currentNodeTypeLabel" class="sdk-object-relations-type">{{ currentNodeTypeLabel }}</span>
        <span
          v-if="showSummary && relationSummary && !loading && !forbidden && !failure"
          class="sdk-object-relations-summary-count"
        >
          {{ t("platform.relationsSummaryCount", { count: relationSummary.edgeCount }) }}
        </span>
      </header>

      <p v-if="forbidden" role="status" class="sdk-object-relations-status" data-status="forbidden">
        {{ t("platform.dataForbidden") }}
      </p>
      <p v-else-if="failure" role="alert" class="sdk-object-relations-error">{{ failure.message }}</p>
      <p v-else-if="loading" class="sdk-object-relations-loading" role="status">
        {{ t("platform.relationsLoading") }}
      </p>
      <template v-else>
        <div
          v-if="showSummary && relationSummary && hasSummaryNotices"
          class="sdk-object-relations-summary"
        >
          <p
            v-if="relationSummary.noNeighbors"
            class="sdk-object-relations-summary-item"
            role="status"
            data-status="no-neighbors"
          >
            {{ t("platform.graphNoNeighbors", { name: currentNodeLabel }) }}
          </p>
          <p
            v-if="relationSummary.refused.length > 0"
            class="sdk-object-relations-summary-item"
            role="status"
            data-status="refused"
          >
            {{ t("platform.graphRelationsRefused", { count: relationSummary.refused.length, relations: formatSummaryKinds(relationSummary.refused) }) }}
          </p>
          <p
            v-if="relationSummary.failed.length > 0"
            class="sdk-object-relations-summary-item"
            role="alert"
            data-status="failed"
          >
            {{ t("platform.graphRelationsFailed", { count: relationSummary.failed.length, relations: formatSummaryKinds(relationSummary.failed) }) }}
          </p>
          <p
            v-if="relationSummary.unavailable.length > 0"
            class="sdk-object-relations-summary-item"
            role="status"
            data-status="unavailable"
          >
            {{ t("platform.graphRelationsUnavailable", { count: relationSummary.unavailable.length, relations: formatSummaryKinds(relationSummary.unavailable) }) }}
          </p>
        </div>

        <div
          v-if="showRelationFilter && (relationFilterOptions.length > 1 || selectedRelationKindIds.length > 0)"
          class="sdk-object-relations-filter"
        >
          <ElSelect
            v-model="relationFilterModel"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            size="small"
            class="sdk-object-relations-filter-select"
            :placeholder="t('platform.relationsAllKinds')"
            :aria-label="t('platform.relationsKindFilter')"
          >
            <ElOption
              v-for="option in relationFilterOptions"
              :key="option.value"
              :value="option.value"
              :label="option.label"
            />
          </ElSelect>
        </div>

        <p v-if="groups.length === 0 && !showSummary" class="sdk-object-relations-empty" data-status="empty">
          {{ t("platform.graphNoNeighbors", { name: currentNodeLabel }) }}
        </p>
        <p
          v-else-if="groups.length > 0 && filteredGroups.length === 0"
          class="sdk-object-relations-empty"
          data-status="filtered-empty"
        >
          {{ t("platform.dataNoMatch") }}
        </p>

        <div v-else-if="displayedGroups.length > 0 || collapsedEmptyGroups.length > 0" class="sdk-object-relations-groups">
          <div
            v-for="group in displayedGroups"
            :key="group.relationKind"
            class="sdk-object-relations-group"
            :data-relation-kind="group.relationKind"
            :data-status="group.status === 'ok' && group.edges.length === 0 ? 'empty' : group.status"
            :data-truncated="group.truncated ? 'true' : undefined"
          >
            <div class="sdk-object-relations-group-head">
              <span class="sdk-object-relations-kind">{{ group.label }}</span>
              <span
                v-if="group.derived !== undefined"
                class="sdk-object-relations-line"
                :data-line="group.derived ? 'dashed' : 'solid'"
              >
                <span class="sdk-object-relations-swatch" aria-hidden="true"></span>
                <span>{{ group.derived ? t("platform.graphEdgeDerived") : t("platform.graphEdgeStored") }}</span>
              </span>
              <span v-if="group.status === 'ok' && group.edges.length > 0" class="sdk-object-relations-count">
                {{ group.edges.length }}
              </span>
            </div>

            <ul v-if="group.status === 'ok' && group.edges.length > 0" class="sdk-object-relations-edges">
              <li v-for="edge in group.edges" :key="edge.id" class="sdk-object-relations-edge">
                <div class="sdk-object-relations-edge-main">
                  <span
                    class="sdk-object-relations-dir"
                    :data-direction="edge.direction"
                    :title="edge.direction === 'outgoing' ? t('platform.relationsOutgoing') : t('platform.relationsIncoming')"
                    :aria-label="edge.direction === 'outgoing' ? t('platform.relationsOutgoing') : t('platform.relationsIncoming')"
                  >
                    {{ edge.direction === "outgoing" ? "→" : "←" }}
                  </span>
                  <span
                    class="sdk-object-relations-line-mini"
                    :data-line="edge.derived ? 'dashed' : 'solid'"
                    :title="edge.derived ? t('platform.graphEdgeDerived') : t('platform.graphEdgeStored')"
                    aria-hidden="true"
                  ></span>
                  <button
                    type="button"
                    class="sdk-object-relations-peer"
                    @click="selectPeer(edge.peer)"
                  >
                    <span class="sdk-object-relations-peer-name">{{ edge.peerLabel }}</span>
                    <span class="sdk-object-relations-peer-type">{{ edge.peerTypeLabel }}</span>
                  </button>
                  <button
                    v-if="canSetStart"
                    type="button"
                    class="sdk-object-relations-set-start"
                    @click="setStartPeer(edge.peer)"
                  >
                    {{ t("platform.relationsSetAsStart") }}
                  </button>
                </div>
                <div v-if="edge.binding" class="sdk-object-relations-binding">
                  <span
                    v-if="edge.binding.reads?.length"
                    class="sdk-object-relations-binding-tag"
                    data-binding-part="reads"
                  >
                    {{ t("platform.relationsBoundReads", { names: edge.binding.reads.join(", ") }) }}
                  </span>
                  <span
                    v-if="edge.binding.operations?.length"
                    class="sdk-object-relations-binding-tag"
                    data-binding-part="operations"
                  >
                    {{ t("platform.relationsBoundOperations", { names: edge.binding.operations.join(", ") }) }}
                  </span>
                  <span
                    v-if="edge.binding.viaInput"
                    class="sdk-object-relations-binding-tag"
                    data-binding-part="via-input"
                  >
                    {{ t("platform.relationsBoundViaInput") }}
                  </span>
                </div>
              </li>
            </ul>

            <p
              v-else
              class="sdk-object-relations-status"
              :data-status="group.status === 'ok' ? 'empty' : group.status"
            >
              <span class="sdk-object-relations-status-label">{{ statusText(group.status) }}</span>
              <span v-if="group.reason" class="sdk-object-relations-reason">{{ group.reason }}</span>
            </p>
          </div>

          <p
            v-if="collapsedEmptyGroups.length > 0"
            class="sdk-object-relations-empty-kinds"
            data-status="empty-kinds"
          >
            {{ t("platform.relationsEmptyKinds", { count: collapsedEmptyGroups.length }) }}
          </p>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.sdk-object-relations {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.sdk-object-relations-header {
  align-items: center;
  border-bottom: 1px solid var(--ui-divider);
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-width: 0;
  padding-bottom: var(--spacing-xs);
}
.sdk-object-relations-subject {
  color: var(--sdk-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  min-width: 0;
  overflow-wrap: anywhere;
}
.sdk-object-relations-type,
.sdk-object-relations-peer-type {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
  padding: 1px var(--spacing-xs);
}
.sdk-object-relations-summary-count {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  margin-inline-start: auto;
}
.sdk-object-relations-summary {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-object-relations-summary-item {
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: 0;
  overflow-wrap: anywhere;
  padding: var(--spacing-xs) var(--spacing-sm);
}
.sdk-object-relations-summary-item[data-status="refused"] {
  background: var(--sdk-color-warning-light-9);
  color: var(--sdk-color-warning-dark-2);
}
.sdk-object-relations-summary-item[data-status="failed"] {
  background: var(--sdk-color-danger-light-9);
  color: var(--sdk-color-danger);
}
.sdk-object-relations-summary-item[data-status="unavailable"],
.sdk-object-relations-summary-item[data-status="no-neighbors"] {
  background: var(--ui-fill-tertiary);
  color: var(--sdk-text-color-secondary);
}
.sdk-object-relations-filter {
  flex: 0 0 auto;
  min-width: 0;
}
.sdk-object-relations-filter-select {
  width: 100%;
}
.sdk-object-relations-prompt,
.sdk-object-relations-loading,
.sdk-object-relations-empty,
.sdk-object-relations-empty-kinds {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  margin: 0;
}
.sdk-object-relations-error {
  color: var(--sdk-color-danger);
  font-size: var(--text-xs);
  margin: 0;
}
.sdk-object-relations-groups {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.sdk-object-relations-group {
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
  padding: var(--spacing-sm) var(--spacing-sm);
}
.sdk-object-relations-group[data-status="refused"] {
  border-color: var(--sdk-color-warning-light-7, var(--ui-divider));
}
.sdk-object-relations-group[data-status="failed"] {
  border-color: var(--sdk-color-danger-light-7, var(--ui-divider));
}
.sdk-object-relations-group-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-width: 0;
}
.sdk-object-relations-kind {
  color: var(--sdk-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  min-width: 0;
  overflow-wrap: anywhere;
}
.sdk-object-relations-line {
  align-items: center;
  color: var(--sdk-text-color-secondary);
  display: inline-flex;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
}
.sdk-object-relations-swatch,
.sdk-object-relations-line-mini {
  border-top: 2px solid var(--sdk-text-color-secondary);
  display: inline-block;
  flex-shrink: 0;
  width: 16px;
}
.sdk-object-relations-line[data-line="dashed"] .sdk-object-relations-swatch,
.sdk-object-relations-line-mini[data-line="dashed"] {
  border-top-style: dashed;
}
.sdk-object-relations-count {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  margin-inline-start: auto;
}
.sdk-object-relations-edges {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0;
}
.sdk-object-relations-edge {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
  min-width: 0;
}
.sdk-object-relations-edge-main {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-object-relations-dir {
  color: var(--sdk-text-color-secondary);
  flex-shrink: 0;
  font-size: var(--text-xs);
  width: 14px;
}
.sdk-object-relations-peer {
  align-items: center;
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--brand-link);
  cursor: pointer;
  display: inline-flex;
  flex-wrap: wrap;
  font-size: var(--text-sm);
  gap: var(--spacing-xs);
  max-width: 100%;
  min-width: 0;
  padding: calc(var(--spacing-xs) / 2) var(--spacing-xs);
  text-align: left;
}
.sdk-object-relations-peer:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-relations-peer-name {
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sdk-object-relations-set-start {
  background: var(--sdk-fill-color-blank);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-xs);
  color: var(--sdk-text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  margin-inline-start: auto;
  padding: 1px var(--spacing-xs);
}
.sdk-object-relations-set-start:hover {
  border-color: var(--sdk-color-primary);
  color: var(--brand-link);
}
.sdk-object-relations-binding {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  min-width: 0;
  padding-inline-start: calc(14px + 16px + var(--spacing-xs) * 2);
}
.sdk-object-relations-binding-tag {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
  padding: 1px var(--spacing-xs);
}
.sdk-object-relations-status {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
  margin: 0;
}
.sdk-object-relations-status[data-status="empty"] {
  color: var(--sdk-text-color-secondary);
}
.sdk-object-relations-status[data-status="refused"] {
  color: var(--sdk-color-warning);
}
.sdk-object-relations-status[data-status="failed"] {
  color: var(--sdk-color-danger);
}
.sdk-object-relations-status[data-status="unavailable"] {
  color: var(--sdk-text-color-secondary);
}
.sdk-object-relations-reason {
  color: var(--sdk-text-color-secondary);
  overflow-wrap: anywhere;
}
</style>
