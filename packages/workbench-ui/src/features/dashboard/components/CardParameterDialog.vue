<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FormFields } from "@ontomato/foundation-ui/form";
import { formFieldKey } from "@ontomato/contracts/form-fields";
import type { DashboardMetricReference, DashboardParameterForm } from "@ontomato/contracts/dashboard";
import { ApiRequestError } from "../../../utils/api";
import { fetchCardParameterForm, saveCardParameters } from "../api";
import { cardError, cardErrorHeadline, type CardError } from "./utils/metricCard";

/**
 * Edits one card's parameters through the metric's own form: the fields, values, read-only keys and validation are
 * the metric's; only the keys the reader edited are sent, and the metric interprets the text.
 */
const props = defineProps<{ dashboardId: string; card: { id: string; name: string } | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [cardId: string, query: DashboardMetricReference] }>();
const { t } = useI18n();

const form = ref<DashboardParameterForm | null>(null);
const draft = ref<Record<string, string>>({});
const edited = ref(new Set<string>());
const fieldErrors = ref<Record<string, string>>({});
const failure = ref<CardError | null>(null);
const loading = ref(false);
const saving = ref(false);
const failureHeadline = computed(() => (failure.value ? cardErrorHeadline(failure.value, t) : null));

watch(visible, async (open) => {
  if (!open || !props.card) return;
  form.value = null;
  draft.value = {};
  edited.value = new Set();
  fieldErrors.value = {};
  failure.value = null;
  loading.value = true;
  try {
    form.value = await fetchCardParameterForm(props.dashboardId, props.card.id);
    draft.value = { ...form.value.values };
  } catch (error) {
    failure.value = cardError(error);
  } finally {
    loading.value = false;
  }
});

function edit(key: string, value: string) {
  draft.value = { ...draft.value, [key]: value };
  edited.value = new Set(edited.value).add(key);
  const { [key]: _, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
}

async function save() {
  const card = props.card!;
  saving.value = true;
  failure.value = null;
  try {
    const saved = await saveCardParameters({
      dashboardId: props.dashboardId,
      cardId: card.id,
      revision: form.value!.revision,
      values: Object.fromEntries([...edited.value].map((key) => [key, draft.value[key]!])),
    });
    emit("saved", card.id, saved.query);
    visible.value = false;
  } catch (error) {
    const details = error instanceof ApiRequestError ? (error.payload.details as { errors?: { field: string; message: string }[] }) : undefined;
    if (error instanceof ApiRequestError && error.code === "METRIC_PARAMETERS_INVALID" && details?.errors) {
      const errors: Record<string, string> = {};
      const unplaced: string[] = [];
      for (const item of details.errors) {
        const key = formFieldKey(item.field, "/values/");
        if (key !== null) errors[key] = item.message;
        else unplaced.push(item.message);
      }
      fieldErrors.value = errors;
      if (unplaced.length) failure.value = { code: null, message: unplaced.join(" ") };
    } else if (error instanceof ApiRequestError && error.status === 409) {
      // The definition moved: the reader's text stays, and reopening loads the current form.
      failure.value = { code: null, message: `${t("dashboard.parametersChanged")} ${error.message}` };
    } else {
      failure.value = cardError(error);
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('dashboard.parametersTitle', { name: card?.name ?? '' })"
    width="min(520px, calc(100vw - 24px))"
    append-to-body
  >
    <div v-loading="loading" class="card-parameters">
      <el-form v-if="form && form.fields.length" label-position="top" @submit.prevent>
        <FormFields
          :fields="form.fields"
          :values="draft"
          :errors="fieldErrors"
          :disabled="saving"
          :choose-placeholder="t('dashboard.choose')"
          :read-only="form.readOnly"
          @input="edit"
          @choose="(field, value) => edit(field.key, value)"
        />
      </el-form>
      <p v-else-if="form" class="note">{{ t("dashboard.noParameters") }}</p>
      <div v-if="failure" class="failure" role="alert">
        <strong v-if="failureHeadline">{{ failureHeadline }}</strong>
        <span>{{ failure.message }}</span>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!form || edited.size === 0" @click="save">
        {{ t("common.save") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.card-parameters {
  min-height: 80px;
}
.note {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.failure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--spacing-sm);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.failure strong {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
