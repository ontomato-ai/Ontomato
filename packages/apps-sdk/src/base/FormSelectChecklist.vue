<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElInput } from "element-plus/es/components/input/index";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";
import FormSelectTree from "./FormSelectTree.vue";

const props = defineProps<{
  options: readonly PanelFormOption[];
  grouped: boolean;
  isSelected: (option: PanelFormOption) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggle: [options: PanelFormOption[], checked: boolean] }>();
const { t, te } = useI18n();
const search = ref("");

function label(key: string, fallback: string, params?: Record<string, unknown>): string {
  if (te(key)) return params ? t(key, params) : t(key);
  if (!params) return fallback;
  return fallback.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
}

const hasQuery = computed(() => Boolean(search.value.trim()));
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (props.grouped || !query) return props.options;
  return props.options.filter(option => [
    option.label, option.description, option.badge,
    typeof option.value === "object" ? JSON.stringify(option.value) : String(option.value),
  ].some(text => text?.toLowerCase().includes(query)));
});
const allAvailable = computed(() => props.options.filter(option => !option.disabled));
const available = computed(() => visible.value.filter(option => !option.disabled));
const selectedCount = computed(() => props.options.filter(props.isSelected).length);
</script>

<template>
  <div class="sdk-form-select-list">
    <template v-if="!grouped">
      <div class="sdk-form-select-list-toolbar">
        <el-input
          v-model="search"
          :placeholder="t('platform.formSearchOptions')"
          :aria-label="t('platform.formSearchOptions')"
          clearable
          class="sdk-form-select-list-search"
        ></el-input>
        <div class="sdk-form-select-list-actions">
          <template v-if="hasQuery">
            <el-button
              size="small"
              :disabled="disabled || !available.length || available.every(isSelected)"
              @click="emit('toggle', available, true)"
            >{{ t("platform.formSelectFiltered") }}</el-button>
            <el-button
              size="small"
              :disabled="disabled || !available.some(isSelected)"
              @click="emit('toggle', available, false)"
            >{{ t("platform.formClearFiltered") }}</el-button>
          </template>
          <el-button
            size="small"
            :disabled="disabled || !allAvailable.length || allAvailable.every(isSelected)"
            @click="emit('toggle', allAvailable, true)"
          >{{ label("platform.formSelectAll", "Select all") }}</el-button>
          <el-button
            size="small"
            :disabled="disabled || !allAvailable.some(isSelected)"
            @click="emit('toggle', allAvailable, false)"
          >{{ label("platform.formClearAll", "Clear all") }}</el-button>
          <span class="sdk-form-select-list-count">
            {{ label("platform.formSelectionCount", `${selectedCount} / ${options.length} selected`, { selected: selectedCount, total: options.length }) }}
          </span>
        </div>
      </div>
    </template>
    <form-select-tree
      :options="visible"
      :depth="grouped ? 0 : undefined"
      :is-selected="isSelected"
      :disabled="disabled"
      @toggle="(options, checked) => emit('toggle', options, checked)"
    ></form-select-tree>
  </div>
</template>

<style scoped>
.sdk-form-select-list {
  display: grid;
  gap: var(--spacing-sm);
}
.sdk-form-select-list-toolbar {
  display: grid;
  gap: var(--spacing-xs);
}
.sdk-form-select-list-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
}
.sdk-form-select-list-actions > button {
  margin: 0;
}
.sdk-form-select-list-count {
  margin-inline-start: auto;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
