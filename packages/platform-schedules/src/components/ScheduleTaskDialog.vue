<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from "vue";
import { Check } from "lucide-vue-next";
import { formFieldKey, type FormField } from "@ontomato/contracts/form-fields";
import {
  PLATFORM_SCHEDULE_TITLE_MAX,
  platformTaskInputSchema,
  platformTaskUpdateSchema,
  type PlatformScheduleContent,
  type PlatformTask,
  type PlatformTaskInput,
} from "@ontomato/contracts/platform-schedules";
import { FormFields } from "@ontomato/foundation-ui/form";
import { scheduleFailure, type SchedulesApi } from "../api";
import type { ScheduleApp } from "../apps";
import type { Attempts } from "../attempts";
import { useApplicationForm } from "../form-session";
import { frequencyDraft, frequencyOf } from "../frequency";
import { useScheduleText } from "../text";
import ScheduleFrequency from "./ScheduleFrequency.vue";

/**
 * Writing one task: its title, its application and its time, then what the application needs, then the address to
 * mail after each run.
 *
 * The platform's own part is the title, the time and the mail. Everything under "what the application gets" is the
 * application's: its form is read from the service for the chosen application, drawn as declared, and asked for again
 * whenever a choice the form depends on changes. A save sends the draft with the form's revision; the service checks it
 * all again, and a form that changed in the meantime comes back to be checked instead of being saved.
 */
const props = defineProps<{
  api: SchedulesApi;
  /** The task being edited; null writes a new one. */
  task: PlatformTask | null;
  /** The applications that can run on a schedule, in the rail's order. */
  apps: readonly ScheduleApp[];
  /** Any application's name and icon, for a task whose application can no longer run on a schedule. */
  appInfo: (appId: string) => { label: string; icon: Component };
  /** The service's time zone: a new task runs in it, an existing task keeps its own. */
  serviceZone: string;
  /** The application the page is narrowed to, preselected for a new task. */
  defaultAppId: string | null;
  /** The page's keys of creates still waiting for an answer, so saving again after a lost answer creates nothing twice. */
  attempts: Attempts;
}>();
const emit = defineEmits<{
  close: [];
  saved: [task: PlatformTask, created: boolean];
  /** The task is gone (deleted elsewhere, or no longer the caller's). */
  gone: [taskId: string];
  /** The task was changed elsewhere; this is its latest version. */
  refreshed: [task: PlatformTask];
}>();
const { t, failure: failureText } = useScheduleText();

type PlatformField = "title" | "appId" | "frequency" | "notifyEmail";

const visible = ref(true);
const editing = ref<PlatformTask | null>(props.task);
const title = ref("");
const appId = ref<string | null>(null);
const frequency = ref(frequencyDraft());
const email = ref("");
const zone = ref(props.serviceZone);
const session = useApplicationForm(props.api);
const attempted = ref(false);
const saving = ref(false);
/** What the last save or read said that no single field carries. */
const failure = ref<string | null>(null);
/** Something the reader must look at before saving again: the form or the task changed under them. */
const notice = ref<string | null>(null);
const saveFieldErrors = ref<Record<string, string>>({});
const savePlatformErrors = ref<Partial<Record<PlatformField, string>>>({});
const body = ref<HTMLElement | null>(null);

/** An application the task is on but that can no longer run on a schedule stays visible, marked unavailable. */
const pickerApps = computed<ScheduleApp[]>(() => {
  const own = editing.value?.appId;
  if (!own || props.apps.some((app) => app.id === own)) return [...props.apps];
  const info = props.appInfo(own);
  return [
    ...props.apps,
    {
      id: own,
      label: info.label,
      icon: info.icon,
      description: null,
      available: false,
      unavailableReason: t("form.appUnknown"),
      taskCount: 0,
    },
  ];
});
const selectedApp = computed(() => pickerApps.value.find((app) => app.id === appId.value) ?? null);

