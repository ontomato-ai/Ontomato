<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { modelLabel, modelSelectionView, selectedModelId } from "@ontomato/agent-shell-ui/model-selection";

/** Element Plus rendering of the shared model selection rule for an agent: null follows the domain default. */
const props = defineProps<{
  modelValue: string | null;
  /** The domain's models and default; null while they are not known. */
  options: ModelOptions | null;
  disabled?: boolean;
  ariaLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const { t } = useI18n();

const view = computed(() => {
  const current = props.options?.models.find((model) => model.name === props.options?.defaultModelId);
  return modelSelectionView(props.modelValue, props.options?.models ?? null, {
    nullChoice: t("agents.followDomainDefault", { model: current ? modelLabel(current) : t("agents.noDefaultModel") }),
    unavailable: (id) => t("agents.modelUnavailable", { id }),
  });
});
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
      {{ t("agents.modelSelectionMissing", { id: view.missingId }) }}
    </p>
  </div>
</template>

<style scoped>
.model-selection {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
