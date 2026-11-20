<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  ElButton,
  ElDialog,
  ElEmpty,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
  vLoading,
} from "element-plus";
import { CalendarClock, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-vue-next";
import ManagerIconButton from "./ManagerIconButton.vue";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import type { SmartAsset, TriggerRecord, WorkflowRecord } from "../api";
import { useManagerClient, useOntologyText } from "../context";
import { useManagerFeedback } from "../feedback";
import type { MessageKey } from "../i18n";

/**
 * The triggers of this domain: when an execution starts.
 *
 * <p>This page authors the capability object, so it creates, edits, publishes and deletes — the four things the task
 * list it replaced could only do for a time-table row. What it does not do is offer the three condition kinds and the
 * two effect kinds with no evaluator or executor: those are refused at save time by the backend, and offering a form
 * that always fails would be worse than saying so.</p>
 */
const { ot } = useOntologyText();
const { message, confirm } = useManagerFeedback();
const {
  loadTriggers,
  saveTrigger,
  deleteTrigger,
  setTriggerStatus,
  loadSmartAssets,
  loadWorkflows,
} = useManagerClient();

const loading = ref(false);
const saving = ref(false);
const query = ref("");
const triggers = ref<TriggerRecord[]>([]);
const actions = ref<SmartAsset[]>([]);
const workflows = ref<WorkflowRecord[]>([]);

const editing = ref(false);

interface Form {
  id: string | null;
  name: string;
  description: string;
  frequencyKind: "interval" | "daily" | "weekly" | "monthly" | "cron";
  every: number;
  unit: "minute" | "hour" | "day";
  time: string;
  weekday: number;
  day: number;
  cron: string;
  timeZone: string;
  effectKind: "action" | "workflow";
  actionId: string;
  workflowId: string;
  parameters: string;
  inputs: string;
  executor: string;
  status: "PENDING_REVIEW" | "PUBLISHED";
}

const blank = (): Form => ({
  id: null,
  name: "",
  description: "",
  frequencyKind: "interval",
  every: 60,
  unit: "minute",
  time: "09:00",
  weekday: 1,
  day: 1,
  cron: "0 0 * * * *",
  timeZone: "Asia/Shanghai",
  effectKind: "action",
  actionId: "",
  workflowId: "",
  parameters: "",
  inputs: "",
  executor: "",
  status: "PUBLISHED",
});

const form = reactive<Form>(blank());

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return triggers.value;
  return triggers.value.filter(
    (item) =>
      item.name.toLowerCase().includes(text) ||
      (item.effectKind ?? "").toLowerCase().includes(text) ||
      cadence(item).toLowerCase().includes(text),
  );
});

const armed = computed(() => triggers.value.filter((item) => item.enabled).length);

async function refresh() {
  loading.value = true;
  try {
    triggers.value = await loadTriggers();
  } catch (error) {
    triggers.value = [];
    message.error((error as Error).message);
  } finally {
    loading.value = false;
  }
}

/** The action and workflow catalogues are what a trigger may start, so they load once beside the list. */
async function loadCatalogues() {
  const [nextActions, nextWorkflows] = await Promise.allSettled([
    loadSmartAssets("actions"),
    loadWorkflows(),
  ]);
  actions.value = nextActions.status === "fulfilled" && Array.isArray(nextActions.value) ? nextActions.value : [];
  workflows.value =
    nextWorkflows.status === "fulfilled" && Array.isArray(nextWorkflows.value) ? nextWorkflows.value : [];
}

const unitNames: Record<"minute" | "hour" | "day", MessageKey> = {
  minute: "triggerUnitMinute",
  hour: "triggerUnitHour",
  day: "triggerUnitDay",
};

/** Weekday 1 = Monday … 7 = Sunday, as the stored frequency counts them. */
const weekdayNames: MessageKey[] = [
  "triggerWeekdayMonday",
  "triggerWeekdayTuesday",
  "triggerWeekdayWednesday",
  "triggerWeekdayThursday",
  "triggerWeekdayFriday",
  "triggerWeekdaySaturday",
  "triggerWeekdaySunday",
];

/**
 * How often the trigger fires, worded here in the reader's language: the service stores the frequency as a structure,
 * not as a sentence. A Cron expression is shown as written.
 */
