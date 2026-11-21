<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { platformObjectTypes, platformRelationKinds } from "@ontomato/contracts/platform-object-types";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberRead } from "../panel/member";
import type {
  PlatformGraphEdge,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphStatus,
} from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";

type PanelObjectValue = Extract<PanelStateValue, { className: string }>;

/**
 * Displays one-hop relations of the currently selected node, shared by the four-layer capability map (M3) and the
 * object browser instance graph (M4). Reads the member's `neighbors` datum (in both direct and framed panels).
 *
 * Groups edges by relation kind, distinguishes no-neighbors, owner-refused, read-failed and unavailable statuses per
 * relation kind, renders direction and solid/dashed line semantics, and writes the peer node's complete
 * `{ className, primaryKey }` identity to `selected` through `instance.output` when clicked.
 */
const props = withDefaults(
  defineProps<{
    /** Selected node identity whose relations are inspected. */
    selected?: PanelObjectValue | null;
    /** Fallback slot input name holding the selected node when `selected` is not passed directly. */
    input?: string;
    /** Prompt shown when no node is selected. */
    emptyText?: string;
  }>(),
  {
    selected: undefined,
    input: "selected",
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a peer node to move selection. */
  "update:selected": [node: PanelObjectValue];
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

const groups = computed<readonly RelationGroup[]>(() => {
  const data = result.value;
  if (!data) return [];

  const nodesByKey = new Map<string, PlatformGraphNode>();
  nodesByKey.set(nodeKey(data.node), data.node);
  for (const neighbor of data.neighbors) nodesByKey.set(nodeKey(neighbor), neighbor);

  const edgesByKind = new Map<string, PlatformGraphEdge[]>();
  for (const edge of data.edges) {
    let bucket = edgesByKind.get(edge.relationKind);
    if (!bucket) {
      bucket = [];
      edgesByKind.set(edge.relationKind, bucket);
    }
    bucket.push(edge);
  }

  const toRows = (edges: readonly PlatformGraphEdge[], kindDerived: boolean | undefined): RelationEdgeRow[] =>
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
      </header>

      <p v-if="forbidden" role="status" class="sdk-object-relations-status" data-status="forbidden">
        {{ t("platform.dataForbidden") }}
      </p>
      <p v-else-if="failure" role="alert" class="sdk-object-relations-error">{{ failure.message }}</p>
      <p v-else-if="loading" class="sdk-object-relations-loading" role="status">
        {{ t("platform.relationsLoading") }}
      </p>
      <p v-else-if="groups.length === 0" class="sdk-object-relations-empty" data-status="empty">
        {{ t("platform.graphNoNeighbors", { name: currentNodeLabel }) }}
      </p>

      <div v-else class="sdk-object-relations-groups">
        <div
          v-for="group in groups"
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
      </div>
    </template>
  </section>
</template>

<style scoped>
.sdk-object-relations {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-object-relations-header {
  align-items: center;
  border-bottom: 1px solid var(--ui-divider);
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-xs);
}
.sdk-object-relations-subject {
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}
.sdk-object-relations-type,
.sdk-object-relations-peer-type {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
  padding: 1px var(--spacing-xs);
}
.sdk-object-relations-prompt,
.sdk-object-relations-loading,
.sdk-object-relations-empty {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  margin: 0;
}
.sdk-object-relations-error {
  color: var(--el-color-danger);
  font-size: var(--text-xs);
  margin: 0;
}
.sdk-object-relations-groups {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-object-relations-group {
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-sm);
}
.sdk-object-relations-group-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-relations-kind {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.sdk-object-relations-line {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: inline-flex;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
}
.sdk-object-relations-swatch,
.sdk-object-relations-line-mini {
  border-top: 2px solid var(--el-text-color-secondary);
  display: inline-block;
  width: 16px;
}
.sdk-object-relations-line[data-line="dashed"] .sdk-object-relations-swatch,
.sdk-object-relations-line-mini[data-line="dashed"] {
  border-top-style: dashed;
}
.sdk-object-relations-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.sdk-object-relations-edges {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  list-style: none;
  margin: 0;
  padding: 0;
}
.sdk-object-relations-edge {
  align-items: center;
  display: flex;
  gap: var(--spacing-xs);
}
.sdk-object-relations-dir {
  color: var(--el-text-color-secondary);
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
  padding: calc(var(--spacing-xs) / 2) var(--spacing-xs);
  text-align: left;
}
.sdk-object-relations-peer:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-relations-peer-name {
  text-decoration: underline;
  text-underline-offset: 2px;
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
  color: var(--el-text-color-secondary);
}
.sdk-object-relations-status[data-status="refused"] {
  color: var(--el-color-warning);
}
.sdk-object-relations-status[data-status="failed"] {
  color: var(--el-color-danger);
}
.sdk-object-relations-status[data-status="unavailable"] {
  color: var(--el-text-color-secondary);
}
.sdk-object-relations-reason {
  color: var(--el-text-color-secondary);
}
</style>
