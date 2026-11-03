<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { modelLabel } from "../types";

/*
 * Picks one of the domain's models, or the null choice the caller names (follow the domain default, or no default).
 * A stored ID that is no longer in the list stays selected as it is and is reported, never replaced by the null choice:
 * the reference fails explicitly until someone chooses again.
 */
const props = defineProps<{
  modelValue: string | null;
  /** The domain's models; null while they are not known, when nothing can be chosen or reported missing. */
  models: readonly { name: string; displayName: string }[] | null;
  /** Label of the null choice. */
  nullLabel: string;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const { t } = useI18n();

// The select holds "" for the null choice: model IDs are never empty, and "" is declared a real value below.
const NULL_CHOICE = "";

const missing = computed(
  () => props.modelValue !== null && props.models !== null && !props.models.some((model) => model.name === props.modelValue)
);

function select(value: string) {
  emit("update:modelValue", value === NULL_CHOICE ? null : value);
}
</script>

<template>
  <div class="model-selection">
    <el-select
      :model-value="props.modelValue ?? NULL_CHOICE"
      :empty-values="[null, undefined]"
      :disabled="props.disabled || props.models === null"
      :aria-label="props.ariaLabel"
      filterable
      @update:model-value="select"
    >
      <el-option :value="NULL_CHOICE" :label="props.nullLabel" />
      <el-option v-for="model in props.models ?? []" :key="model.name" :value="model.name" :label="modelLabel(model)" />
      <el-option
        v-if="missing"
        :value="props.modelValue!"
        :label="t('admin.modelUnavailable', { id: props.modelValue })"
        disabled
      />
    </el-select>
    <p v-if="missing" class="model-selection-missing" role="alert">
      {{ t("admin.modelSelectionMissing", { id: props.modelValue }) }}
    </p>
  </div>
</template>

<style scoped>
.model-selection {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.model-selection .el-select {
  width: 100%;
}

.model-selection-missing {
  margin: 0;
  color: var(--el-color-warning);
  font-size: var(--text-xs);
  line-height: 1.5;
}
</style>
