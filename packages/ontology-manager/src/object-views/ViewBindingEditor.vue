<script setup lang="ts">
import type { ViewBinding } from "@ontomato/contracts/object-views";
import { ElInput, ElSelect, ElOption } from "element-plus";
import { useOntologyText } from "../context";
const { ot } = useOntologyText();
defineProps<{ modelValue: ViewBinding; variables?: string[]; defaultVariables?: string[]; properties?: Array<{ name: string; showName: string }> }>();
const emit = defineEmits<{ "update:modelValue": [value: ViewBinding] }>();
function source(value: ViewBinding["source"]) {
  emit("update:modelValue", value === "literal" ? { source: value, value: "" } : { source: value, path: "" });
}
</script>
<template>
  <div class="binding-editor">
    <span class="binding-field-label">{{ ot('ovBindingSource') }}</span>
    <el-select :model-value="modelValue.source" :aria-label="ot('ovBindingSource')" @update:model-value="source">
      <el-option :label="ot('ovObjectProperty')" value="object" /><el-option :label="ot('ovVariable')" value="variable" /><el-option :label="ot('ovFixedValue')" value="literal" />
    </el-select>
    <template v-if="modelValue.source === 'literal'">
      <span class="binding-field-label">{{ ot('ovFixedValue') }}</span>
      <el-input :model-value="String(modelValue.value ?? '')" :aria-label="ot('ovFixedValue')" @update:model-value="emit('update:modelValue', { source: 'literal', value: $event })" />
    </template>
    <template v-else-if="modelValue.source === 'variable'">
      <span class="binding-field-label">{{ ot('ovVariable') }}</span>
      <el-select :model-value="modelValue.path" filterable allow-create default-first-option :placeholder="ot('ovVariablePath')" :aria-label="ot('ovVariablePath')" @update:model-value="emit('update:modelValue', { source: 'variable', path: $event })">
        <el-option v-for="name in variables" :key="name" :label="name" :value="name">
          <span>{{ name }}</span><small class="variable-origin">{{ ot(defaultVariables?.includes(name) ? 'ovDefaultValue' : 'ovInteractionVariable') }}</small>
        </el-option>
      </el-select>
      <p class="binding-hint">{{ ot('ovVariablePathHint') }}</p>
    </template>
    <template v-else>
      <span class="binding-field-label">{{ ot('ovObjectProperty') }}</span>
      <el-select :model-value="modelValue.path" filterable allow-create default-first-option :placeholder="ot('ovPropertyPath')" :aria-label="ot('ovPropertyPath')" @update:model-value="emit('update:modelValue', { source: 'object', path: $event })">
        <el-option v-for="property in properties" :key="property.name" :label="property.showName || property.name" :value="property.name" />
      </el-select>
      <p v-if="!modelValue.path" class="binding-hint">{{ ot('ovWholeObjectHint') }}</p>
    </template>
  </div>
</template>
<style scoped>
.binding-editor { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
.binding-editor > .el-select + .binding-field-label, .binding-editor > .el-input + .binding-field-label { margin-top: 6px; }
.binding-editor > .el-select, .binding-editor > .el-input { width: 100%; min-width: 0; }
.binding-hint { margin: 0; color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 20px; overflow-wrap: anywhere; }
.binding-field-label { font-size: var(--text-sm); line-height: 20px; color: var(--el-text-color-regular); }
.variable-origin { margin-inline-start: 12px; color: var(--el-text-color-secondary); font-size: var(--text-xs); }
</style>