function cadence(item: TriggerRecord) {
  const frequency = item.condition?.frequency;
  if (!frequency) return "—";
  switch (frequency.kind) {
    case "interval":
      return ot("triggerFrequencyEvery", { every: frequency.every, unit: ot(unitNames[frequency.unit]) });
    case "daily":
      return ot("triggerFrequencyDailyAt", { time: frequency.time });
    case "weekly":
      return ot("triggerFrequencyWeeklyAt", { weekday: ot(weekdayNames[frequency.weekday - 1]!), time: frequency.time });
    case "monthly":
      return ot("triggerFrequencyMonthlyAt", { day: frequency.day, time: frequency.time });
    case "cron":
      return frequency.expression;
  }
}

function stamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * What the trigger starts, in an operator's words: the kind, then the name of the action or process. The effect stores
 * only an id; one no catalogue names any more (the action was deleted) is shown as stored rather than hidden.
 */
function effect(item: TriggerRecord) {
  if (item.effectKind === "workflow") {
    return `${ot("triggerEffectWorkflow")} · ${nameOf(workflows.value, item.effect?.workflowId)}`;
  }
  if (item.effectKind === "action") {
    return `${ot("triggerEffectAction")} · ${nameOf(actions.value, item.effect?.actionId)}`;
  }
  return item.effectKind ?? "—";
}

function nameOf(catalogue: Array<{ id?: string; name: string }>, id: string | undefined) {
  if (!id) return "—";
  return catalogue.find((entry) => entry.id === id)?.name ?? id;
}

/** Time is the only condition kind the backend accepts; any other is shown as stored. */
function conditionLabel(item: TriggerRecord) {
  if (item.conditionKind === "time") return ot("triggerConditionTime");
  return item.conditionKind ?? "—";
}

function statusLabel(status: string | undefined) {
  if (status === "PUBLISHED") return ot("triggerPublishedTag");
  if (status === "UNUSED") return ot("triggerRetired");
  return ot("triggerDraft");
}

function openCreate() {
  Object.assign(form, blank());
  editing.value = true;
}

function openEdit(item: TriggerRecord) {
  Object.assign(form, blank());
  form.id = item.id;
  form.name = item.name;
  form.description = item.description ?? "";
  form.effectKind = item.effectKind === "workflow" ? "workflow" : "action";
  form.actionId = item.effect?.actionId ?? "";
  form.workflowId = item.effect?.workflowId ?? "";
  form.status = item.status === "PUBLISHED" ? "PUBLISHED" : "PENDING_REVIEW";
  form.executor = "";
  // Restore the cadence itself, not just its wording: without this an edit of a 30-minute trigger would silently save it
  // back as the form's default of 60, and the operator would have changed the schedule by fixing a typo in the name.
  const condition = item.condition ?? {};
  const frequency = (condition.frequency ?? {}) as Record<string, unknown>;
  const kind = String(frequency.kind ?? "");
  if (kind === "interval" || kind === "daily" || kind === "weekly" || kind === "monthly" || kind === "cron") {
    form.frequencyKind = kind;
  }
  if (typeof frequency.every === "number") form.every = frequency.every;
  if (frequency.unit === "minute" || frequency.unit === "hour" || frequency.unit === "day") form.unit = frequency.unit;
  if (typeof frequency.time === "string") form.time = frequency.time;
  if (typeof frequency.weekday === "number") form.weekday = frequency.weekday;
  if (typeof frequency.day === "number") form.day = frequency.day;
  if (typeof frequency.expression === "string") form.cron = frequency.expression;
  if (typeof condition.timeZone === "string" && condition.timeZone) form.timeZone = condition.timeZone;
  editing.value = true;
}

function buildCondition() {
  const frequency: Record<string, unknown> = { kind: form.frequencyKind };
  if (form.frequencyKind === "interval") {
    frequency.every = form.every;
    frequency.unit = form.unit;
  } else if (form.frequencyKind === "daily") {
    frequency.time = form.time;
  } else if (form.frequencyKind === "weekly") {
    frequency.weekday = form.weekday;
    frequency.time = form.time;
  } else if (form.frequencyKind === "monthly") {
    frequency.day = form.day;
    frequency.time = form.time;
  } else {
    frequency.expression = form.cron;
  }
  return { frequency, timeZone: form.timeZone };
}

