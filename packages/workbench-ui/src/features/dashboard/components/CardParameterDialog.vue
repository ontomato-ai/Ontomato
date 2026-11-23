<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FormFields } from "@ontomato/foundation-ui/form";
import type { FormFieldRejection, FormFillOutcome, PageActionOutcome } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { formFieldKey } from "@ontomato/contracts/form-fields";
import type { DashboardParameterForm } from "@ontomato/contracts/dashboard";
import { ApiRequestError } from "../../../utils/api";
import { fetchCardParameterForm, saveCardParameters } from "../api";
import { cardError, cardErrorHeadline, type CardError } from "./utils/metricCard";

/**
 * Edits one card's parameters through the metric's own form: the fields, values, read-only keys and validation are
 * the metric's; only the keys the reader (or a live agent `fill_form` call) edited are sent, and the metric interprets
 * the text.
 */
const props = defineProps<{
  dashboardId: string;
  card: { id: string; name: string } | null;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [cardId: string] }>();
const { t } = useI18n();

const form = ref<DashboardParameterForm | null>(null);
const loadedCardId = ref<string | null>(null);
const loadedDashboardId = ref<string | null>(null);
const values = ref<Record<string, string>>({});
const original = ref<Record<string, string>>({});
const edited = ref(new Set<string>());
const fieldErrors = ref<Record<string, string>>({});
const failure = ref<CardError | null>(null);
const loading = ref(false);
const saving = ref(false);
let loadPromise: Promise<void> | null = null;
let loadSeq = 0;
const failureHeadline = computed(() => (failure.value ? cardErrorHeadline(failure.value, t) : null));

/** Edited values, original value beside new, so both human edits and live fills stay reviewable before saving. */
const changes = computed(() => {
  if (!form.value) return [];
  return form.value.fields
    .filter((field) => edited.value.has(field.key))
    .map((field) => ({ key: field.key, label: field.label, from: original.value[field.key] ?? "", to: values.value[field.key] ?? "" }));
});

function isCurrentFormLoaded(): boolean {
  return Boolean(
    visible.value
    && form.value
    && props.card
    && loadedCardId.value === props.card.id
    && loadedDashboardId.value === props.dashboardId,
  );
}

async function waitForLoad(): Promise<void> {
  while (loadPromise) {
    const pending = loadPromise;
    await pending;
  }
}

watch(
  [visible, () => props.dashboardId, () => props.card?.id ?? null] as const,
  ([open, dashboardId, cardId]) => {
    const seq = ++loadSeq;
    loadedCardId.value = null;
    loadedDashboardId.value = null;
    form.value = null;
    values.value = {};
    original.value = {};
    edited.value = new Set();
    fieldErrors.value = {};
    failure.value = null;
    if (!open || !cardId) {
      loading.value = false;
      loadPromise = null;
      return;
    }
    loading.value = true;
    loadPromise = (async () => {
      try {
        const loaded = await fetchCardParameterForm(dashboardId, cardId);
        if (loadSeq !== seq) return;
        form.value = loaded;
        loadedCardId.value = cardId;
        loadedDashboardId.value = dashboardId;
        original.value = { ...loaded.values };
        values.value = { ...loaded.values };
      } catch (error) {
        if (loadSeq !== seq) return;
        failure.value = cardError(error);
      } finally {
        if (loadSeq === seq) {
          loading.value = false;
          loadPromise = null;
        }
      }
    })();
  },
  { immediate: true },
);

function edit(key: string, value: string) {
  values.value = { ...values.value, [key]: value };
  edited.value = new Set(edited.value).add(key);
  const { [key]: _, ...rest } = fieldErrors.value;
  fieldErrors.value = rest;
}

function normalizeParameterKey(rawKey: string): string {
  if (rawKey.startsWith("/values/")) return rawKey.slice("/values/".length);
  if (rawKey.startsWith("/")) return rawKey.slice(1);
  return rawKey;
}

async function fillValues(
  patch: Readonly<Record<string, RuntimeJsonValue>>,
  overwriteUnsaved?: boolean,
): Promise<FormFillOutcome> {
  await waitForLoad();
  if (!isCurrentFormLoaded() || !form.value) {
    return {
      ok: false,
      reason: "form_not_ready",
      member: "card.parameters",
      message: "The card parameter form is not loaded.",
    };
  }
  if (edited.value.size > 0 && !overwriteUnsaved) {
    return {
      ok: false,
      reason: "blocked_unsaved",
      member: "card.parameters",
      message: "The card parameter form already has unsaved edits.",
    };
  }
  const known = new Set(form.value.fields.map((field) => field.key));
  const readOnly = new Set(form.value.readOnly);
  const filledFields: string[] = [];
  const rejectedFields: FormFieldRejection[] = [];
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = normalizeParameterKey(rawKey);
    if (!known.has(key)) {
      rejectedFields.push({ path: rawKey, reason: "unknown_field", message: `Unknown parameter '${key}'.` });
      continue;
    }
    if (readOnly.has(key)) {
      rejectedFields.push({ path: rawKey, reason: "read_only", message: `Parameter '${key}' is read-only.` });
      continue;
    }
    if (rawValue !== null && typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      rejectedFields.push({ path: rawKey, reason: "invalid_value", message: `Parameter '${key}' must be a scalar value.` });
      continue;
    }
    edit(key, rawValue === null ? "" : String(rawValue));
    filledFields.push(key);
  }
  if (!filledFields.length) {
    return {
      ok: false,
      reason: "all_fields_rejected",
      member: "card.parameters",
      rejectedFields,
      message: "No parameter fields could be filled.",
    };
  }
  return {
    ok: true,
    member: "card.parameters",
    filledFields,
    ...(rejectedFields.length ? { rejectedFields } : {}),
  };
}

async function save(): Promise<boolean> {
  if (!isCurrentFormLoaded() || !props.card || !form.value) return false;
  const targetDashboardId = props.dashboardId;
  const targetCardId = props.card.id;
  const targetRevision = form.value.revision;
  const targetValues = Object.fromEntries([...edited.value].map((key) => [key, values.value[key]!]));
  saving.value = true;
  failure.value = null;
  try {
    await saveCardParameters({
      dashboardId: targetDashboardId,
      cardId: targetCardId,
      revision: targetRevision,
      values: targetValues,
    });
    emit("saved", targetCardId);
    if (props.card?.id === targetCardId && props.dashboardId === targetDashboardId) {
      visible.value = false;
    }
    return true;
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
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveFromAction(operation: string): Promise<PageActionOutcome> {
  await waitForLoad();
  if (!isCurrentFormLoaded() || !form.value) {
    return { ok: false, reason: "action_not_ready", operation, message: "The card parameter form is not open." };
  }
  if (edited.value.size === 0) {
    return { ok: false, reason: "action_unavailable", operation, message: "There are no parameter changes to save." };
  }
  const ok = await save();
  if (ok) return { ok: true, kind: "executed", operation };
  const fieldMessages = Object.values(fieldErrors.value);
  if (fieldMessages.length) {
    return { ok: false, reason: "validation_failed", operation, message: fieldMessages.join(" ") };
  }
  return { ok: false, reason: "failed", operation, message: failure.value?.message ?? "Failed to save parameters." };
}

function discard() {
  visible.value = false;
}

defineExpose({
  isOpen: visible,
  currentCardId: () => props.card?.id ?? null,
  hasUnsavedChanges: () => edited.value.size > 0,
  waitForLoad,
  fillValues,
  saveFromAction,
  discard,
});
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
          :values="values"
          :errors="fieldErrors"
          :disabled="saving"
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
