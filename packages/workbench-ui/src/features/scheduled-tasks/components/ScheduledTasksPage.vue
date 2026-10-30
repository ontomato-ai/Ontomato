<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { History, Mail, Pencil, Play, Plus, Trash2 } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { ScheduledTask, ScheduledTaskInput } from "@ontomato/contracts/scheduled-tasks";
import { errorCode, scheduledTasksApi } from "../api";
import { describeFrequency } from "../frequency";
import { useRunLabels } from "../labels";
import ScheduledTaskForm from "./ScheduledTaskForm.vue";
import ScheduledTaskRuns from "./ScheduledTaskRuns.vue";

/**
 * The user's scheduled tasks in this domain: each runs a prompt with an agent on a schedule, every run in a new
 * conversation. Opening this page with a valid login also renews a background credential that stopped working.
 */
const emit = defineEmits<{ openSession: [target: { agentId: string; sessionId: string }] }>();
const { t, locale } = useI18n();
const labels = useRunLabels();

const tasks = ref<ScheduledTask[]>([]);
const agents = ref<AgentHostAgent[]>([]);
const timeZone = ref("");
const state = ref<"loading" | "ready" | "error">("loading");
/** undefined: the form is closed; null: registering a new task. */
const editing = ref<ScheduledTask | null | undefined>(undefined);
const saving = ref(false);
const busy = ref(new Set<string>());
const historyOpen = ref(new Set<string>());
const histories = ref<Record<string, { reload: () => Promise<void> } | null>>({});

const agentName = (id: string) => agents.value.find((agent) => agent.id === id)?.name ?? t("scheduledTasks.unknownAgent");
const formOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined;
  },
});

