<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CalendarClock, ChevronDown, Circle, Search } from "lucide-vue-next";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import type {
  PlatformScheduleApplications,
  PlatformTask,
  PlatformTaskRun,
} from "@ontomato/contracts/platform-schedules";
import { createSchedulesApi, scheduleFailure } from "../api";
import { joinApplications } from "../apps";
import { createAttempts } from "../attempts";
import type { PlatformSchedulesHost } from "../host";
import { useScheduleText } from "../text";
import ScheduleCard from "../components/ScheduleCard.vue";
import ScheduleRunsDrawer from "../components/ScheduleRunsDrawer.vue";
import ScheduleTaskDialog from "../components/ScheduleTaskDialog.vue";

/**
 * The scheduled tasks application's page: the caller's tasks as cards, filtered by application and searched by title,
 * with the form that writes a task and the drawer of a task's run records.
 *
 * It draws the content only: the header (the title, its line and the "new task" button) belongs to the frame that
 * mounts it, and it knows no router — the filter and the record a link opens arrive as props, and the page asks for
 * them to change. The service orders the cards (tasks that need attention first) and the page keeps its order.
 */
const props = withDefaults(
  defineProps<{
    host: PlatformSchedulesHost;
    /** The application the reader narrowed to (`?app=`); null shows every application's tasks. */
    app?: string | null;
    /** A link to one task's run records (`?taskId=`), optionally opened at one run (`&runId=`). */
    taskId?: string | null;
    runId?: string | null;
  }>(),
  { app: null, taskId: null, runId: null },
);
const emit = defineEmits<{
  /** The reader picked an application filter; null is "all". */
  selectApp: [appId: string | null];
  /** The run records a link opened were closed, so the address can drop the link. */
  recordsClosed: [];
}>();
const text = useScheduleText();
const { t } = text;
const api = createSchedulesApi(props.host);
const attempts = createAttempts();
/** While a task runs, its card is read again at this pace, so its result shows up without a reload. */
const LIST_REFRESH_MS = 30_000;

const served = shallowRef<PlatformScheduleApplications | null>(null);
const appsState = ref<"loading" | "ready" | "error">("loading");
const tasks = ref<PlatformTask[]>([]);
const serviceZone = ref("");
const tasksState = ref<"loading" | "ready" | "error">("loading");
/** Why the background credential could not be renewed, when it could not. */
const renewal = shallowRef<unknown>(null);
const search = ref("");
const busy = ref(new Set<string>());
/** undefined: no form open; null: a new task; a task: editing it. */
const editing = ref<PlatformTask | null | undefined>(undefined);
const records = shallowRef<{ task: PlatformTask; focusRun: PlatformTaskRun | null } | null>(null);
const drawer = ref<{ reload: () => Promise<void> } | null>(null);
let listSequence = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let disposed = false;

const hostApps = computed(() => props.host.applications());
const joined = computed(() => (served.value ? joinApplications(hostApps.value, served.value) : { apps: [], missing: [] }));
const scheduleApps = computed(() => joined.value.apps);

/** Any application's name and icon as the rail shows them; an ID the rail does not know is shown as it is. */
function appInfo(appId: string) {
  const app = hostApps.value.find((candidate) => candidate.id === appId);
  return app ? { label: app.label, icon: app.icon } : { label: appId, icon: Circle };
}

interface Chip {
  /** null is "all applications". */
  id: string | null;
  label: string;
  /** The caller's tasks there, as the service counts them; null while it is not known. */
  count: number | null;
}
/** At most this many applications stand in the filter row; the others wait behind "more", in the same order. */
const ROW_APPS = 5;
/**
 * The applications to narrow to: the ones holding the caller's tasks, in the rail's order. The one the address narrows
 * to stays even while it holds none, so the filter in force is always on screen.
 */
const appChips = computed<Chip[]>(() => {
  const chips: Chip[] = scheduleApps.value
    .filter((app) => app.taskCount > 0 || app.id === props.app)
    .map((app) => ({ id: app.id, label: app.label, count: app.taskCount }));
  // An address may narrow to an application that no longer declares a form: its own tasks are still the reader's.
  if (props.app && !chips.some((chip) => chip.id === props.app)) {
    chips.push({ id: props.app, label: appInfo(props.app).label, count: null });
  }
  return chips;
});
const rowChips = computed<Chip[]>(() => [
  { id: null, label: t("filter.all"), count: served.value?.totalCount ?? null },
  ...appChips.value.slice(0, ROW_APPS),
]);
const moreChips = computed(() => appChips.value.slice(ROW_APPS));
/** The chosen application when it waits behind "more": the button then carries its name and count. */
const chosenMore = computed(() => moreChips.value.find((chip) => chip.id === props.app) ?? null);

function pick(appId: string | null) {
  if (appId !== props.app) emit("selectApp", appId);
}

