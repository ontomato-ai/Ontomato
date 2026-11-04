<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { modelSelectionView, selectedModelId, type ModelChoice } from "@ontomato/contracts/model-selection";

/** Element Plus rendering of the shared model selection rule, in the platform language. */
const props = defineProps<{
  modelValue: string | null;
  /** The domain's models; null while they are not known. */
  models: readonly ModelChoice[] | null;
  /** Label of the null choice (follow the domain default, or no default). */
  nullLabel: string;
  disabled?: boolean;
  ariaLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const { t } = useI18n();

const view = computed(() =>
  modelSelectionView(props.modelValue, props.models, {
    nullChoice: props.nullLabel,
    unavailable: (id) => t("admin.modelUnavailable", { id }),
  })
);
</script>

<template>
  <div class="model-selection">
    <!-- "" is the null choice; it is declared a real value instead of an empty one. -->
    <el-select
      :model-value="view.value"
      :empty-values="[null, undefined]"
      :disabled="props.disabled || view.disabled"
      :aria-label="props.ariaLabel"
      filterable
      @update:model-value="emit('update:modelValue', selectedModelId($event))"
    >
      <el-option v-for="option in view.options" :key="option.value" v-bind="option" />
    </el-select>
    <p v-if="view.missingId" class="model-selection-missing" role="alert">
      {{ t("admin.modelSelectionMissing", { id: view.missingId }) }}
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
