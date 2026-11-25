<script setup lang="ts">
import { computed, inject, watch } from "vue";
import { panelRecordObjectRef } from "@ontomato/contracts/panel-projection";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey, readerDataState } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { slotInputValues } from "../panel/ports";
import { projectionElement } from "../panel/projection-element";
import { stateObject, type PanelFieldValue } from "../panel/state";
import type { ObjectTitleTarget } from "./object-title-types";

/**
 * Lightweight inline display title for a platform object. Resolves the object's real display label from:
 * 1. Its own bound `record` datum when mounted as a projection member;
 * 2. A sibling projection `slot`'s published `label` / `selectedLabel` / `activeLabel` output (or its bound object input);
 * 3. A `target` reference (`{ className, primaryKey }`) looked up in the panel instance's reactive object name registry;
 * 4. The explicit `fallback` / `fallbackKey` text (or `target.primaryKey` when no fallback is provided).
 *
 * Suitable for inline placements such as `<sdk-drawer>` `#header` without replacing the drawer header with raw primary keys
 * or static placeholder copy.
 */
const props = withDefaults(
  defineProps<{
    /** Optional panel member slot key whose published `label` / `selectedLabel` / `activeLabel` output supplies the title. */
    slot?: string;
    /** Optional object identity (`{ className, primaryKey, label? }`) resolved via the panel's reactive object name cache. */
    target?: ObjectTitleTarget | null;
    /** Explicit fallback text shown when the object's display title is not yet available. */
    fallback?: string;
    /** Optional panel message key (resolved via `panel.t`) used as fallback when `fallback` is omitted. */
    fallbackKey?: string;
    /** Inline or heading HTML tag used to render the title; defaults to `"span"`. */
    tag?: "span" | "h1" | "h2" | "h3" | "h4" | "p";
  }>(),
  {
    slot: undefined,
    target: undefined,
    fallback: undefined,
    fallbackKey: undefined,
    tag: "span",
  },
);

const panel = inject(panelContextKey, null);
const currentSlot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = computed(() => memberGetter?.() ?? null);

const hasBoundRecord = computed(() => {
  const current = member.value;
  return Boolean(current && current.projection.data && Object.hasOwn(current.projection.data, "record"));
});

const recordData = member.value && hasBoundRecord.value
  ? readerDataState(member.value.data.use("record"))
  : computed(() => null);

const record = computed<PlatformObjectRecord | null>(() => {
  const current = recordData.value;
  return current?.status === "ready" ? (current.value as unknown as PlatformObjectRecord) : null;
});

watch(
  record,
  (found) => {
    if (!found || !panel || !currentSlot || !hasBoundRecord.value) return;
    const objectType = projectionElement(currentSlot.projection).id;
    const ref = panelRecordObjectRef(found, objectType);
    panel.instance.nameObjects(ref.className, [found]);
  },
  { immediate: true },
);

watch(
  () => record.value?.label ?? null,
  (label) => {
    if (!panel || !member.value || !hasBoundRecord.value) return;
    panel.instance.setMemberOutput(member.value.key, "label", label);
  },
  { immediate: true },
);

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

const slotOutputTitle = computed<string>(() => {
  if (!props.slot || !panel) return "";
  const outputs = panel.instance.outputs[props.slot];
  if (!outputs) return "";
  return nonEmptyString(outputs.label)
    || nonEmptyString(outputs.selectedLabel)
    || nonEmptyString(outputs.activeLabel);
});

const targetRegistryTitle = computed<string>(() => {
  const target = props.target;
  if (!target) return "";
  if (panel) {
    const named = panel.instance.objectName(target.className, target.primaryKey);
    if (named && named.trim() !== "") return named.trim();
  }
  return nonEmptyString(target.label);
});

const slotInputRegistryTitle = computed<string>(() => {
  if (!props.slot || !panel || !Object.hasOwn(panel.manifest.members, props.slot)) return "";
  const values = slotInputValues(panel.instance, props.slot);
  for (const value of Object.values(values)) {
    const ref = stateObject(value as PanelFieldValue);
    if (!ref) continue;
    const named = panel.instance.objectName(ref.className, ref.primaryKey);
    if (named && named.trim() !== "") return named.trim();
  }
  return "";
});

const fallbackText = computed<string>(() => {
  if (props.fallback !== undefined && props.fallback !== "") return props.fallback;
  if (props.fallbackKey && panel) {
    const translated = panel.t(props.fallbackKey);
    if (translated !== props.fallbackKey) return translated;
  }
  return "";
});

const displayTitle = computed<string>(() => {
  const boundLabel = nonEmptyString(record.value?.label);
  if (boundLabel) return boundLabel;
  if (slotOutputTitle.value) return slotOutputTitle.value;
  if (targetRegistryTitle.value) return targetRegistryTitle.value;
  if (slotInputRegistryTitle.value) return slotInputRegistryTitle.value;
  if (fallbackText.value) return fallbackText.value;
  return props.target?.primaryKey ?? "";
});
</script>

<template>
  <component :is="tag" class="sdk-object-title" :title="displayTitle || undefined">{{ displayTitle }}</component>
</template>

<style scoped>
.sdk-object-title {
  display: inline;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
