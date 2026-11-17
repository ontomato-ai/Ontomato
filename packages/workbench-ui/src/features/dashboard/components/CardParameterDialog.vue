<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FormFields } from "@ontomato/foundation-ui/form";
import { formFieldKey } from "@ontomato/contracts/form-fields";
import type { DashboardParameterForm } from "@ontomato/contracts/dashboard";
import { ApiRequestError } from "../../../utils/api";
import { fetchCardParameterForm, saveCardParameters } from "../api";
import { cardError, cardErrorHeadline, type CardError } from "./utils/metricCard";

/**
 * Edits one card's parameters through the metric's own form: the fields, values, read-only keys and validation are
 * the metric's; only the keys the reader edited are sent, and the metric interprets the text.
 *
 * A draft fills the first values and keeps its own revision: when the metric moved since the draft was written, the
 * draft's text stays, the reader is told to read the form again, and nothing is saved under the new definition.
 */
const props = defineProps<{
  dashboardId: string;
  card: { id: string; name: string } | null;
  /** A draft's parameter body for this card: the revision it was written against and the values it changes. */
  draft?: { revision: string; values: Record<string, unknown> } | null;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [cardId: string] }>();
const { t } = useI18n();

const form = ref<DashboardParameterForm | null>(null);
const draftValues = ref<Record<string, string>>({});
const original = ref<Record<string, string>>({});
const edited = ref(new Set<string>());
const fieldErrors = ref<Record<string, string>>({});
const failure = ref<CardError | null>(null);
const loading = ref(false);
const saving = ref(false);
const failureHeadline = computed(() => (failure.value ? cardErrorHeadline(failure.value, t) : null));

/** The revision the form was written against says whether this draft still addresses the same definition. */
const unchanged = computed(() => !props.draft || !form.value || props.draft.revision === form.value.revision);
/** The draft's changes, original value beside new, for the keys the form does not show or the reader cannot type into. */
const changes = computed(() => {
  if (!form.value) return [];
  return form.value.fields
    .filter((field) => edited.value.has(field.key))
    .map((field) => ({ key: field.key, label: field.label, from: original.value[field.key] ?? "", to: draftValues.value[field.key] ?? "" }));
});

watch(visible, async (open) => {
  if (!open || !props.card) return;
  form.value = null;
  draftValues.value = {};
  original.value = {};
  edited.value = new Set();
  fieldErrors.value = {};
  failure.value = null;
  loading.value = true;
  try {
    form.value = await fetchCardParameterForm(props.dashboardId, props.card.id);
    original.value = { ...form.value.values };
    draftValues.value = { ...form.value.values, ...textValues(form.value.readOnly, props.draft?.values) };
    edited.value = new Set(Object.keys(textValues(form.value.readOnly, props.draft?.values)));
  } catch (error) {
    failure.value = cardError(error);
  } finally {
    loading.value = false;
  }
}, { immediate: true });

/** A draft's values as this form writes text; its read-only keys stay out, the metric owns those. */
function textValues(readOnly: readonly string[], values: Record<string, unknown> | undefined) {
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (readOnly.includes(key)) continue;
    text[key] = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  }
  return text;
}

function edit(key: string, value: string) {
  draftValues.value = { ...draftValues.value, [key]: value };
  edited.value = new Set(edited.value).add(key);
  const { [key]: _, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
}

async function save() {
  const card = props.card!;
  saving.value = true;
  failure.value = null;
  try {
    await saveCardParameters({
      dashboardId: props.dashboardId,
      cardId: card.id,
      revision: form.value!.revision,
      values: Object.fromEntries([...edited.value].map((key) => [key, draftValues.value[key]!])),
    });
    emit("saved", card.id);
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
          :values="draftValues"
          :errors="fieldErrors"
          :disabled="saving || !unchanged"
          :choose-placeholder="t('dashboard.choose')"
          :read-only="form.readOnly"
          @input="edit"
          @choose="(field, value) => edit(field.key, value)"
        />
      </el-form>
      <p v-else-if="form" class="note">{{ t("dashboard.noParameters") }}</p>
      <el-descriptions v-if="changes.length" :column="1" border class="changes">
        <el-descriptions-item v-for="change in changes" :key="change.key" :label="change.label">
          <span class="was">{{ change.from || "—" }}</span>
          <span class="arrow" aria-hidden="true">→</span>
          <span class="now">{{ change.to || "—" }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <p v-if="!unchanged" class="note" role="note">{{ t("dashboard.draft.revisionChanged") }}</p>
      <div v-if="failure" class="failure" role="alert">
        <strong v-if="failureHeadline">{{ failureHeadline }}</strong>
        <span>{{ failure.message }}</span>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!form || edited.size === 0 || !unchanged" @click="save">
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
.changes {
  margin-top: var(--spacing-md);
}
.was {
  color: var(--el-text-color-tertiary);
  text-decoration: line-through;
}
.arrow {
  margin: 0 6px;
  color: var(--el-text-color-tertiary);
}
.now {
  font-weight: var(--font-semibold);
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
