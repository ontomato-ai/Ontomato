<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { History, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PlatformTask, PlatformTaskInput } from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "../api";
import type { PlatformScheduleFunction } from "../host";
import type { Translate } from "../i18n";
import { describeFrequency, targetSummary } from "../frequency";
import { useSchedulesLabels } from "../labels";
import PlatformScheduleForm from "./PlatformScheduleForm.vue";
import PlatformScheduleRuns from "./PlatformScheduleRuns.vue";

/**
 * The platform's scheduled tasks, the one list both entrances use: the platform's own page shows everything the
 * caller may see, and the agent platform's entry mounts the same component with `agentId`, so an agent's tasks are
 * this list narrowed, never a second one. Which function tasks are visible is the service's answer; the page adds no
 * permission of its own.
 */
const props = defineProps<{
  api: SchedulesApi;
  agents: readonly AgentHostAgent[];
  functions: readonly PlatformScheduleFunction[];
  /** Show only this agent's tasks and preselect it for a new task (the agent platform's entry). */
  agentId?: string | null;
  /** Show only this application's tasks, e.g. `agents` or `ontology`; the user may still change the filter. */
  appId?: string | null;
  /** The page's language, used for times and weekday names. */
  locale: string;
  /** The page's own text, from the host's message tree under `platformSchedules`. */
  t: Translate;
}>();
const emit = defineEmits<{ openSession: [sessionId: string] }>();
const labels = useSchedulesLabels();

type AppFilter = "" | "agents" | "ontology";

const tasks = ref<PlatformTask[]>([]);
const timeZone = ref("");
const state = ref<"loading" | "ready" | "error">("loading");
const appFilter = ref<AppFilter>((props.appId as AppFilter | null | undefined) ?? "");
/** undefined: the form is closed; null: registering a new task; a task: editing it. */
const editing = ref<PlatformTask | null | undefined>(undefined);
const saving = ref(false);
const busy = ref(new Set<string>());
const histories = ref<Record<string, { reload: () => Promise<void> } | null>>({});
/** The row whose history is open; one at a time, so a scrolled table never holds several run lists. */
const historyRow = ref<string | null>(null);

/** The agent's name for the row, or the fact that it is gone: the task pauses when its agent is unavailable. */
const agentName = (id: string) =>
  props.agents.find((agent) => agent.id === id)?.name ?? props.t("agentMissing");
const functionName = (id: string) =>
  props.functions.find((fn) => fn.id === id)?.name ?? props.t("unknownFunction");

/** The rows on screen: the agent scope is fixed by the host, the application filter is the reader's. */
const shown = computed(() =>
  appFilter.value ? tasks.value.filter((task) => task.appId === appFilter.value) : tasks.value,
);

const formOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined;
  },
});

