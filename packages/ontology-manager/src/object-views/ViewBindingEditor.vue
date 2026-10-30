<script setup lang="ts">
import type { ViewBinding } from "@ontomato/contracts/object-views";
import { ElInput, ElSelect, ElOption } from "element-plus";
import { useOntologyText } from "../context";
const { ot } = useOntologyText();
defineProps<{ modelValue: ViewBinding }>();
const emit = defineEmits<{ "update:modelValue": [value: ViewBinding] }>();
function source(value: ViewBinding["source"]) {
  emit("update:modelValue", value === "literal" ? { source: value, value: "" } : { source: value, path: "" });
}
</script>
<template>
  <div class="binding-editor">
    <el-select :model-value="modelValue.source" @update:model-value="source">
      <el-option :label="ot('ovObjectProperty')" value="object" /><el-option :label="ot('ovVariable')" value="variable" /><el-option :label="ot('ovFixedValue')" value="literal" />
    </el-select>
    <el-input v-if="modelValue.source === 'literal'" :model-value="String(modelValue.value ?? '')" @update:model-value="emit('update:modelValue', { source: 'literal', value: $event })" />
    <el-input v-else :model-value="modelValue.path" :placeholder="ot('ovPropertyPath')" @update:model-value="emit('update:modelValue', { source: modelValue.source, path: $event } as ViewBinding)" />
  </div>
</template>
<style scoped>
.binding-editor { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; }
.binding-editor > .el-select, .binding-editor > .el-input { width: 100%; min-width: 0; }
</style>