/** What keeps the applications from being offered for a new task, shown above the cards until it is resolved. */
const applicationsProblem = computed<string | null>(() => {
  if (appsState.value === "error" && !served.value) return t("notice.applicationsFailed");
  if (joined.value.missing.length > 0) return t("notice.applicationsMissing", { ids: joined.value.missing.join(", ") });
  if (served.value && !scheduleApps.value.some((app) => app.available)) return t("notice.noApplication");
  return null;
});

/** Why a new task cannot be written now; null when it can. */
const createBlocked = computed<string | null>(() => {
  if (applicationsProblem.value) return applicationsProblem.value;
  // A new task runs in the service's zone, which comes with the task list.
  if (!serviceZone.value) return tasksState.value === "error" ? t("loadFailed") : t("notice.loading");
  return null;
});

const notice = computed<{ text: string; retry?: () => void } | null>(() => {
  if (applicationsProblem.value) {
    const retry = appsState.value === "error" ? () => void loadApplications() : undefined;
    return { text: applicationsProblem.value, retry };
  }
  // A refused renewal matters only to the tasks paused on their credential: they stay paused until it is renewed.
  if (renewal.value && tasks.value.some((task) => task.pause?.code === "credential_invalid")) {
    return { text: t("notice.credentialRefused", { reason: text.failure(renewal.value) }) };
  }
  return null;
});

const query = computed(() => search.value.trim().toLocaleLowerCase(text.locale.value));
/** The cards on screen, in the service's order: the search only leaves out the titles that do not match. */
const shown = computed(() =>
  query.value ? tasks.value.filter((task) => task.title.toLocaleLowerCase(text.locale.value).includes(query.value)) : tasks.value,
);
const emptyText = computed(() =>
  query.value ? t("empty.search", { query: search.value.trim() }) : props.app ? t("empty.app") : t("empty.none"),
);
const defaultAppId = computed(() => scheduleApps.value.find((app) => app.id === props.app && app.available)?.id ?? null);

async function loadApplications(quiet = false) {
  if (!quiet) appsState.value = "loading";
  try {
    served.value = await api.applications();
    appsState.value = "ready";
  } catch {
    // A quiet reread that fails keeps the counts the page has; only a first read failing is shown.
    if (!quiet || !served.value) appsState.value = "error";
  }
}

async function loadTasks(quiet = false) {
  const mine = ++listSequence;
  if (!quiet) tasksState.value = "loading";
  try {
    const list = await api.list(props.app);
    if (mine !== listSequence) return;
    tasks.value = list.tasks;
    serviceZone.value = list.timeZone;
    tasksState.value = "ready";
  } catch {
    if (mine === listSequence && !quiet) tasksState.value = "error";
  }
}

/** A link names one task's records, and maybe one run: both are read first, and the drawer opens on what came back. */
async function openLink() {
  const taskId = props.taskId;
  const runId = props.runId;
  if (!taskId) return;
  try {
    const [task, run] = await Promise.all([api.task(taskId), runId ? api.run(taskId, runId) : Promise.resolve(null)]);
    if (taskId !== props.taskId || runId !== props.runId) return;
    records.value = { task, focusRun: run };
  } catch {
    if (taskId !== props.taskId || runId !== props.runId) return;
    ElMessage.warning(t("message.linkUnavailable"));
    emit("recordsClosed");
  }
}

onMounted(async () => {
  void openLink();
  // Renewing first lets the tasks paused on an expired credential come back before the cards are read.
  try {
    await api.renewCredential();
    renewal.value = null;
  } catch (error) {
    renewal.value = error;
  }
  if (disposed) return;
  await Promise.all([loadApplications(), loadTasks()]);
});

watch(
  () => props.app,
  () => {
    tasks.value = [];
    void loadTasks();
  },
);
watch(() => [props.taskId, props.runId], () => void openLink());

const anyRunning = computed(() => tasks.value.some((task) => task.activeRunId !== null || task.lastRun?.status === "running"));
watch(
  anyRunning,
  (running) => {
    if (refreshTimer !== null) clearInterval(refreshTimer);
    refreshTimer = running ? setInterval(() => void loadTasks(true), LIST_REFRESH_MS) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  if (refreshTimer !== null) clearInterval(refreshTimer);
});

/** A card takes the service's newest answer for its task where it stands; the order changes only when the list is read. */
function replace(task: PlatformTask) {
  tasks.value = tasks.value.map((known) => (known.id === task.id ? task : known));
}

function drop(taskId: string) {
  tasks.value = tasks.value.filter((known) => known.id !== taskId);
  void loadApplications(true);
}

async function refreshTask(taskId: string) {
  try {
    replace(await api.task(taskId));
  } catch (error) {
    if (scheduleFailure(error).code === "TASK_NOT_FOUND") drop(taskId);
  }
}