function apply(task: PlatformTask) {
  editing.value = task;
  title.value = task.title;
  appId.value = task.appId;
  frequency.value = frequencyDraft(task.frequency);
  email.value = task.notifyEmail ?? "";
  zone.value = task.timeZone;
}

function loadForm(app: string, values: PlatformScheduleContent, changedField: string | null = null) {
  const own = editing.value;
  void session.load(app, {
    values,
    changedField,
    // The task's own references (an agent since disabled, say) are only its own application's to show.
    taskId: own && own.appId === app ? own.id : null,
    timeZone: zone.value,
  });
}

onMounted(async () => {
  if (!props.task) {
    appId.value = props.defaultAppId;
    if (appId.value) loadForm(appId.value, {});
    return;
  }
  apply(props.task);
  // The card may be minutes old: the form opens on the task as the service holds it now.
  try {
    const fresh = await props.api.task(props.task.id);
    apply(fresh);
    loadForm(fresh.appId, fresh.content);
  } catch (error) {
    failure.value = failureText(error);
    if (scheduleFailure(error).code === "TASK_NOT_FOUND") emit("gone", props.task.id);
  }
});

function chooseApp(next: string) {
  if (next === appId.value) return;
  appId.value = next;
  notice.value = null;
  saveFieldErrors.value = {};
  // A different application starts from an empty draft: nothing of one application's form carries to another's.
  loadForm(next, {});
}

function clearSaveError(key: string) {
  if (!(key in saveFieldErrors.value)) return;
  const rest = { ...saveFieldErrors.value };
  delete rest[key];
  saveFieldErrors.value = rest;
}

function input(key: string, value: string) {
  session.set(key, value);
  clearSaveError(key);
}

function choose(field: Extract<FormField, { type: "select" }>, value: string) {
  input(field.key, value);
  if (field.refreshOnChange && appId.value) loadForm(appId.value, session.values.value, field.key);
}

watch(title, () => delete savePlatformErrors.value.title);
watch(email, () => delete savePlatformErrors.value.notifyEmail);
watch(frequency, () => delete savePlatformErrors.value.frequency);

const draft = computed(() => ({
  title: title.value,
  appId: appId.value ?? "",
  content: session.values.value,
  formRevision: session.form.value?.formRevision ?? "",
  frequency: frequencyOf(frequency.value),
  timeZone: zone.value,
  notifyEmail: email.value.trim() ? email.value.trim() : null,
}));
const parsed = computed(() =>
  editing.value
    ? platformTaskUpdateSchema.safeParse({ ...draft.value, revision: editing.value.revision })
    : platformTaskInputSchema.safeParse(draft.value),
);
const invalid = computed(() => {
  const result = parsed.value;
  const issues = result.success ? [] : result.error.issues;
  const at = (field: PlatformField) => issues.some((issue) => issue.path[0] === field);
  return { title: at("title"), appId: !appId.value, frequency: at("frequency"), notifyEmail: at("notifyEmail") };
});

/** The browser's first look at a value: required, within its limit, an option still offered. The service decides. */
const localFieldErrors = computed(() => {
  const errors: Record<string, string> = {};
  for (const field of session.form.value?.fields ?? []) {
    const value = session.values.value[field.key] ?? "";
    if (field.required && !value.trim()) errors[field.key] = t("form.required");
    else if (field.type === "text" && value.length > field.maxLength) errors[field.key] = t("form.tooLong", { max: field.maxLength });
    else if (field.type === "select" && value) {
      const option = field.options.find((candidate) => candidate.value === value);
      if (!option) errors[field.key] = t("form.optionMissing");
      else if (option.disabled) errors[field.key] = t("form.optionUnavailable", { reason: option.disabledReason });
    }
  }
  return errors;
});

/** The application's own errors stand until the reader changes that field; the browser's show once they tried to save. */
const fieldErrors = computed(() => {
  const errors: Record<string, string> = {};
  for (const error of session.form.value?.errors ?? []) {
    const key = formFieldKey(error.field, "/values/");
    if (key !== null && !session.edited.value.has(key)) errors[key] = error.message;
  }
  if (attempted.value) Object.assign(errors, localFieldErrors.value);
  return Object.assign(errors, saveFieldErrors.value);
});

