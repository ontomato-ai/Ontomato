<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { formFieldAt, usePanelContext, useProjectionSlot } from "../panel/context";
import { useLocalDraftStore } from "../panel/local-drafts";
import type { PlatformObjectOption } from "../panel/platform-objects";
import type { PanelOptionList } from "@ontomato/contracts/panel-projection";
import type { MemberDataState } from "../panel/direct";
import { jsonValuesEqual } from "../panel/form-values";
import { useMember, useParameterizedMemberData } from "../panel/member";
import { appIcon } from "@ontomato/platform-shell";
import { projectionElement } from "../panel/projection-element";
import FormFieldFrame from "./FormFieldFrame.vue";

/**
 * One reference field of a form in this panel at an absolute pointer, chosen from the catalogue of the type the
 * projection binds: a skill, a model, an MCP service, a class. The value it writes is the owner's own (a skill's whole
 * reference, a model's key), into that form, so the choice is the form's edit — saved, discarded and drafted with it. A
 * value the form already holds that the catalogue no longer offers stays listed, unavailable, with the owner's reason.
 * A row's field follows the row: `path` is its current absolute pointer.
 *
 * A member's choices are its `options` datum (searched and paged with the reader's words) and its `selected` datum (the
 * held values, as choices), read by the instance: through the platform, or this release's resource module in a frame.
 * What the owner says of a partial catalogue (`diagnostics` of the `options` read: a source that did not answer) is shown
 * under the field as the owner wrote it, beside the choices that did come back; a held value the owner no longer offers
 * says so by its own unavailable reason.
 */
const props = withDefaults(defineProps<{
  formSlot: string;
  path: string;
  showDraftIndicator?: boolean;
  fallbackToFirst?: boolean;
  refreshable?: boolean;
}>(), { refreshable: undefined });
const panel = usePanelContext();
const slot = useProjectionSlot();
const member = useMember();
const defaultClassName = projectionElement(slot.projection).id;
const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});
const effectiveShowDraftIndicator = computed(() =>
  props.showDraftIndicator ?? Boolean(rawConfig.value?.showDraftIndicator),
);
const effectiveFallbackToFirst = computed(() =>
  props.fallbackToFirst ?? Boolean(rawConfig.value?.fallbackToFirst),
);

const refreshable = computed(() => props.refreshable ?? rawConfig.value?.refreshable === true);
const refreshIcon = appIcon("refresh-cw");

const localDraftStore = useLocalDraftStore();
const localDraftTick = ref(0);
if (localDraftStore) {
  onBeforeUnmount(localDraftStore.subscribe(() => {
    localDraftTick.value += 1;
  }));
}

function hasChoiceDraft(primaryKey: string): boolean {
  if (!effectiveShowDraftIndicator.value || !primaryKey) return false;
  void localDraftTick.value;
  if (localDraftStore?.hasObject(defaultClassName, primaryKey)) return true;
  return panel.hasLocalDraft({ className: defaultClassName, primaryKey });
}

const field = formFieldAt(panel.instance, props.formSlot, () => props.path);
const options = useParameterizedMemberData("options");
const selected = useParameterizedMemberData("selected");
const { t, te } = useI18n();
const localized = (text: string) => te(text) ? t(text) : text;

function listAt(state: MemberDataState): PanelOptionList | undefined {
  const ready = state.status === "ready" ? state
    : state.status === "loading" || state.status === "error" ? state.previous : undefined;
  return ready?.value as PanelOptionList | undefined;
}

const offered = computed(() => listAt(options.state.value)?.options ?? []);
const notes = computed(() => listAt(options.state.value)?.diagnostics ?? []);
const searching = computed(() => options.state.value.status === "loading");
const busy = computed(() => searching.value || selected.state.value.status === "loading");
const failures = computed(() => [options.state.value, selected.state.value].flatMap((state) =>
  state.status === "error" ? [state] : [],
));
const lastKeyword = ref("");
const multiple = computed(() => field.field.value?.control.kind === "reference" && field.field.value.control.multiple);
const heldValues = computed<RuntimeJsonValue[]>(() => {
  const value = field.value.value;
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
});

