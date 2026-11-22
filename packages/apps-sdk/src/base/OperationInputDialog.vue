<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElForm, ElFormItem } from "element-plus/es/components/form/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { ElSwitch } from "element-plus/es/components/switch/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  buildOperationInput,
  initialOperationInputDraft,
  type OperationInputField,
} from "./operation-input-schema";

/**
 * Built-in parameter dialog opened by `OperationButton` when the owner's operation descriptor declares
 * editable `inputSchema.properties`. Validates required and numeric/integer fields before emitting the
 * assembled `input` object to the caller.
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    fields: readonly OperationInputField[];
    busy?: boolean;
  }>(),
  {
    title: "",
    busy: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [open: boolean];
  confirm: [input: Record<string, RuntimeJsonValue>];
}>();

const { t } = useI18n();
const draft = reactive<Record<string, unknown>>({});
const fieldErrors = reactive<Record<string, string>>({});

const dialogTitle = computed(() => props.title.trim() || t("platform.operationInputTitle"));

function resetForm() {
  for (const key of Object.keys(draft)) delete draft[key];
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  Object.assign(draft, initialOperationInputDraft(props.fields));
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  },
  { immediate: true },
);

function clearError(name: string) {
  if (Object.hasOwn(fieldErrors, name)) delete fieldErrors[name];
}

function close() {
  if (props.busy) return;
  emit("update:modelValue", false);
}

function submit() {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  const built = buildOperationInput(props.fields, draft);
  if (!built.ok) {
    for (const issue of built.issues) {
      fieldErrors[issue.field.name] = issue.kind === "required"
        ? t("platform.operationInputRequired", { field: issue.field.label })
        : issue.kind === "integer"
          ? t("platform.operationInputInteger", { field: issue.field.label })
          : t("platform.operationInputNumber", { field: issue.field.label });
    }
    return;
  }
  emit("update:modelValue", false);
  emit("confirm", built.value);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="480px"
    append-to-body
    destroy-on-close
    class="sdk-operation-input-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item
        v-for="field in fields"
        :key="field.name"
        :label="field.label"
        :required="field.required"
        :error="fieldErrors[field.name]"
        :data-input-field="field.name"
      >
        <el-select
          v-if="field.kind === 'select'"
          :model-value="(draft[field.name] as string | number | boolean | undefined)"
          :clearable="!field.required"
          class="sdk-operation-input-full"
          @update:model-value="(value) => { draft[field.name] = value; clearError(field.name); }"
        >
          <el-option
            v-for="option in field.options"
            :key="String(option)"
            :label="String(option)"
            :value="(option as string | number | boolean)"
          ></el-option>
        </el-select>
        <el-switch
          v-else-if="field.kind === 'boolean'"
          :model-value="Boolean(draft[field.name])"
          @update:model-value="(value) => { draft[field.name] = Boolean(value); clearError(field.name); }"
        ></el-switch>
        <el-input
          v-else-if="field.kind === 'number' || field.kind === 'integer'"
          type="number"
          :step="field.kind === 'integer' ? '1' : 'any'"
          :min="field.min"
          :max="field.max"
          :model-value="String(draft[field.name] ?? '')"
          @update:model-value="(value) => { draft[field.name] = value; clearError(field.name); }"
        ></el-input>
        <el-input
          v-else-if="field.kind === 'textarea'"
          type="textarea"
          :rows="3"
          :model-value="String(draft[field.name] ?? '')"
          @update:model-value="(value) => { draft[field.name] = value; clearError(field.name); }"
        ></el-input>
        <el-input
          v-else
          :model-value="String(draft[field.name] ?? '')"
          @update:model-value="(value) => { draft[field.name] = value; clearError(field.name); }"
        ></el-input>
        <p v-if="field.description" class="sdk-operation-input-help">{{ field.description }}</p>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="sdk-operation-input-footer">
        <el-button :disabled="busy" @click="close">{{ t("platform.cancel") }}</el-button>
        <el-button type="primary" :loading="busy" @click="submit">{{ t("platform.confirm") }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.sdk-operation-input-full {
  width: 100%;
}
.sdk-operation-input-help {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 1.4;
}
.sdk-operation-input-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
