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
const { t } = useI18n();
const search = ref("");
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (props.grouped || !query) return props.options;
  return props.options.filter(option => [
    option.label, option.description, option.badge,
    typeof option.value === "object" ? JSON.stringify(option.value) : String(option.value),
  ].some(text => text?.toLowerCase().includes(query)));
});
const available = computed(() => visible.value.filter(option => !option.disabled));
</script>

<template>
  <div class="sdk-form-select-list">
    <template v-if="!grouped">
      <el-input
        v-model="search"
        :placeholder="t('platform.formSearchOptions')"
        :aria-label="t('platform.formSearchOptions')"
        clearable
      ></el-input>
      <div>
        <el-button
          size="small"
          :disabled="disabled || available.every(isSelected)"
          @click="emit('toggle', available, true)"
        >{{ t("platform.formSelectFiltered") }}</el-button>
        <el-button
          size="small"
          :disabled="disabled || !available.some(isSelected)"
          @click="emit('toggle', available, false)"
        >{{ t("platform.formClearFiltered") }}</el-button>
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
</style>