function search(keyword = "", allowFallback = true) {
  restoreSelection = allowFallback;
  lastKeyword.value = keyword.trim();
  return options.refresh({ ...(lastKeyword.value && { keyword: lastKeyword.value }), page: { number: 1, size: 50 } });
}
function resolveSelected() {
  return selected.refresh(heldValues.value.length ? { values: heldValues.value } : null);
}
watch(() => JSON.stringify(heldValues.value), () => void resolveSelected(), { immediate: true });
onMounted(() => void search());

let restoreSelection = true;
function refreshChoices() {
  void search(lastKeyword.value, false);
  void resolveSelected();
}
function retryChoices() {
  restoreSelection = false;
  for (const failure of failures.value) failure.retry?.();
}

/** Known choices preserve the selected labels while their own read is in flight or has failed. */
const known = shallowRef(new Map<string, PlatformObjectOption>());
watch([options.state, selected.state], (states) => {
  if (states.some((state) => state.status === "forbidden")) {
    known.value = new Map();
    return;
  }
  const next = new Map(known.value);
  for (const state of states) {
    if (state.status !== "ready") continue;
    for (const option of listAt(state)?.options ?? []) next.set(option.primaryKey, option);
  }
  known.value = next;
}, { flush: "sync" });
const held = computed(() => {
  const state = selected.state.value;
  const list = listAt(state)?.options ?? [];
  const available = state.status === "loading" || state.status === "error" ? [...list, ...known.value.values()] : list;
  return heldValues.value.flatMap((value) => {
    const match = available.find((option) => jsonValuesEqual(option.value, value));
    return match ? [match] : [];
  });
});
const shown = computed(() => {
  const heldKeys = new Set(held.value.map((option) => option.primaryKey));
  return [...held.value, ...offered.value.filter((option) => !heldKeys.has(option.primaryKey))];
});
/**
 * The choice shown: the held ones; for a single reference held empty, the owner's own empty choice when its catalogue
 * names one (following a default, the reader's own permissions), so the field says what its empty value means.
 */
const chosen = computed(() => {
  if (multiple.value) return held.value.map((option) => option.primaryKey);
  if (field.value.value === null) return [...known.value.values()].find((option) => option.value === null)?.primaryKey ?? "";
  return held.value[0]?.primaryKey ?? "";
});

const selectedHasDraft = computed(() => {
  if (multiple.value || typeof chosen.value !== "string" || !chosen.value) return false;
  const opt = known.value.get(chosen.value);
  if (opt?.value === null) return false;
  return hasChoiceDraft(chosen.value);
});

watch(
  [effectiveFallbackToFirst, options.state, busy, failures, offered, chosen, multiple] as const,
  ([enabled, state, loading, errors, list, currentChosen, isMultiple]) => {
    if (!restoreSelection || !enabled || state.status !== "ready" || loading || errors.length || isMultiple || lastKeyword.value || list.length === 0) return;
    const currentKey = typeof currentChosen === "string" ? currentChosen : "";
    const isCurrentValid = Boolean(
      currentKey && list.some((option) => option.primaryKey === currentKey && option.value !== null && option.unavailable === undefined),
    );
    if (isCurrentValid) return;
    const first = list.find((option) => option.value !== null && option.unavailable === undefined);
    if (!first) return;
    field.set(first.value);
  },
  { immediate: true },
);

/**
 * Writes the reader's choice in the owner's shape: the chosen values of a multiple reference (an empty list once it is
 * cleared), the chosen value of a single one, or null once it is cleared — Element Plus clears a single select to
 * undefined, which is no value of any owner.
 */
function choose(keys: string | string[] | undefined) {
  const valueOf = (primaryKey: string) => known.value.get(primaryKey)!.value;
  if (Array.isArray(keys)) field.setFromControl(keys.map(valueOf));
  else field.setFromControl(keys === undefined || keys === "" ? null : valueOf(keys));
}
</script>