async function load() {
  state.value = "loading";
  try {
    const list = await props.api.list(props.agentId ? { agentId: props.agentId } : {});
    tasks.value = list.tasks;
    timeZone.value = list.timeZone;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

async function open() {
  // Renewing before the first read lets a task that paused on an expired credential return to its schedule, exactly as
  // the service intends when its owner visits this page with a valid login. A failed renewal must not hide the list.
  await props.api.renewCredential().catch(() => undefined);
  await load();
}

function failure(error: unknown) {
  const code = props.api.errorCode(error);
  const known: Record<string, string> = {
    SCHEDULED_TASK_BUSY: "failure.busy",
    SCHEDULED_TASK_LIMIT: "failure.limit",
    NOT_FOUND: "failure.notFound",
    AGENT_UNAVAILABLE: "failure.agentUnavailable",
    FUNCTION_UNAVAILABLE: "failure.functionUnavailable",
    CREDENTIAL_INVALID: "failure.credential",
  };
  ElMessage.error(code && known[code] ? props.t(known[code]) : props.t("failure.request"));
}

function replace(task: PlatformTask) {
  const index = tasks.value.findIndex((known) => known.id === task.id);
  if (index >= 0) tasks.value[index] = task;
  else tasks.value = [task, ...tasks.value];
}

async function act(id: string, action: () => Promise<void>) {
  if (busy.value.has(id)) return;
  busy.value = new Set(busy.value).add(id);
  try {
    await action();
  } catch (error) {
    failure(error);
  } finally {
    const next = new Set(busy.value);
    next.delete(id);
    busy.value = next;
  }
}

async function submit(input: PlatformTaskInput) {
  saving.value = true;
  try {
    const current = editing.value;
    replace(
      current ? await props.api.update(current.id, input) : await props.api.create(input),
    );
    editing.value = undefined;
    ElMessage.success(props.t("saved"));
  } catch (error) {
    failure(error);
  } finally {
    saving.value = false;
  }
}

function toggle(task: PlatformTask, enabled: boolean) {
  void act(task.id, async () => replace(await props.api.setEnabled(task.id, enabled)));
}

function runNow(task: PlatformTask) {
  void act(task.id, async () => {
    const run = await props.api.runNow(task.id);
    replace({ ...task, lastRun: run });
    if (run.status === "failed" && run.error) ElMessage.warning(labels.error(run.error));
    else ElMessage.success(props.t("runStarted"));
    await histories.value[task.id]?.reload();
  });
}

async function remove(task: PlatformTask) {
  try {
    await ElMessageBox.confirm(props.t("deleteConfirm"), task.name, {
      type: "warning",
      confirmButtonText: props.t("action.delete"),
      cancelButtonText: props.t("form.cancel"),
    });
  } catch {
    return;
  }
  void act(task.id, async () => {
    await props.api.remove(task.id);
    tasks.value = tasks.value.filter((known) => known.id !== task.id);
    ElMessage.success(props.t("deleted"));
  });
}

function toggleHistory(id: string) {
  historyRow.value = historyRow.value === id ? null : id;
}

onMounted(() => void open());
defineExpose({ reload: load });
</script>

<template>
  <div class="schedules">
    <div class="toolbar">
      <div class="scope">
        <el-select
          v-if="!agentId"
          v-model="appFilter"
          class="app-filter"
          :aria-label="t('filter.app')"
        >
          <el-option value="" :label="t('filter.all')" />
          <el-option value="agents" :label="t('filter.agentsOnly')" />
          <el-option value="ontology" :label="t('filter.functionsOnly')" />
        </el-select>
        <span v-else class="scoped-note">{{ t("agentScoped") }}</span>
      </div>
      <el-button type="primary" :disabled="state === 'loading'" @click="editing = null">
        <Plus :size="16" />
        <span>{{ t("newTask") }}</span>
      </el-button>
    </div>

    <div v-if="state === 'loading' && tasks.length === 0" class="skeleton" aria-busy="true">
      <span v-for="line in 5" :key="line" />
    </div>
    <div v-else-if="state === 'error'" class="note">
      {{ t("loadFailed") }}
      <button type="button" class="link" @click="load">{{ t("retry") }}</button>
    </div>
    <el-empty v-else-if="shown.length === 0" :description="t('empty')" />
    <el-table
      v-else
      :data="shown"
      row-key="id"
      class="table"
      :expand-row-keys="historyRow ? [historyRow] : []"
    >
      <el-table-column :label="t('columns.name')" min-width="200">
        <template #default="{ row }">
          <span class="name">{{ row.name }}</span>
          <p v-if="row.description" class="caption">{{ row.description }}</p>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.target')" min-width="240">
        <template #default="{ row }">
          <span v-if="row.target.kind === 'agent'" class="what">{{ agentName(row.target.agentId) }}</span>
          <span v-else class="what">{{ functionName(row.target.functionId) }}</span>
          <p class="caption" :title="targetSummary(row, functionName)">{{ targetSummary(row, functionName) }}</p>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.app')" width="110">
        <template #default="{ row }">{{ labels.app(row.appId) }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.frequency')" min-width="180">
        <template #default="{ row }">{{ describeFrequency(row.frequency, t, locale) }}</template>
      </el-table-column>
      <el-table-column :label="t('columns.nextRun')" min-width="150">
        <template #default="{ row }">
          <span v-if="row.nextRunAt">{{ labels.time(row.nextRunAt) }}</span>
          <span v-else class="caption">{{ t("notScheduled") }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.lastRun')" min-width="170">
        <template #default="{ row }">
          <template v-if="row.lastRun">
            <el-tag size="small" effect="plain" :type="labels.statusType(row.lastRun.status)">
              {{ labels.status(row.lastRun.status) }}
            </el-tag>
            <p class="caption">{{ labels.time(row.lastRun.startedAt) }}</p>
          </template>
          <span v-else class="caption">{{ t("neverRun") }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.state')" width="170">
        <template #default="{ row }">
          <div class="state">
            <el-switch
              :model-value="row.enabled"
              :loading="busy.has(row.id)"
              :aria-label="t('action.enabled')"
              @update:model-value="toggle(row, Boolean($event))"
            />
            <el-tag size="small" effect="plain" :type="labels.taskStateType(row)">
              {{ labels.taskState(row) }}
            </el-tag>
            <el-button
              v-if="row.pausedReason"
              text
              size="small"
              :disabled="busy.has(row.id)"
              @click="toggle(row, true)"
            >
              <RotateCcw :size="14" />
              <span class="action-label">{{ t("action.resume") }}</span>
            </el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="t('columns.actions')" width="260" fixed="right">
        <template #default="{ row }">
          <div class="actions">
            <el-button
              text
              size="small"
              :disabled="busy.has(row.id)"
              :title="t('action.runNow')"
              @click="runNow(row)"
            >
              <Play :size="14" />
              <span class="action-label">{{ t("action.runNow") }}</span>
            </el-button>
            <el-button
              text
              size="small"
              :title="t('action.history')"
              :aria-expanded="historyRow === row.id"
              @click="toggleHistory(row.id)"
            >
              <History :size="14" />
              <span class="action-label">{{ t("action.history") }}</span>
            </el-button>
            <el-button text size="small" :disabled="busy.has(row.id)" :title="t('action.edit')" @click="editing = row">
              <Pencil :size="14" />
              <span class="action-label">{{ t("action.edit") }}</span>
            </el-button>
            <el-button
              text
              size="small"
              type="danger"
              :disabled="busy.has(row.id)"
              :title="t('action.delete')"
              @click="remove(row)"
            >
              <Trash2 :size="14" />
              <span class="action-label">{{ t("action.delete") }}</span>
            </el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column type="expand" width="1" class-name="expand-hidden">
        <template #default="{ row }">
          <PlatformScheduleRuns
            v-if="historyRow === row.id"
            :ref="(instance) => (histories[row.id] = instance as { reload: () => Promise<void> } | null)"
            :api="api"
            :task="row"
            :t="t"
            @open-session="emit('openSession', $event)"
          />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="formOpen"
      :title="editing ? t('editTask') : t('newTask')"
      width="640px"
      destroy-on-close
      :close-on-click-modal="!saving"
    >
      <PlatformScheduleForm
        v-if="editing !== undefined"
        :task="editing"
        :agents="agents"
        :functions="functions"
        :time-zone="timeZone"
        :default-agent-id="agentId ?? null"
        :locale="locale"
        :saving="saving"
        :t="t"
        @submit="submit"
        @cancel="editing = undefined"
      />
    </el-dialog>
  </div>
</template>

<style scoped>
.schedules {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  min-height: var(--control-height);
}
.app-filter {
  width: 180px;
}
.scoped-note {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.table {
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
}
.name,
.what {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
}
.caption {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}
.state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}
.actions .el-button {
  margin-left: 0;
  padding: 0 var(--spacing-xs);
}
.action-label {
  margin-left: var(--spacing-xs);
}
.note {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link, var(--el-color-primary));
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.skeleton span {
  height: var(--table-row-height);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
}
/* The history sits under its row; the expand column only carries it, so its arrow stays out of the way. */
:deep(.expand-hidden) {
  display: none;
}
@media (max-width: 760px) {
  .action-label {
    display: none;
  }
}
</style>
