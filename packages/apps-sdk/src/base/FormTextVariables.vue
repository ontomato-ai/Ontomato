<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { curatedIcon } from "@ontomato/platform-shell/icons";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";

type TextControl = Extract<PanelFormField["control"], { kind: "text" }>;

const props = withDefaults(
  defineProps<{
    groups: NonNullable<TextControl["variables"]>;
    disabled: boolean;
    collapsible?: boolean;
    presentation?: "chips" | "rows";
  }>(),
  {
    collapsible: false,
    presentation: "chips",
  },
);
const emit = defineEmits<{ insert: [value: string] }>();
const { t, te } = useI18n();
const chevronIcon = curatedIcon("chevron-right");

const expanded = ref(!props.collapsible);
watch(
  () => props.collapsible,
  (next) => {
    expanded.value = !next;
  },
);

const totalCount = computed(() => props.groups.reduce((sum, group) => sum + group.items.length, 0));
const toggleLabel = computed(() => (
  te("platform.formVariablesToggle")
    ? t("platform.formVariablesToggle", { count: totalCount.value })
    : `Available parameters (${totalCount.value})`
));
const isRows = computed(() => props.presentation === "rows");
</script>

<template>
  <div class="sdk-form-variables" :class="{ 'is-collapsible': collapsible, 'is-rows': isRows }">
    <button
      v-if="collapsible"
      type="button"
      class="sdk-form-variables-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <component
        :is="chevronIcon"
        :size="14"
        class="sdk-form-variables-chevron"
        :class="{ 'is-open': expanded }"
        aria-hidden="true"
      />
      <span>{{ toggleLabel }}</span>
    </button>
    <div v-if="expanded" class="sdk-form-variables-body">
      <fieldset v-for="(group, index) in groups" :key="index" :disabled="disabled">
        <legend>{{ group.label }}</legend>
        <div v-if="group.items.length && isRows" class="sdk-form-variable-rows">
          <button
            v-for="(item, at) in group.items"
            :key="at"
            type="button"
            class="sdk-form-variable-row"
            :disabled="disabled"
            @mousedown.prevent
            @click="emit('insert', item.value)"
          >
            <span class="sdk-form-variable-row-label">{{ item.label }}</span>
            <span v-if="item.badge" class="sdk-form-variable-badge">{{ item.badge }}</span>
            <span v-else class="sdk-form-variable-badge-empty" aria-hidden="true"></span>
            <code class="sdk-form-variable-row-code">{{ item.value }}</code>
          </button>
        </div>
        <div v-else-if="group.items.length" class="sdk-form-variable-items">
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
        <small v-else-if="group.emptyHint" class="sdk-form-variable-empty">{{ group.emptyHint }}</small>
      </fieldset>
    </div>
  </div>
</template>

<style scoped>
.sdk-form-variables {
  display: grid;
  width: 100%;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
}
.sdk-form-variables-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 4px var(--spacing-xs);
  border: 0;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  cursor: pointer;
  justify-self: start;
  border-radius: var(--radius-xs);
}
.sdk-form-variables-toggle:hover {
  color: var(--el-color-primary);
  background: var(--el-fill-color-light);
}
.sdk-form-variables-chevron {
  transition: transform 0.15s ease;
}
.sdk-form-variables-chevron.is-open {
  transform: rotate(90deg);
}
.sdk-form-variables-body {
  display: grid;
  gap: var(--spacing-xs);
}
.sdk-form-variables fieldset {
  min-width: 0;
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-sm);
}
.sdk-form-variables fieldset legend {
  padding-inline: 4px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--el-text-color-secondary);
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
.sdk-form-variable-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sdk-form-variable-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto auto;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: 5px var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.sdk-form-variable-row:hover:not(:disabled) {
  background: var(--el-fill-color-light);
}
.sdk-form-variable-row:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.sdk-form-variable-row-label {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
}
.sdk-form-variable-row-code {
  font-family: var(--font-mono);
  color: var(--el-color-primary);
  white-space: nowrap;
}
.sdk-form-variable-badge {
  padding: 1px 6px;
  background: var(--ui-fill-secondary);
  color: var(--el-text-color-secondary);
  border-radius: var(--radius-xs);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.sdk-form-variable-items .sdk-form-variable-badge {
  margin-inline: var(--spacing-xs);
}
.sdk-form-variable-items code {
  margin-inline-start: var(--spacing-xs);
  font-family: var(--font-mono);
}
.sdk-form-variable-empty {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
</style>