<template>
  <form-field-frame
    v-if="field.field.value"
    :field="field.field.value"
    :path="path"
    :error="field.error.value"
    :changed="field.changed.value"
    :disabled="field.disabled.value"
    :value="field.value.value"
    :on-set="field.setFromControl"
    :on-field-blur="field.blurFromControl"
    :field-class="field.changed.value ? 'sdk-reference-picker sdk-reference-picker-changed' : 'sdk-reference-picker'"
  >
    <div class="sdk-reference-picker-controls">
      <el-select
        :model-value="chosen"
        :multiple="multiple"
        :disabled="field.disabled.value"
        :loading="searching"
        :clearable="!field.field.value.required"
        filterable
        remote
        :remote-method="search"
        fit-input-width
        class="sdk-reference-picker-select"
        @update:model-value="choose"
      >
        <template v-if="selectedHasDraft" #prefix>
          <span
            class="sdk-reference-draft-dot sdk-reference-selected-draft-dot"
            :title="t('platform.formDraftIndicator')"
            :aria-label="t('platform.formDraftIndicator')"
          ></span>
        </template>
        <el-option
          v-for="option in shown"
          :key="option.primaryKey"
          :value="option.primaryKey"
          :label="option.value === null ? localized(option.label) : option.label"
          :disabled="option.unavailable !== undefined"
          :title="option.unavailable ? localized(option.unavailable.reason) : option.description"
          :class="{ 'sdk-reference-option-described': option.description }"
        >
          <!-- A choice its owner describes is offered with what it does: a reader judges it by that, not its name. -->
          <slot
            name="option"
            :option="option"
            :selected="Array.isArray(chosen) ? chosen.includes(option.primaryKey) : chosen === option.primaryKey"
            :disabled="option.unavailable !== undefined"
          >
            <span class="sdk-reference-option-label">
              <span
                v-if="option.value !== null && hasChoiceDraft(option.primaryKey)"
                class="sdk-reference-draft-dot"
                :title="t('platform.formDraftIndicator')"
                :aria-label="t('platform.formDraftIndicator')"
              ></span>
              <span>{{ option.value === null ? localized(option.label) : option.label }}</span>
            </span>
            <span v-if="option.description" class="sdk-reference-option-description">{{ option.description }}</span>
          </slot>
        </el-option>
      </el-select>
      <el-button
        v-if="refreshable"
        size="small"
        :icon="refreshIcon"
        :loading="busy"
        :aria-label="t('common.refresh')"
        :title="t('common.refresh')"
        @click="refreshChoices"
      ></el-button>
    </div>
    <template #after>
      <div v-if="failures.length" class="sdk-reference-picker-error" role="alert">
        <span>{{ [...new Set(failures.map((failure) => failure.message || t('platform.dataUnreachable')))].join(' ') }}</span>
        <el-button text size="small" :disabled="busy" @click="retryChoices">{{ t('common.retry') }}</el-button>
      </div>
      <ul v-if="notes.length" class="sdk-reference-picker-notes" role="status">
        <li v-for="note in notes" :key="note">{{ note }}</li>
      </ul>
    </template>
  </form-field-frame>
</template>

<style scoped>
.sdk-reference-picker-controls {
  display: flex;
  width: 100%;
  gap: var(--spacing-xs);
}
.sdk-reference-picker-select {
  flex: 1;
  min-width: 0;
}
.sdk-reference-picker-error {
  color: var(--el-color-danger);
  font-size: var(--text-xs);
}
.sdk-reference-picker-notes {
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: 1.5;
  list-style: none;
  margin: var(--spacing-xs) 0 0;
  padding: 0;
}
.sdk-reference-draft-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-warning);
  flex: 0 0 auto;
}
.sdk-reference-option-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>

<style scoped src="./form-option.css"></style>
