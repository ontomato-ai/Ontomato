<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RESERVED_MODEL_PROVIDER_IDS, modelApiSchema, type ModelApi } from "@ontomato/contracts/model-settings";
import { modelApiLabels } from "../apis";
import { providerIdAccepted } from "../draft";

/*
 * Add a custom provider: its name, protocol and ID. The ID is the first part of every model reference and cannot be
 * changed once added; it follows the name until it is edited.
 */
const props = defineProps<{ visible: boolean; takenIds: readonly string[] }>();
const emit = defineEmits<{
  "update:visible": [visible: boolean];
  add: [provider: { id: string; name: string; api: ModelApi }];
}>();
const { t } = useI18n();

const form = reactive({ name: "", id: "", idEdited: false, api: "openai-completions" as ModelApi, tried: false });

watch(
  () => props.visible,
  (visible) => {
    if (visible) Object.assign(form, { name: "", id: "", idEdited: false, api: "openai-completions", tried: false });
  }
);

function suggestId(name: string): string {
  return name.trim().toLowerCase().replace(/[\s/]+/g, "-");
}

function setName(name: string) {
  form.name = name;
  if (!form.idEdited) form.id = suggestId(name);
}

function setId(id: string) {
  form.id = id;
  form.idEdited = true;
}

const reserved = RESERVED_MODEL_PROVIDER_IDS.join(", ");
const idProblem = computed(() => {
  const id = form.id.trim();
  if (!id) return t("admin.providerIdRequired");
  if (props.takenIds.includes(id)) return t("admin.providerIdTaken", { id });
  if (!providerIdAccepted(id)) return t("admin.providerIdInvalid", { reserved });
  return null;
});

function submit() {
  form.tried = true;
  if (idProblem.value) return;
  emit("add", { id: form.id.trim(), name: form.name.trim(), api: form.api });
  emit("update:visible", false);
}
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="t('admin.addProvider')"
    width="min(480px, calc(100vw - 32px))"
    class="model-dialog"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-position="top" class="model-form" @submit.prevent="submit">
      <el-form-item :label="t('admin.providerName')">
        <el-input :model-value="form.name" placeholder="OpenAI" @update:model-value="setName" />
      </el-form-item>
      <el-form-item :label="t('admin.providerId')" required :error="form.tried && idProblem ? idProblem : ''">
        <el-input :model-value="form.id" class="mono-input" placeholder="openai" @update:model-value="setId" />
        <p class="field-hint">{{ t("admin.providerIdHint", { reserved }) }}</p>
      </el-form-item>
      <el-form-item :label="t('admin.providerApi')">
        <el-select v-model="form.api" :aria-label="t('admin.providerApi')">
          <el-option v-for="value in modelApiSchema.options" :key="value" :value="value" :label="modelApiLabels[value]" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" @click="submit">{{ t("common.add") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="../models.css"></style>
