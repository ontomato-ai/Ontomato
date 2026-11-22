<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElFormItem } from "element-plus/es/components/form/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { formFieldAt, usePanelContext } from "../panel/context";
import type { PlatformObjectOption, PlatformObjectOptions } from "../panel/platform-objects";
import type { PanelOptionList } from "@ontomato/contracts/panel-projection";
import { MemberDataUnavailable } from "../panel/member-forms";
import { useMemberRead } from "../panel/member";

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
const props = defineProps<{ formSlot: string; path: string }>();
const field = formFieldAt(usePanelContext().instance, props.formSlot, () => props.path);
const options: PlatformObjectOptions = memberOptions();

function memberOptions(): PlatformObjectOptions {
  const readOptions = useMemberRead("options");
  const readSelected = useMemberRead("selected");
  const answered = async (reading: ReturnType<typeof readOptions>) => {
    const result = await reading;
    if (result.status !== "ready") throw new MemberDataUnavailable(result);
    return result.value as PanelOptionList;
  };
  return {
    list: ({ keyword, page }) => answered(readOptions({ ...(keyword ? { keyword } : {}), ...(page ? { page } : {}) })),
    resolve: async (values) => (await answered(readSelected({ values: [...values] }))).options,
  };
}
const { t, te } = useI18n();
const localized = (text: string) => te(text) ? t(text) : text;

/** Every choice seen so far, by its identity: the catalogue's and the held values' own. */
const known = shallowRef(new Map<string, PlatformObjectOption>());
const offered = shallowRef<readonly PlatformObjectOption[]>([]);
const held = shallowRef<readonly PlatformObjectOption[]>([]);
const searching = ref(false);
const failure = shallowRef<Error | null>(null);
/** The owner's notes on the catalogue's latest answer. */
const notes = shallowRef<readonly string[]>([]);
const multiple = computed(() => field.field.value?.control.kind === "reference" && field.field.value.control.multiple);

function remember(list: readonly PlatformObjectOption[]) {
  known.value = new Map([...known.value, ...list.map((option) => [option.primaryKey, option] as const)]);
}

function search(keyword = "") {
  searching.value = true;
  void options.list({ keyword, page: { number: 1, size: 50 } }).then(({ options: listed, diagnostics }) => {
    remember(listed);
    offered.value = listed;
    notes.value = diagnostics ?? [];
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
/**
 * The choice shown: the held ones; for a single reference held empty, the owner's own empty choice when its catalogue
 * names one (following a default, the reader's own permissions), so the field says what its empty value means.
 */
const chosen = computed(() => {
  if (multiple.value) return held.value.map((option) => option.primaryKey);
  if (field.value.value === null) return [...known.value.values()].find((option) => option.value === null)?.primaryKey ?? "";
  return held.value[0]?.primaryKey ?? "";
});

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
    :data-field="path"
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
    <ul v-if="notes.length" class="sdk-reference-picker-notes" role="status">
      <li v-for="note in notes" :key="note">{{ note }}</li>
    </ul>
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
  color: var(--brand-link);
}
.sdk-reference-picker-notes {
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  line-height: 1.5;
  list-style: none;
  margin: var(--spacing-xs) 0 0;
  padding: 0;
}
.sdk-reference-picker-help {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: var(--spacing-xs) 0 0;
}
</style>
