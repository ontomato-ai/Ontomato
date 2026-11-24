<script setup lang="ts">
import { ElButton } from "element-plus/es/components/button/index";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";

type TextControl = Extract<PanelFormField["control"], { kind: "text" }>;
defineProps<{ groups: NonNullable<TextControl["variables"]>; disabled: boolean }>();
const emit = defineEmits<{ insert: [value: string] }>();
</script>

<template>
  <div class="sdk-form-variables">
    <fieldset v-for="(group, index) in groups" :key="index" :disabled="disabled">
      <legend>{{ group.label }}</legend>
      <div v-if="group.items.length" class="sdk-form-variable-items">
        <el-button
          v-for="(item, at) in group.items"
          :key="at"
          size="small"
          :disabled="disabled"
          @mousedown.prevent
          @click="emit('insert', item.value)"
        >
          {{ item.label }}
          <small v-if="item.badge" class="sdk-form-variable-badge">{{ item.badge }}</small>
          <code>{{ item.value }}</code>
        </el-button>
      </div>
      <small v-else-if="group.emptyHint">{{ group.emptyHint }}</small>
    </fieldset>
  </div>
</template>

<style scoped>
.sdk-form-variables {
  display: grid;
  width: 100%;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
}
.sdk-form-variables fieldset {
  min-width: 0;
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-sm);
}
.sdk-form-variable-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-form-variable-items > button {
  margin: 0;
  max-width: 100%;
  height: auto;
  white-space: normal;
  overflow-wrap: anywhere;
}
.sdk-form-variable-badge {
  margin-inline: var(--spacing-xs);
  padding-inline: var(--spacing-xs);
  background: var(--ui-fill-secondary);
  border-radius: var(--radius-xs);
}
.sdk-form-variable-items code {
  margin-inline-start: var(--spacing-xs);
  font-family: var(--font-mono);
}
</style>
