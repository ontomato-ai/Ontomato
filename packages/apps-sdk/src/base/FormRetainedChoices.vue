<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";

defineProps<{ entries: readonly { label: string; note: string }[]; disabled: boolean }>();
const emit = defineEmits<{ remove: [index: number] }>();
const { t } = useI18n();
</script>

<template>
  <ul v-if="entries.length" class="sdk-form-retained-choices">
    <li v-for="(entry, index) in entries" :key="index">
      <span>{{ entry.label }} · {{ entry.note }}</span>
      <el-button
        v-if="!disabled"
        text
        size="small"
        :aria-label="t('platform.formRemoveChoice', { label: entry.label })"
        @click="emit('remove', index)"
      >×</el-button>
    </li>
  </ul>
</template>

<style scoped>
.sdk-form-retained-choices {
  display: grid;
  gap: var(--spacing-xs);
  margin: var(--spacing-xs) 0 0;
  padding: 0;
  list-style: none;
}
.sdk-form-retained-choices li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding-inline: var(--spacing-sm);
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-quaternary);
  overflow-wrap: anywhere;
}
</style>
