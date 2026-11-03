<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelOptions } from "@ontomato/contracts/model-settings";

/*
 * Picks one of the domain's models for an agent, or "follow the domain default" (null). A stored ID that is no longer
 * in the list stays selected as it is and is reported, never replaced by the default: the agent fails explicitly until
 * someone chooses again.
 */
const props = defineProps<{
  modelValue: string | null;
  /** The domain's models and default; null while they are not known, when nothing can be chosen or reported missing. */
  options: ModelOptions | null;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const { t } = useI18n();

// The select holds "" for the default: model IDs are never empty, and "" is declared a real value below.
const DEFAULT_CHOICE = "";

function label(model: { name: string; displayName: string }) {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

const defaultLabel = computed(() => {
  const current = props.options?.models.find((model) => model.name === props.options?.defaultModelId);
  return t("agents.followDomainDefault", { model: current ? label(current) : t("agents.noDefaultModel") });
});

const missing = computed(
  () =>
    props.modelValue !== null &&
    props.options !== null &&
    !props.options.models.some((model) => model.name === props.modelValue)
);

function select(value: string) {
  emit("update:modelValue", value === DEFAULT_CHOICE ? null : value);
}
</script>

<template>
  <div class="model-selection">
    <el-select
      :model-value="props.modelValue ?? DEFAULT_CHOICE"
      :empty-values="[null, undefined]"
      :disabled="props.disabled || props.options === null"
      :aria-label="props.ariaLabel"
      filterable
      @update:model-value="select"
    >
      <el-option :value="DEFAULT_CHOICE" :label="defaultLabel" />
      <el-option
        v-for="model in props.options?.models ?? []"
        :key="model.name"
        :value="model.name"
        :label="label(model)"
      />
      <el-option
        v-if="missing"
        :value="props.modelValue!"
        :label="t('agents.modelUnavailable', { id: props.modelValue })"
        disabled
      />
    </el-select>
    <p v-if="missing" class="model-selection-missing" role="alert">
      {{ t("agents.modelSelectionMissing", { id: props.modelValue }) }}
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
