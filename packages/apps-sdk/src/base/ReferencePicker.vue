<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElFormItem } from "element-plus/es/components/form/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { useFormField, useProjectionSlot } from "../panel/context";
import { adapterPart, type PlatformObjectOption } from "../panel/platform-objects";

/**
 * One reference field of a form in this panel, chosen from the catalogue of the type the projection binds: a skill, a
 * model, an MCP service, a user. The value it writes is the owner's own (a skill's whole reference, a model's key), into
 * the form its slot's field port names, so the choice is that form's edit — saved, discarded and drafted with it. A
 * value the form already holds that the catalogue no longer offers stays listed, unavailable, with the owner's reason.
 */
const slot = useProjectionSlot();
const field = useFormField();
const options = adapterPart(slot.projection.binding.id, "options");
const { t, te } = useI18n();
const localized = (text: string) => te(text) ? t(text) : text;

/** Every choice seen so far, by its identity: the catalogue's and the held values' own. */
const known = shallowRef(new Map<string, PlatformObjectOption>());
const offered = shallowRef<readonly PlatformObjectOption[]>([]);
const held = shallowRef<readonly PlatformObjectOption[]>([]);
const searching = ref(false);
const failure = shallowRef<Error | null>(null);
const multiple = computed(() => field.field.value?.control.kind === "reference" && field.field.value.control.multiple);

function remember(list: readonly PlatformObjectOption[]) {
  known.value = new Map([...known.value, ...list.map((option) => [option.primaryKey, option] as const)]);
}

function search(keyword = "") {
  searching.value = true;
  void options.list({ keyword, page: { number: 1, size: 50 } }).then(({ options: listed }) => {
    remember(listed);
    offered.value = listed;
    searching.value = false;
  }, (reason: unknown) => {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
    searching.value = false;
  });
}

const heldValues = computed<RuntimeJsonValue[]>(() => {
  const value = field.value.value;
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
});
watch(() => JSON.stringify(heldValues.value), () => {
  if (!heldValues.value.length) {
    held.value = [];
    return;
  }
  void options.resolve(heldValues.value).then((resolved) => {
    remember(resolved);
    held.value = resolved;
  }, (reason: unknown) => {
    failure.value = reason instanceof Error ? reason : new Error(String(reason));
  });
}, { immediate: true });
onMounted(() => search());

/** The choices shown: the held ones first (an unavailable one stays visible), then the catalogue's others. */
const shown = computed(() => {
  const heldKeys = new Set(held.value.map((option) => option.primaryKey));
  return [...held.value, ...offered.value.filter((option) => !heldKeys.has(option.primaryKey))];
});
const chosen = computed(() => (multiple.value ? held.value.map((option) => option.primaryKey) : held.value[0]?.primaryKey ?? ""));

/**
 * Writes the reader's choice in the owner's shape: the chosen values of a multiple reference (an empty list once it is
 * cleared), the chosen value of a single one, or null once it is cleared — Element Plus clears a single select to
 * undefined, which is no value of any owner.
 */
function choose(keys: string | string[] | undefined) {
  const valueOf = (primaryKey: string) => known.value.get(primaryKey)!.value;
  if (Array.isArray(keys)) field.set(keys.map(valueOf));
  else field.set(keys === undefined || keys === "" ? null : valueOf(keys));
}
</script>

<template>
  <el-form-item
    v-if="field.field.value"
    class="sdk-reference-picker"
    :class="{ 'sdk-reference-picker-changed': field.changed.value }"
    :label="field.field.value.label"
    :required="field.field.value.required"
    :error="field.error.value ?? failure?.message"
    :data-field="field.field.value.path"
  >
    <el-select
      :model-value="chosen"
      :multiple="multiple"
      :disabled="field.disabled.value"
      :loading="searching"
      :clearable="!field.field.value.required"
      filterable
      remote
      :remote-method="search"
      class="sdk-reference-picker-select"
      @update:model-value="choose"
    >
      <el-option
        v-for="option in shown"
        :key="option.primaryKey"
        :value="option.primaryKey"
        :label="option.value === null ? localized(option.label) : option.label"
        :disabled="option.unavailable !== undefined"
        :title="option.unavailable ? localized(option.unavailable.reason) : option.description"
      ></el-option>
    </el-select>
    <p v-if="field.field.value.readOnly && field.field.value.readOnlyReason" class="sdk-reference-picker-help">
      {{ field.field.value.readOnlyReason }}
    </p>
    <p v-else-if="field.field.value.help" class="sdk-reference-picker-help">{{ field.field.value.help }}</p>
  </el-form-item>
</template>

<style scoped>
.sdk-reference-picker {
  display: block;
}
.sdk-reference-picker-select {
  width: 100%;
}
.sdk-reference-picker-changed :deep(.el-form-item__label) {
  color: var(--el-color-primary);
}
.sdk-reference-picker-help {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: 4px 0 0;
}
</style>