const platformError = computed(() => ({
  title:
    savePlatformErrors.value.title ??
    (attempted.value && invalid.value.title
      ? t(title.value.trim() ? "form.titleTooLong" : "form.titleRequired", { max: PLATFORM_SCHEDULE_TITLE_MAX })
      : ""),
  appId: savePlatformErrors.value.appId ?? (attempted.value && invalid.value.appId ? t("form.appRequired") : ""),
  frequency:
    savePlatformErrors.value.frequency ?? (attempted.value && invalid.value.frequency ? t("form.frequencyInvalid") : ""),
  notifyEmail:
    savePlatformErrors.value.notifyEmail ?? (attempted.value && invalid.value.notifyEmail ? t("form.emailInvalid") : ""),
}));

const zoneHint = computed(() =>
  zone.value === props.serviceZone ? t("form.serviceZone", { zone: zone.value }) : t("form.taskZone", { zone: zone.value }),
);
const kindHint = computed(() => {
  const kind = frequency.value.kind;
  return kind === "interval" ? t("form.intervalHint") : kind === "monthly" ? t("form.monthEndHint") : kind === "cron" ? t("form.cronHint") : "";
});

/** Only the current selection's form, read successfully, can be submitted. */
const canSubmit = computed(() => !saving.value && session.state.value === "ready");

function revealError() {
  void nextTick(() => body.value?.querySelector(".is-error, .save-failure")?.scrollIntoView?.({ block: "nearest" }));
}

/** A refusal's field errors on the fields they name; what no field carries is said at the foot of the form. */
function placeFieldErrors(fields: readonly { field: string; message: string }[]): boolean {
  const content: Record<string, string> = {};
  const platform: Partial<Record<PlatformField, string>> = {};
  let unplaced = false;
  for (const error of fields) {
    const key = formFieldKey(error.field, "/content/");
    const top = error.field.split("/")[1] as PlatformField | undefined;
    if (key !== null) content[key] = error.message;
    else if (top === "title" || top === "appId" || top === "frequency" || top === "notifyEmail") platform[top] = error.message;
    else unplaced = true;
  }
  saveFieldErrors.value = content;
  savePlatformErrors.value = platform;
  return unplaced || fields.length === 0;
}

async function refusedSave(error: unknown) {
  const refusal = scheduleFailure(error).refusal;
  if (!refusal) {
    failure.value = t(editing.value ? "form.noAnswer" : "form.noAnswerCreate");
    return;
  }
  switch (refusal.code) {
    case "FORM_CHANGED":
      // The application's current form replaces the draft; the reader checks it and saves again themselves.
      if (refusal.form) session.adopt(refusal.form);
      saveFieldErrors.value = {};
      notice.value = t("form.formChanged");
      return;
    case "FIELD_VALIDATION_FAILED":
    case "TARGET_UNAVAILABLE":
    case "INVALID_REQUEST":
      if (placeFieldErrors(refusal.fields ?? [])) failure.value = failureText(error);
      return;
    case "REVISION_CONFLICT": {
      // Someone else's change is not overwritten: the task's latest version replaces the draft, to be checked again.
      const own = editing.value!;
      try {
        const fresh = await props.api.task(own.id);
        apply(fresh);
        loadForm(fresh.appId, fresh.content);
        notice.value = t("form.changedElsewhere");
        emit("refreshed", fresh);
      } catch (reread) {
        failure.value = failureText(reread);
      }
      return;
    }
    case "TASK_NOT_FOUND":
      failure.value = failureText(error);
      if (editing.value) emit("gone", editing.value.id);
      return;
    default:
      failure.value = failureText(error);
  }
}