async function load() {
  state.value = "loading";
  try {
    const [list, agentList] = await Promise.all([scheduledTasksApi.list(), scheduledTasksApi.agents()]);
    tasks.value = list.tasks;
    timeZone.value = list.timeZone;
    agents.value = agentList;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

function failure(error: unknown) {
  const code = errorCode(error);
  const known: Record<string, string> = {
    AGENT_DISABLED: "scheduledTasks.failure.agentDisabled",
    NOT_FOUND: "scheduledTasks.failure.notFound",
    SCHEDULED_TASK_LIMIT: "scheduledTasks.failure.limit",
    SCHEDULED_TASK_BUSY: "scheduledTasks.failure.busy",
    LOGIN_REQUIRED: "scheduledTasks.failure.loginRequired",
  };
  ElMessage.error(code && known[code] ? t(known[code]) : t("scheduledTasks.failure.request"));
}

function replace(task: ScheduledTask) {
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

async function submit(input: ScheduledTaskInput) {
  saving.value = true;
  try {
    const current = editing.value;
    replace(current ? await scheduledTasksApi.update(current.id, input) : await scheduledTasksApi.create(input));
    editing.value = undefined;
  } catch (error) {
    failure(error);
  } finally {
    saving.value = false;
  }
}

function toggle(task: ScheduledTask, enabled: boolean) {
  void act(task.id, async () => replace(await scheduledTasksApi.setEnabled(task.id, enabled)));
}

function runNow(task: ScheduledTask) {
  void act(task.id, async () => {
    const run = await scheduledTasksApi.runNow(task.id);
    replace({ ...task, lastRun: run });
    if (run.status === "failed") ElMessage.warning(labels.error(run.error!));
    else ElMessage.success(t("scheduledTasks.runStarted"));
    await histories.value[task.id]?.reload();
  });
}

async function remove(task: ScheduledTask) {
  try {
    await ElMessageBox.confirm(t("scheduledTasks.deleteConfirm"), t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  void act(task.id, async () => {
    await scheduledTasksApi.remove(task.id);
    tasks.value = tasks.value.filter((known) => known.id !== task.id);
  });
}

function toggleHistory(id: string) {
  const next = new Set(historyOpen.value);
  if (!next.delete(id)) next.add(id);
  historyOpen.value = next;
}

onMounted(() => void load());
</script>

<template>
  <div class="scheduled-tasks">
    <header class="head">
      <div>
        <h2>{{ t("scheduledTasks.title") }}</h2>
        <p>{{ t("scheduledTasks.intro") }}</p>
      </div>
      <el-button type="primary" :disabled="state !== 'ready'" @click="editing = null">
        <Plus :size="16" />
        <span>{{ t("scheduledTasks.newTask") }}</span>
      </el-button>
    </header>

    <div v-if="state === 'loading' && tasks.length === 0" class="skeleton" aria-busy="true"><span /><span /></div>
    <div v-else-if="state === 'error'" class="note">
      {{ t("scheduledTasks.loadFailed") }}
      <button type="button" class="link" @click="load">{{ t("common.retry") }}</button>
    </div>
    <el-empty v-else-if="tasks.length === 0" :description="t('scheduledTasks.empty')" />
    <ul v-else class="list">
      <li v-for="task in tasks" :key="task.id" class="task">
        <div class="task-main">
          <p class="prompt" :title="task.prompt">{{ task.prompt }}</p>
          <div class="meta">
            <span>{{ agentName(task.agentId) }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ describeFrequency(task.frequency, t, locale) }}</span>
            <span v-if="task.notifyEmail" class="mail" :title="task.notifyEmail">
              <Mail :size="13" aria-hidden="true" />
              <span class="sr-only">{{ t("scheduledTasks.mail") }}</span>
            </span>
          </div>
          <div class="status">
            <el-tag size="small" effect="plain" :type="task.pausedReason ? 'warning' : task.enabled ? 'success' : 'info'">
              {{ labels.taskState(task) }}
            </el-tag>
            <span v-if="task.nextRunAt">{{ t("scheduledTasks.nextRun", { time: labels.time(task.nextRunAt) }) }}</span>
            <span v-if="task.lastRun" class="last">
              {{ t("scheduledTasks.lastRun", { time: labels.time(task.lastRun.startedAt) }) }}
              <el-tag size="small" effect="plain" :type="labels.statusType(task.lastRun.status)">
                {{ labels.status(task.lastRun.status) }}
              </el-tag>
            </span>
          </div>
        </div>
        <div class="actions">
          <el-button
            v-if="task.enabled && task.pausedReason"
            size="small"
            :disabled="busy.has(task.id)"
            @click="toggle(task, true)"
          >
            {{ t("scheduledTasks.resume") }}
          </el-button>
          <el-switch
            :model-value="task.enabled"
            :loading="busy.has(task.id)"
            :aria-label="t('scheduledTasks.toggle')"
            @update:model-value="toggle(task, Boolean($event))"
          />
          <el-button text :disabled="busy.has(task.id)" :title="t('scheduledTasks.runNow')" @click="runNow(task)">
            <Play :size="15" />
            <span class="action-label">{{ t("scheduledTasks.runNow") }}</span>
          </el-button>
          <el-button text :title="t('scheduledTasks.history')" :aria-expanded="historyOpen.has(task.id)" @click="toggleHistory(task.id)">
            <History :size="15" />
            <span class="action-label">{{ t("scheduledTasks.history") }}</span>
          </el-button>
          <el-button text :title="t('common.edit')" :disabled="busy.has(task.id)" @click="editing = task">
            <Pencil :size="15" />
            <span class="action-label">{{ t("common.edit") }}</span>
          </el-button>
          <el-button text type="danger" :title="t('common.delete')" :disabled="busy.has(task.id)" @click="remove(task)">
            <Trash2 :size="15" />
            <span class="action-label">{{ t("common.delete") }}</span>
          </el-button>
        </div>
        <ScheduledTaskRuns
          v-if="historyOpen.has(task.id)"
          :ref="(instance) => (histories[task.id] = instance as { reload: () => Promise<void> } | null)"
          class="history"
          :task-id="task.id"
          @open-session="emit('openSession', { agentId: task.agentId, sessionId: $event })"
        />
      </li>
    </ul>

    <el-dialog
      v-model="formOpen"
      :title="editing ? t('scheduledTasks.editTask') : t('scheduledTasks.newTask')"
      width="560px"
      destroy-on-close
    >
      <ScheduledTaskForm
        v-if="editing !== undefined"
        :task="editing"
        :agents="agents"
        :time-zone="timeZone"
        :saving="saving"
        @submit="submit"
        @cancel="editing = undefined"
      />
    </el-dialog>
  </div>
</template>

<style scoped>
.scheduled-tasks {
  max-width: 920px;
  margin: 0 auto;
  padding: 24px 24px 40px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.head h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.head p {
  margin: 4px 0 0;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.head .el-button span {
  margin-left: 4px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.task {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: var(--el-bg-color);
}
.task-main {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta,
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.mail {
  display: inline-flex;
}
.last {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.actions .el-button {
  margin-left: 0;
  padding: 6px 8px;
}
.action-label {
  margin-left: 4px;
}
.history {
  flex-basis: 100%;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.note {
  font-size: var(--text-sm);
  color: var(--el-text-color-tertiary);
}
.link {
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skeleton span {
  height: 88px;
  border-radius: 14px;
  background: var(--el-fill-color);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 760px) {
  .scheduled-tasks {
    padding: 16px;
  }
  .action-label {
    display: none;
  }
}
</style>
