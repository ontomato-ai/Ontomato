<script setup lang="ts">
import { projectionElement } from "../panel/direct";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { panelChildCollectionQuerySchema, type PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import {
  SegmentedTextReader,
  type SegmentedTextPage,
  type SegmentedTextSource,
} from "@ontomato/foundation-ui/reader";
import { slotInputState, usePanelContext, useProjectionObjects, useProjectionSlot } from "../panel/context";
import { adapterPart } from "../panel/platform-objects";
import { stateObject } from "../panel/state";

/**
 * Projection-bound offset-paged text reader. Reads sources (unless passed explicitly) and offset slices through the
 * bound type's resource adapter (`readSegment`), optionally scoped to a declared child collection of a parent object,
 * and supports sharing `activeAnchor` / `activeSourceId` across multiple placements on one page so only one reader is
 * expanded at a time.
 */
const props = withDefaults(
  defineProps<{
    /** Optional slot input holding the parent object that scopes source listing and segment reads. */
    parentInput?: string;
    /** Declared child collection name owned by the parent type (e.g. `"sources"`). */
    collection?: string;
    /** Explicit list of source chips; when omitted, lists sources through the bound adapter's `query`/`list`. */
    sources?: readonly SegmentedTextSource[];
    /** Placement key on the page; when paired with `activeAnchor`, only the matching placement expands. */
    anchor?: string;
    /** Currently expanded anchor across placements on the same page (`v-model:activeAnchor`). */
    activeAnchor?: string | null;
    /** Currently opened source ID (`v-model:activeSourceId`). */
    activeSourceId?: string | null;
    /** Optional custom label for the "More" button (resolved via `panel.t`). */
    moreLabel?: string;
    /** Optional accessible label for the Close button (resolved via `panel.t`). */
    closeLabel?: string;
    /** Optional empty-state text (resolved via `panel.t`). */
    emptyText?: string;
  }>(),
  {
    parentInput: undefined,
    collection: undefined,
    sources: undefined,
    anchor: undefined,
    activeAnchor: undefined,
    activeSourceId: undefined,
    moreLabel: undefined,
    closeLabel: undefined,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  "update:activeAnchor": [anchor: string | null];
  "update:activeSourceId": [sourceId: string | null];
  close: [anchor?: string];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objects = useProjectionObjects();
const objectType = projectionElement(slot.projection).id;

const childMode = computed(() => Boolean(props.parentInput || props.collection));
const parentState = computed(
  () => (props.parentInput ? slotInputState(panel.manifest, slot.slot, props.parentInput) : null),
);
const parentRef = computed<PanelObjectIdentity | null>(() => {
  if (!parentState.value) return null;
  const value = stateObject(panel.instance.state.values.value[parentState.value]);
  return value && { objectType: value.className, primaryKey: value.primaryKey };
});
const parentIdentity = computed(() => (parentRef.value ? `${parentRef.value.objectType}\u0000${parentRef.value.primaryKey}` : ""));

const listedSources = shallowRef<readonly SegmentedTextSource[]>([]);
const localAnchor = ref<string | null>(null);
const localSourceId = ref<string | null>(null);
const page = shallowRef<SegmentedTextPage | null>(null);
const loading = ref(false);
const failure = shallowRef<Error | null>(null);

const currentAnchor = computed(() => (props.activeAnchor !== undefined ? props.activeAnchor : localAnchor.value));
const currentSourceId = computed(() => (props.activeSourceId !== undefined ? props.activeSourceId : localSourceId.value));
const shownSources = computed(() => props.sources ?? listedSources.value);

let listSeq = 0;
let segmentSeq = 0;

function loadSources() {
  if (props.sources !== undefined) return;
  const seq = ++listSeq;
  if (childMode.value && !parentRef.value) {
    listedSources.value = [];
    return;
  }
  void objects.query(
    childMode.value
      ? { ...(parentRef.value ? { parent: parentRef.value } : {}), ...(props.collection ? { collection: props.collection } : {}) }
      : {},
  ).then(
    (result) => {
      if (seq !== listSeq) return;
      listedSources.value = result.items.map((item) => ({ id: item.primaryKey, title: item.label }));
    },
    (reason: unknown) => {
      if (seq !== listSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
    },
  );
}

function readAt(sourceId: string, offset: number) {
  const seq = ++segmentSeq;
  loading.value = true;
  failure.value = null;
  let readSegment: ReturnType<typeof adapterPart<"readSegment">>;
  let childScope: { parent: PanelObjectIdentity; collection: string } | null = null;
  try {
    readSegment = adapterPart(objectType, "readSegment");
    if (childMode.value) {
      childScope = panelChildCollectionQuerySchema.parse({ parent: parentRef.value, collection: props.collection });
    }
  } catch (reason: unknown) {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
    loading.value = false;
    return;
  }
  void readSegment({
    ...(childScope ?? {}),
    sourceId,
    offset,
  }).then(
    (result) => {
      if (seq !== segmentSeq) return;
      page.value = result;
      loading.value = false;
    },
    (reason: unknown) => {
      if (seq !== segmentSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}

function setActive(anchor: string | null, sourceId: string | null) {
  if (props.activeAnchor === undefined) localAnchor.value = anchor;
  if (props.activeSourceId === undefined) localSourceId.value = sourceId;
  emit("update:activeAnchor", anchor);
  emit("update:activeSourceId", sourceId);
}

function onOpen(sourceId: string, offset: number) {
  setActive(props.anchor ?? null, sourceId);
  readAt(sourceId, offset);
}

function onMore(sourceId: string, nextOffset: number) {
  readAt(sourceId, nextOffset);
}

function onClose() {
  segmentSeq++;
  page.value = null;
  failure.value = null;
  loading.value = false;
  setActive(null, null);
  emit("close", props.anchor);
}

onMounted(loadSources);
watch(parentIdentity, () => {
  if (!props.parentInput) return;
  onClose();
  loadSources();
});
</script>

<template>
  <SegmentedTextReader
    :sources="shownSources"
    :anchor="anchor"
    :active-anchor="currentAnchor"
    :active-source-id="currentSourceId"
    :page="page"
    :loading="loading"
    :error="failure?.message ?? null"
    :more-label="moreLabel ? panel.t(moreLabel) : t('platform.readerMore')"
    :close-label="closeLabel ? panel.t(closeLabel) : t('platform.readerClose')"
    :empty-text="emptyText ? panel.t(emptyText) : t('platform.readerEmpty')"
    :loading-text="t('platform.readerLoading')"
    @open="onOpen"
    @more="onMore"
    @close="onClose"
  />
</template>