async function act(taskId: string, action: () => Promise<void>) {
  if (busy.value.has(taskId)) return;
  busy.value = new Set(busy.value).add(taskId);
  try {
    await action();
  } finally {
    const next = new Set(busy.value);
    next.delete(taskId);
    busy.value = next;
  }
}

/** A card action the service refused: a stale card is read again, a task that is gone leaves, anything else is said. */
async function refused(task: PlatformTask, error: unknown) {
  const code = scheduleFailure(error).code;
  if (code === "REVISION_CONFLICT") {
    await refreshTask(task.id);
    ElMessage.warning(t("message.changedElsewhere"));
  } else if (code === "TASK_NOT_FOUND") {
    drop(task.id);
    ElMessage.warning(t("message.gone"));
  } else {
    ElMessage.error(text.failure(error));
  }
}

function toggle(task: PlatformTask, enabled: boolean) {
  void act(task.id, async () => {
    try {
      const next = await api.setEnabled(task.id, { enabled, revision: task.revision });
      replace(next);
      // Switching on checks the task again; a task whose cause is still there stays paused, and says why.
      if (enabled && next.pause) ElMessage.warning(t("message.stillPaused", { reason: next.pause.message }));
    } catch (error) {
      await refused(task, error);
    }
  });
}

async function openRecords(task: PlatformTask, runId: string | null = null) {
  let focusRun: PlatformTaskRun | null = null;
  if (runId) focusRun = await api.run(task.id, runId).catch(() => null);
  records.value = { task, focusRun };
}

function announce(run: PlatformTaskRun) {
  const reason = run.error ? text.runReason(run.error) : "";
  if (run.status === "running") ElMessage.success(t("message.runStarted"));
  else if (run.status === "completed") ElMessage.success(t("message.runCompleted"));
  else if (run.status === "skipped") ElMessage.warning(t("message.runSkipped", { reason }));
  else ElMessage.error(t("message.runFailed", { reason }));
}

function runNow(task: PlatformTask) {
  void act(task.id, async () => {
    const scope = `run:${task.id}`;
    try {
      const run = await api.runNow(task.id, attempts.key(scope, task.id));
      attempts.settle(scope);
      announce(run);
      await refreshTask(task.id);
      if (records.value?.task.id === task.id) void drawer.value?.reload();
    } catch (error) {
      const failure = scheduleFailure(error);
      // No answer: the run may have started. The same key goes with the next click, so it is not started twice.
      if (!failure.refusal) {
        ElMessage.warning(t("message.noAnswerRun"));
        return;
      }
      attempts.settle(scope);
      if (failure.code === "TASK_RUNNING" && failure.refusal.activeRunId) {
        await openRecords(task, failure.refusal.activeRunId);
        ElMessage.info(t("message.runActive"));
        return;
      }
      await refused(task, error);
    }
  });
}