async function submit() {
  attempted.value = true;
  failure.value = null;
  const result = parsed.value;
  if (!canSubmit.value || !result.success || Object.keys(localFieldErrors.value).length > 0) {
    revealError();
    return;
  }
  saving.value = true;
  notice.value = null;
  const own = editing.value;
  const input: PlatformTaskInput = result.data;
  try {
    if (own) {
      emit("saved", await props.api.update(own.id, { ...input, revision: own.revision }), false);
    } else {
      const created = await props.api.create(input, props.attempts.key("create", JSON.stringify(input)));
      props.attempts.settle("create");
      emit("saved", created, true);
    }
    visible.value = false;
  } catch (error) {
    if (!own && scheduleFailure(error).refusal) props.attempts.settle("create");
    await refusedSave(error);
    revealError();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="640px"
    class="schedule-dialog"
    append-to-body
    :close-on-click-modal="false"
    @closed="emit('close')"
  >
    <!-- The dialog is labelled by its title: the header keeps the id and class Element Plus gives it. -->
    <template #header="{ titleId, titleClass }">
      <div class="dialog-head">
        <span :id="titleId" :class="titleClass" role="heading" aria-level="2">
          {{ task ? t("form.editTitle") : t("form.newTitle") }}
        </span>
        <p class="dialog-subtitle">{{ t("form.subtitle") }}</p>
      </div>
    </template>

    <div ref="body">
      <el-form class="task-form" label-position="left" label-width="auto" @submit.prevent="submit">
        <el-form-item :label="t('form.title')" :error="platformError.title" data-field="title">
          <el-input v-model="title" :maxlength="PLATFORM_SCHEDULE_TITLE_MAX" :aria-label="t('form.title')" />
        </el-form-item>

        <el-form-item :label="t('form.app')" :error="platformError.appId" data-field="appId">
          <el-select
            :model-value="appId ?? undefined"
            class="control"
            popper-class="schedule-app-options"
            :placeholder="t('form.appPlaceholder')"
            :aria-label="t('form.app')"
            @update:model-value="chooseApp(String($event))"
          >
            <template v-if="selectedApp" #label>
              <span class="app-value">
                <component :is="selectedApp.icon" :size="16" aria-hidden="true" />
                <span>{{ selectedApp.label }}</span>
              </span>
            </template>
            <el-option
              v-for="app in pickerApps"
              :key="app.id"
              :value="app.id"
              :label="app.label"
              :disabled="!app.available"
            >
              <span class="app-option">
                <component :is="app.icon" :size="16" class="app-option-icon" aria-hidden="true" />
                <span class="app-option-text">
                  <span class="app-option-name">{{ app.label }}</span>
                  <span v-if="app.description" class="app-option-line">{{ app.description }}</span>
                  <span v-if="!app.available" class="app-option-line">{{ app.unavailableReason }}</span>
                </span>
                <Check v-if="app.id === appId" :size="16" class="app-option-check" aria-hidden="true" />
              </span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item :label="t('form.time')" :error="platformError.frequency" data-field="frequency">
          <ScheduleFrequency v-model="frequency" />
          <p class="hint">{{ zoneHint }}<template v-if="kindHint"> {{ kindHint }}</template></p>
        </el-form-item>

        <section v-if="appId" class="section" :aria-label="t('form.content', { app: selectedApp?.label ?? appId })">
          <h3 class="section-title">{{ t("form.content", { app: selectedApp?.label ?? appId }) }}</h3>
          <p v-if="notice" class="notice" role="status">{{ notice }}</p>
          <p v-if="session.state.value === 'loading' && !session.form.value" class="form-state" aria-busy="true">
            {{ t("form.loadingForm") }}
          </p>
          <p v-else-if="session.state.value === 'error'" class="form-state failed" role="alert">
            {{ t("form.formFailed") }}{{ session.failure.value ? `: ${failureText(session.failure.value)}` : "" }}
            <button type="button" class="link" @click="session.retry()">{{ t("retry") }}</button>
          </p>
          <template v-if="session.form.value">
            <p v-if="session.form.value.fields.length === 0" class="form-state">{{ t("form.noFields") }}</p>
            <FormFields
              :fields="session.form.value.fields"
              :values="session.values.value"
              :errors="fieldErrors"
              :disabled="session.state.value === 'loading'"
              :choose-placeholder="t('form.choose')"
              @input="input"
              @choose="choose"
            />
          </template>
        </section>

        <section class="section">
          <h3 class="section-title">{{ t("form.after") }}</h3>
          <el-form-item :label="t('form.notifyEmail')" :error="platformError.notifyEmail" data-field="notifyEmail">
            <el-input
              v-model="email"
              type="email"
              autocomplete="email"
              maxlength="320"
              :placeholder="t('form.notifyPlaceholder')"
              :aria-label="t('form.notifyEmail')"
            />
          </el-form-item>
        </section>

        <p class="identity">{{ t("form.identity") }}</p>
        <p v-if="failure" class="save-failure" role="alert">{{ failure }}</p>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t("form.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSubmit" data-action="submit" @click="submit">
        {{ task ? t("form.save") : t("form.createAndEnable") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/*
 * The dialog never grows past the window, whatever the application declares. It opens where every dialog does (Element
 * Plus's top margin) and grows downward until it keeps a margin above the window's bottom edge; from there its title and
 * its buttons stay where they are and only the form between them scrolls, so choosing an application never moves the
 * title. The bound is a share of the overlay, so it holds when a narrow window pads the overlay too.
 */
:global(.el-dialog.schedule-dialog) {
  --schedule-dialog-gap: var(--spacing-2xl);
  display: flex;
  flex-direction: column;
  max-height: calc(100% - var(--el-dialog-margin-top, 15vh) - var(--schedule-dialog-gap));
  margin-bottom: var(--schedule-dialog-gap);
}
:global(.schedule-dialog .el-dialog__header),
:global(.schedule-dialog .el-dialog__footer) {
  flex: none;
}
:global(.schedule-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* A narrow window keeps the same small margin above and below, rather than a share of its height above. */
@media (max-width: 760px) {
  :global(.el-dialog.schedule-dialog) {
    --el-dialog-margin-top: var(--spacing-lg);
    --schedule-dialog-gap: var(--spacing-lg);
  }
}
.dialog-head {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding-right: var(--spacing-xl);
}
.dialog-subtitle {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.task-form {
  display: flex;
  flex-direction: column;
}
.control {
  width: 100%;
}
.hint {
  width: 100%;
  margin: var(--spacing-xs) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
/* The application's part and the mail each start under a hairline, with their own heading. */
.section {
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--el-border-color-lighter);
}
.section-title {
  margin: 0 0 var(--spacing-md);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.notice {
  margin: 0 0 var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.form-state {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.form-state.failed {
  color: var(--el-color-danger);
}
.identity {
  margin: 0;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.save-failure {
  margin: var(--spacing-md) 0 0;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.link {
  padding: 0;
  margin-left: var(--spacing-xs);
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.app-value {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
}
.app-option {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xs) 0;
}
.app-option-icon {
  flex: none;
  color: var(--el-text-color-regular);
}
.app-option-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.app-option-name {
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
  line-height: var(--leading-sm);
}
.app-option-line {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  white-space: normal;
}
/* An application that cannot run on a schedule now stays listed, dimmed, with the reason under its name. */
:global(.schedule-app-options .el-select-dropdown__item.is-disabled) .app-option-name,
:global(.schedule-app-options .el-select-dropdown__item.is-disabled) .app-option-icon {
  color: var(--el-text-color-disabled);
}
.app-option-check {
  flex: none;
  color: var(--brand-link);
}
:global(.schedule-app-options .el-select-dropdown__item) {
  height: auto;
  min-height: var(--control-height-lg);
  line-height: var(--leading-sm);
  white-space: normal;
}
/* The selected application is marked by its check, not by a second colour on its name. */
:global(.schedule-app-options .el-select-dropdown__item.is-selected) {
  font-weight: var(--font-normal);
}
</style>
