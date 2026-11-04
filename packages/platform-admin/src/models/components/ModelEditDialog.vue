<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelSaveCheck } from "../draft";
import {
  PI_CHAT_MODEL_DEFAULTS,
  modelEntrySchema,
  supportsEmbeddings,
  type ModelApi,
  type ModelEntry,
} from "@ontomato/contracts/model-settings";

/*
 * Add or edit one model of a provider. The type and, for an embedding model, the dimensions are always the user's
 * choice: a model from the provider's list arrives with its ID (and name) only. Fields a chat model leaves empty
 * take pi's defaults; fields the read model already carried are written back even when they equal the default.
 */
const props = defineProps<{
  visible: boolean;
  api: ModelApi;
  /** The model being edited, or the start of a new one (ID and name from the provider's list, or nothing). */
  model: Partial<ModelEntry> | null;
  /** True when editing a model already in the draft (renaming it moves its references). */
  existing: boolean;
  /** IDs of the provider's other models. */
  takenIds: readonly string[];
  /** Asks what the change affects (a renamed ID, unset defaults); the dialog closes only when it resolves true. */
  beforeSave: ModelSaveCheck;
}>();
const emit = defineEmits<{ "update:visible": [visible: boolean]; save: [model: ModelEntry] }>();
const { t } = useI18n();

const PI_CONTEXT_WINDOW = PI_CHAT_MODEL_DEFAULTS.contextWindow;
const PI_MAX_TOKENS = PI_CHAT_MODEL_DEFAULTS.maxTokens;

const embeddingAllowed = computed(() => supportsEmbeddings(props.api));

const form = reactive({
  type: null as "chat" | "embedding" | null,
  id: "",
  name: "",
  contextWindow: null as number | null,
  maxTokens: null as number | null,
  reasoning: false,
  image: false,
  sampling: "",
  dimensions: null as number | null,
});
const error = ref("");

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    const model = props.model ?? {};
    Object.assign(form, {
      type: model.type ?? (embeddingAllowed.value ? null : "chat"),
      id: model.id ?? "",
      name: model.name ?? "",
      contextWindow: model.contextWindow ?? null,
      maxTokens: model.maxTokens ?? null,
      reasoning: model.reasoning ?? false,
      image: model.input?.includes("image") ?? false,
      sampling: model.samplingParams ? JSON.stringify(model.samplingParams, null, 2) : "",
      dimensions: model.type === "embedding" ? model.dimensions ?? null : null,
    });
    error.value = "";
  },
  { immediate: true }
);


/** A field is written when it differs from pi's default or the read model already had it. */
function chatField(key: keyof ModelEntry, value: unknown, fallback: unknown): Record<string, unknown> {
  const original = props.model ?? {};
  if (value === null) return {};
  if (JSON.stringify(value) === JSON.stringify(fallback) && !(key in original)) return {};
  return { [key]: value };
}

function build(): ModelEntry | string {
  const id = form.id.trim();
  if (!id) return t("admin.modelIdRequired");
  if (props.takenIds.includes(id)) return t("admin.modelIdTaken", { id });
  const name = form.name.trim();
  const base = { id, ...(name ? { name } : {}) };
  let entry: unknown;
  if (form.type === "embedding") {
    if (form.dimensions === null) return t("admin.dimensionsRequired");
    entry = { ...base, type: "embedding", dimensions: form.dimensions };
  } else {
    let samplingParams: unknown;
    if (form.sampling.trim()) {
      try {
        samplingParams = JSON.parse(form.sampling);
      } catch {
        return t("admin.samplingParamsInvalid");
      }
      if (typeof samplingParams !== "object" || samplingParams === null || Array.isArray(samplingParams)) {
        return t("admin.samplingParamsInvalid");
      }
    }
    entry = {
      ...base,
      type: "chat",
      ...chatField("reasoning", form.reasoning, false),
      ...chatField("input", form.image ? ["text", "image"] : ["text"], ["text"]),
      ...chatField("contextWindow", form.contextWindow, PI_CONTEXT_WINDOW),
      ...chatField("maxTokens", form.maxTokens, PI_MAX_TOKENS),
      ...(samplingParams === undefined ? {} : { samplingParams }),
    };
  }
  const parsed = modelEntrySchema.safeParse(entry);
  return parsed.success ? parsed.data : t("admin.modelInvalid", { detail: parsed.error.issues[0]?.message ?? "" });
}

async function submit() {
  const result = build();
  if (typeof result === "string") {
    error.value = result;
    return;
  }
  if (!(await props.beforeSave(result))) return;
  emit("save", result);
  emit("update:visible", false);
}
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="props.existing ? t('admin.editModel') : t('admin.addModel')"
    width="min(640px, calc(100vw - 32px))"
    class="model-dialog"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-position="top" class="model-form" @submit.prevent="submit">
      <el-form-item :label="t('admin.modelType')" required>
        <el-radio-group v-model="form.type">
          <el-radio-button value="chat">{{ t("admin.modelTypes.chat") }}</el-radio-button>
          <el-radio-button value="embedding" :disabled="!embeddingAllowed">
            {{ t("admin.modelTypes.embedding") }}
          </el-radio-button>
        </el-radio-group>
        <p v-if="!embeddingAllowed" class="field-hint">{{ t("admin.embeddingNeedsOpenAi") }}</p>
      </el-form-item>
      <div class="form-row">
        <el-form-item :label="t('admin.modelId')" required>
          <el-input v-model="form.id" class="mono-input" placeholder="gpt-4o" />
        </el-form-item>
        <el-form-item :label="t('admin.displayName')">
          <el-input v-model="form.name" :placeholder="form.id || t('admin.displayNameDefault')" />
        </el-form-item>
      </div>
      <template v-if="form.type === 'chat'">
        <div class="form-row">
          <el-form-item :label="t('admin.contextWindow')">
            <el-input-number
              v-model="form.contextWindow"
              :min="1"
              :precision="0"
              :placeholder="String(PI_CONTEXT_WINDOW)"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item :label="t('admin.maxOutputTokens')">
            <el-input-number
              v-model="form.maxTokens"
              :min="1"
              :precision="0"
              :placeholder="String(PI_MAX_TOKENS)"
              controls-position="right"
            />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item :label="t('admin.reasoning')">
            <el-switch v-model="form.reasoning" :aria-label="t('admin.reasoning')" />
          </el-form-item>
          <el-form-item :label="t('admin.imageInput')">
            <el-switch v-model="form.image" :aria-label="t('admin.imageInput')" />
          </el-form-item>
        </div>
        <el-form-item :label="t('admin.samplingParams')">
          <el-input
            v-model="form.sampling"
            type="textarea"
            class="mono-input"
            :autosize="{ minRows: 3, maxRows: 10 }"
            placeholder='{"temperature": 0.7, "top_p": 0.9}'
          />
          <p class="field-hint">{{ t("admin.samplingParamsHint") }}</p>
        </el-form-item>
      </template>
      <el-form-item v-else-if="form.type === 'embedding'" :label="t('admin.embeddingDimensions')" required>
        <el-input-number v-model="form.dimensions" :min="1" :precision="0" controls-position="right" />
        <p class="field-hint">{{ t("admin.embeddingDimensionsHint") }}</p>
      </el-form-item>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :disabled="form.type === null" @click="submit">{{ t("common.confirm") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped src="../models.css"></style>