async function remove(task: PlatformTask) {
  try {
    await ElMessageBox.confirm(t("message.deleteConfirm", { title: task.title }), t("message.deleteTitle"), {
      type: "warning",
      confirmButtonText: t("action.delete"),
      cancelButtonText: t("form.cancel"),
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  void act(task.id, async () => {
    try {
      await api.remove(task.id, task.revision);
      drop(task.id);
      ElMessage.success(t("message.deleted"));
    } catch (error) {
      await refused(task, error);
    }
  });
}

function openResult(task: PlatformTask) {
  if (task.latestResult) props.host.openResult(task.latestResult.link);
}

function saved(task: PlatformTask, created: boolean) {
  ElMessage.success(t("message.saved"));
  if (!created) replace(task);
  // The service places the task among the others and counts it under its application.
  void Promise.all([loadTasks(true), loadApplications(true)]);
}

function settled() {
  if (records.value) void refreshTask(records.value.task.id);
}

function closeRecords() {
  records.value = null;
  if (props.taskId || props.runId) emit("recordsClosed");
}

/** The header's "new task" button belongs to the frame that mounts the page; this is how it opens the form. */
function openNewTask() {
  if (createBlocked.value) {
    ElMessage.warning(createBlocked.value);
    return;
  }
  editing.value = null;
}
defineExpose({ openNewTask });
</script>

<template>
  <div class="schedules">
    <div class="toolbar">
      <div class="filter-segments" role="group" :aria-label="t('filter.label')">
        <button
          v-for="chip in rowChips"
          :key="chip.id ?? ''"
          type="button"
          class="chip filter-segment"
          :class="{ 'is-active': chip.id === app }"
          :aria-pressed="chip.id === app"
          :data-app="chip.id ?? ''"
          @click="pick(chip.id)"
        >
          <span>{{ chip.label }}</span>
          <span v-if="chip.count !== null" class="count">{{ chip.count }}</span>
        </button>
        <el-dropdown v-if="moreChips.length > 0" class="filter-more" trigger="click" :popper-options="dropdownBoundaryOptions" @command="pick">
          <button type="button" class="chip more filter-segment" :class="{ 'is-active': chosenMore }">
            <span>{{ chosenMore?.label ?? t("filter.more") }}</span>
            <span v-if="chosenMore && chosenMore.count !== null" class="count">{{ chosenMore.count }}</span>
            <ChevronDown :size="14" aria-hidden="true" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="chip in moreChips"
                :key="chip.id!"
                :command="chip.id"
                class="schedule-filter-item"
                :class="{ 'schedule-filter-chosen': chip.id === app }"
                :data-app="chip.id"
              >
                <span>{{ chip.label }}</span>
                <span v-if="chip.count !== null" class="schedule-filter-count">{{ chip.count }}</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <el-input
        v-model="search"
        class="search"
        clearable
        :placeholder="t('filter.search')"
        :aria-label="t('filter.search')"
      >
        <template #prefix><Search :size="16" aria-hidden="true" /></template>
      </el-input>
    </div>

    <el-alert v-if="notice" :title="notice.text" type="warning" :closable="false" show-icon>
      <el-button v-if="notice.retry" text size="small" @click="notice.retry()">{{ t("retry") }}</el-button>
    </el-alert>

    <div v-if="tasksState === 'loading' && tasks.length === 0" class="grid" aria-busy="true">
      <el-skeleton v-for="index in 3" :key="index" class="skeleton schedule-card-placeholder" :rows="3" animated />
    </div>
    <el-alert v-else-if="tasksState === 'error'" :title="t('loadFailed')" type="error" :closable="false" show-icon>
      <el-button text size="small" @click="loadTasks()">{{ t("retry") }}</el-button>
    </el-alert>
    <div v-else-if="shown.length === 0" class="empty" role="status">
      <component :is="query ? Search : CalendarClock" :size="24" aria-hidden="true" />
      <p>{{ emptyText }}</p>
    </div>
    <ul v-else class="grid cards">
      <li v-for="task in shown" :key="task.id">
        <ScheduleCard
          :task="task"
          :app="appInfo(task.appId)"
          :busy="busy.has(task.id)"
          @toggle="toggle(task, $event)"
          @open-result="openResult(task)"
          @run-now="runNow(task)"
          @edit="editing = task"
          @records="openRecords(task)"
          @remove="remove(task)"
        />
      </li>
    </ul>

    <ScheduleTaskDialog
      v-if="editing !== undefined"
      :api="api"
      :task="editing"
      :apps="scheduleApps"
      :app-info="appInfo"
      :service-zone="serviceZone"
      :default-app-id="defaultAppId"
      :attempts="attempts"
      @saved="saved"
      @gone="drop"
      @refreshed="replace"
      @close="editing = undefined"
    />
    <ScheduleRunsDrawer
      v-if="records"
      ref="drawer"
      :key="`${records.task.id}:${records.focusRun?.id ?? ''}`"
      :api="api"
      :task="records.task"
      :focus-run="records.focusRun"
      @open-result="host.openResult($event)"
      @settled="settled"
      @close="closeRecords"
    />
  </div>
</template>

<style scoped>
.schedules {
  display: flex;
  flex-direction: column;
  gap: var(--page-content-gap);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}
.filter-segment {
  font-size: var(--text-sm);
}
.filter-more { min-width: 0; max-width: 100%; }
.filter-more svg { flex: none; }
.count {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.chip.is-active .count {
  color: inherit;
}
/* "More" opens the applications that do not fit in the row, each with its count; the chosen one reads as in the row. */
:global(.el-dropdown-menu__item.schedule-filter-item) {
  justify-content: space-between;
  gap: var(--spacing-lg);
}
:global(.el-dropdown-menu__item.schedule-filter-item .schedule-filter-count) {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
:global(.el-dropdown-menu__item.schedule-filter-chosen) {
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
:global(.el-dropdown-menu__item.schedule-filter-chosen .schedule-filter-count) {
  color: inherit;
}
.search {
  width: 280px;
  max-width: 100%;
}
.empty {
  display: grid;
  justify-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-3xl) var(--spacing-lg);
  text-align: center;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.empty p { margin: 0; min-width: 0; }
/* Cards fill the width three or more to a row; a narrow page takes them one under another. */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
  gap: var(--page-content-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}
.skeleton {
  min-height: 200px;
  box-sizing: border-box;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-lg);
  background: var(--el-bg-color);
}
.cards > li { min-width: 0; }
@media (prefers-reduced-motion: reduce) {
  .skeleton :deep(.el-skeleton__item) { animation: none; }
}
@media (max-width: 760px) {
  .search {
    width: 100%;
  }
}
</style>