function parseObject(text: string, label: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: ${ot("triggerJsonInvalid")}`);
  }
}

async function submit() {
  if (!form.name.trim()) {
    message.error(ot("triggerNameRequired"));
    return;
  }
  if (form.effectKind === "action" && !form.actionId) {
    message.error(ot("triggerEffectRequired"));
    return;
  }
  if (form.effectKind === "workflow" && !form.workflowId) {
    message.error(ot("triggerEffectRequired"));
    return;
  }
  let effect: Record<string, unknown>;
  try {
    effect =
      form.effectKind === "action"
        ? { actionId: form.actionId, parameters: parseObject(form.parameters, "parameters") ?? {} }
        : { workflowId: form.workflowId, inputs: parseObject(form.inputs, "inputs") ?? {} };
  } catch (error) {
    message.error((error as Error).message);
    return;
  }
  saving.value = true;
  try {
    await saveTrigger({
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      conditionKind: "time",
      condition: buildCondition(),
      effectKind: form.effectKind,
      effect,
      executor: form.executor.trim() || null,
    });
    message.success(ot("triggerSaved"));
    editing.value = false;
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(item: TriggerRecord) {
  try {
    const next = item.status === "PUBLISHED" ? "UNUSED" : "PUBLISHED";
    await setTriggerStatus(item.id, next);
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  }
}

async function remove(item: TriggerRecord) {
  try {
    await confirm(item.name, ot("triggerDelete"));
  } catch {
    return;
  }
  try {
    await deleteTrigger(item.id);
    message.success(ot("triggerDeleted"));
    await refresh();
  } catch (error) {
    message.error((error as Error).message);
  }
}

onMounted(async () => {
  await Promise.all([refresh(), loadCatalogues()]);
});
</script>

<template>
  <section v-loading="loading" class="trigger-catalog">
    <PlatformPageHeader compact :title="ot('triggerTitle')" :description="ot('triggerDesc')">
      <template #actions>
        <el-input
          v-model="query"
          class="trigger-filter"
          :prefix-icon="Search"
          :placeholder="ot('triggerFilter')"
          clearable
        />
        <ManagerIconButton :icon="RefreshCw" :label="ot('triggerRefresh')" :loading="loading" @click="refresh" />
        <el-button type="primary" :icon="Plus" @click="openCreate">
          <span>{{ ot("triggerNew") }}</span>
        </el-button>
      </template>
    </PlatformPageHeader>

    <div class="trigger-body platform-page-gutter">
      <p class="trigger-note">
        <CalendarClock :size="14" />
        <span>{{ ot("triggerNote") }}</span>
        <el-tag size="small" effect="plain">{{ ot("triggerArmed") }} {{ armed }}</el-tag>
        <el-tag size="small" effect="plain">{{ ot("triggerCount") }} {{ triggers.length }}</el-tag>
      </p>

      <div v-if="!loading && filtered.length === 0" class="trigger-empty">
        <el-empty :description="ot('triggerEmpty')" />
      </div>

      <el-table v-else :data="filtered" row-key="id" size="small" class="trigger-table">
        <el-table-column :label="ot('triggerColumnTitle')" min-width="180">
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <span class="trigger-version">v{{ row.version ?? 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnEffect')" min-width="220">
          <template #default="{ row }">
            <span>{{ effect(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnCondition')" min-width="130">
          <template #default="{ row }">
            <span>{{ conditionLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnCadence')" min-width="130">
          <template #default="{ row }">
            <span>{{ cadence(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnNextRun')" min-width="160">
          <template #default="{ row }">
            <span>{{ stamp(row.nextRunAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnState')" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'PUBLISHED' ? 'success' : 'info'" effect="plain">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="ot('triggerColumnActions')" width="200">
          <template #default="{ row }">
            <button class="trigger-action" :title="ot('triggerEdit')" @click="openEdit(row)">
              <Pencil :size="14" />
            </button>
            <el-button link size="small" @click="toggleStatus(row)">
              {{ row.status === "PUBLISHED" ? ot("triggerRetire") : ot("triggerPublish") }}
            </el-button>
            <button class="trigger-action danger" :title="ot('triggerDelete')" @click="remove(row)">
              <Trash2 :size="14" />
            </button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editing" :title="form.id ? ot('triggerEdit') : ot('triggerNew')" width="620px">
      <el-form label-width="96px" label-position="left">
        <el-form-item :label="ot('triggerName')" required>
          <el-input v-model="form.name" :placeholder="ot('triggerNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="ot('triggerDescription')">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>

        <el-form-item :label="ot('triggerCondition')">
          <el-select v-model="form.frequencyKind" class="trigger-field">
            <el-option value="interval" :label="ot('triggerFrequencyInterval')" />
            <el-option value="daily" :label="ot('triggerFrequencyDaily')" />
            <el-option value="weekly" :label="ot('triggerFrequencyWeekly')" />
            <el-option value="monthly" :label="ot('triggerFrequencyMonthly')" />
            <el-option value="cron" :label="ot('triggerFrequencyCron')" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.frequencyKind === 'interval'" :label="ot('triggerEvery')">
          <el-input-number v-model="form.every" :min="1" :max="1000" />
          <el-select v-model="form.unit" class="trigger-unit">
            <el-option value="minute" :label="ot('triggerUnitMinute')" />
            <el-option value="hour" :label="ot('triggerUnitHour')" />
            <el-option value="day" :label="ot('triggerUnitDay')" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.frequencyKind === 'weekly'" :label="ot('triggerWeekday')">
          <el-input-number v-model="form.weekday" :min="1" :max="7" />
        </el-form-item>
        <el-form-item v-if="form.frequencyKind === 'monthly'" :label="ot('triggerDay')">
          <el-input-number v-model="form.day" :min="1" :max="31" />
        </el-form-item>
        <el-form-item v-if="form.frequencyKind === 'cron'" :label="ot('triggerCron')">
          <el-input v-model="form.cron" placeholder="0 0 * * * *" />
        </el-form-item>
        <el-form-item v-if="form.frequencyKind !== 'interval'" :label="ot('triggerTime')">
          <el-input v-model="form.time" placeholder="09:00" />
        </el-form-item>
        <el-form-item :label="ot('triggerTimeZone')">
          <el-input v-model="form.timeZone" placeholder="Asia/Shanghai" />
        </el-form-item>

        <el-form-item :label="ot('triggerEffect')">
          <el-select v-model="form.effectKind" class="trigger-field">
            <el-option value="action" :label="ot('triggerEffectAction')" />
            <el-option value="workflow" :label="ot('triggerEffectWorkflow')" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.effectKind === 'action'" :label="ot('triggerEffectAction')" required>
          <el-select v-model="form.actionId" filterable class="trigger-field">
            <el-option v-for="item in actions" :key="item.id" :value="item.id!" :label="item.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-else :label="ot('triggerEffectWorkflow')" required>
          <el-select v-model="form.workflowId" filterable class="trigger-field">
            <el-option v-for="item in workflows" :key="item.id" :value="item.id!" :label="item.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.effectKind === 'action'" :label="ot('triggerParameters')">
          <el-input v-model="form.parameters" type="textarea" :rows="3" placeholder='{"run_id":"..."}' />
        </el-form-item>
        <el-form-item v-else :label="ot('triggerInputs')">
          <el-input v-model="form.inputs" type="textarea" :rows="3" placeholder='{"s1":{"title":"..."}}' />
        </el-form-item>

        <el-form-item :label="ot('triggerExecutor')">
          <el-input v-model="form.executor" :placeholder="ot('triggerExecutorPlaceholder')" />
        </el-form-item>
        <el-form-item :label="ot('triggerColumnState')">
          <el-select v-model="form.status" class="trigger-field">
            <el-option value="PUBLISHED" :label="ot('triggerPublish')" />
            <el-option value="PENDING_REVIEW" :label="ot('triggerDraft')" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">{{ ot("triggerCancel") }}</el-button>
        <el-button type="primary" :loading="saving" @click="submit">{{ ot("triggerSave") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.trigger-catalog {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.trigger-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding-block: var(--page-content-gap) var(--spacing-xl);
}

.trigger-filter {
  width: 200px;
}

.trigger-field {
  width: 100%;
}

.trigger-unit {
  width: 96px;
  margin-left: 8px;
}

.trigger-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.trigger-version {
  margin-left: 6px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.trigger-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}

.trigger-action.danger {
  color: var(--el-color-danger);
}

.trigger-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
