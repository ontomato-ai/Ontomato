import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { appIcon, mountPanel, usePanelContext, usePanelData, usePanelOperation } from "@ontomato/sdk/panel";

const TASK = "platform:ScheduledTask";
const DAY = 86_400_000;
const ROW_APPS = 5;

await mountPanel({
  setup() {
    const { instance, t, notify, navigate } = usePanelContext();
    const values = instance.state.values;
    const app = computed(() => values.value.app ?? null);
    const selected = computed(() => values.value.selectedTask ?? null);
    const selectedId = computed(() => selected.value?.primaryKey ?? null);
    const runId = computed(() => values.value.runId ?? null);
    const locale = computed(() => document.documentElement.lang || navigator.language || "zh-CN");

    // Owner data, read through the panel's declared projections as the reader.
    const tasksData = usePanelData("tasks", "rows");
    const appsData = usePanelData("apps", "catalog", { size: 100 });
    // The owner's create form: which applications a new task may use, why one may not, and the service's time zone.
    const choicesData = usePanelData("choices", "form");
    const record = usePanelData("detail", "record");
    const form = usePanelData("detail", "form");
    const cursor = ref(null);
    const runsData = usePanelData("history", "runs", () => (cursor.value ? { cursor: cursor.value } : {}));
    const focusData = usePanelData("focus", "run");
    const opEnable = usePanelOperation("opEnable", "setEnabled");
    const opRunNow = usePanelOperation("opRunNow", "runNow");
    const opDelete = usePanelOperation("opDelete", "delete");
    const opRenew = usePanelOperation("renew", "renewCredential");
    const renewalProblem = ref("");

    // Page-local state.
    const search = ref("");
    const schedulePage = ref(null);
    const editPane = ref(null);
    // Draft links use the page state to open the owner's form before it checks the draft.
    const mode = computed(() => {
      if (values.value.compose === "new") return appsProblem.value ? "view" : "create";
      return values.value.compose === "edit" && selected.value ? "edit" : "view";
    });
    function setMode(next) {
      const compose = next === "create" ? "new" : next === "edit" ? "edit" : null;
      if ((values.value.compose ?? null) !== compose) instance.state.set("compose", compose);
    }
    watch([mode, editPane], ([next, pane]) => {
      if (next !== "edit" || !pane) return;
      // The host's template has to make the editor visible before the browser will accept focus.
      requestAnimationFrame(() => {
        if (mode.value === "edit" && editPane.value === pane) pane.focus();
      });
    }, { flush: "post" });
    const busy = ref(new Set());
    const runs = ref([]);
    const nextCursor = ref(null);
    const expanded = ref(new Set());

    // ---------- applications ----------
    const catalog = computed(() => (appsData.value.status === "ready" ? appsData.value.value.rows ?? [] : []));
    const appField = computed(() => {
      const value = choicesData.value.status === "ready" ? choicesData.value.value : null;
      return value?.fields?.find((field) => field.path === "/task/appId") ?? null;
    });
    const appOptions = computed(() => appField.value?.control?.options ?? []);
    const serviceZone = computed(() =>
      choicesData.value.status === "ready" ? choicesData.value.value.values?.task?.timeZone ?? undefined : undefined,
    );
    function localized(map) {
      if (!map) return null;
      const lang = locale.value;
      return map[lang] ?? map[lang.split("-")[0]] ?? map["zh-CN"] ?? map.en ?? Object.values(map)[0] ?? null;
    }
    function appLabel(id) {
      const entry = catalog.value.find((row) => row.id === id);
      return localized(entry?.names) ?? appOptions.value.find((option) => option.value === id)?.label ?? id;
    }
    function applicationIcon(id) {
      return appIcon(catalog.value.find((row) => row.id === id)?.icon ?? "app-window");
    }
    const unavailableApps = computed(() => appOptions.value.filter((option) => option.disabled));
    const appsProblem = computed(() => {
      const status = choicesData.value.status;
      if (status === "error" || status === "forbidden") return t("notice.appsFailed");
      if (status === "ready" && !appOptions.value.some((option) => !option.disabled)) return t("notice.noApplication");
      return null;
    });

    // ---------- task list ----------
    const rows = computed(() => (tasksData.value.status === "ready" ? tasksData.value.value : []));
    const chips = computed(() => {
      const counts = new Map();
      for (const row of rows.value) counts.set(row.fields.application, (counts.get(row.fields.application) ?? 0) + 1);
      const ordered = [...appOptions.value.map((option) => option.value), ...counts.keys()];
      if (app.value) ordered.push(app.value);
      const ids = [...new Set(ordered)].filter((id) => counts.has(id) || id === app.value);
      return [
        { id: null, label: t("filter.all"), count: rows.value.length },
        ...ids.map((id) => ({ id, label: appLabel(id), count: counts.get(id) ?? 0 })),
      ];
    });
    const rowChips = computed(() => chips.value.slice(0, ROW_APPS + 1));
    const moreChips = computed(() => chips.value.slice(ROW_APPS + 1));
    const chosenMore = computed(() => moreChips.value.find(chip => chip.id === app.value));
    const query = computed(() => search.value.trim().toLocaleLowerCase(locale.value));
    const shown = computed(() =>
      rows.value.filter((row) =>
        (!app.value || row.fields.application === app.value) &&
        (!query.value || row.label.toLocaleLowerCase(locale.value).includes(query.value))),
    );
    const emptyText = computed(() =>
      query.value ? t("empty.search", { query: search.value.trim() }) : app.value ? t("empty.app") : t("empty.none"),
    );
    function pickApp(id) {
      instance.state.set("app", id);
    }

    // ---------- formatting ----------
    function dayIn(instant, timeZone) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant);
      const part = (type) => Number(parts.find((candidate) => candidate.type === type)?.value);
      return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
    }
    function moment(iso, timeZone = serviceZone.value) {
      if (!iso) return "";
      const instant = new Date(iso);
      if (Number.isNaN(instant.getTime())) return iso;
      const zone = timeZone || undefined;
      const days = dayIn(instant, zone) - dayIn(new Date(), zone);
      const day = Math.abs(days) <= 1
        ? new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" }).format(days, "day")
        : new Intl.DateTimeFormat(locale.value, { timeZone: zone, month: "short", day: "numeric" }).format(instant);
      const time = new Intl.DateTimeFormat(locale.value, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
      return `${day} ${time}`;
    }
    function duration(ms) {
      const seconds = ms / 1000;
      if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`;
      const whole = Math.round(seconds);
      if (whole < 3600) return `${Math.floor(whole / 60)} min ${whole % 60} s`;
      return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`;
    }
    function taskState(row) {
      const state = row?.fields?.state ?? "";
      if (state === "on") return { kind: "on", label: t("state.on"), reason: null };
      if (state.startsWith("paused")) return { kind: "paused", label: t("state.paused"), reason: state.replace(/^paused:\s*/, "") };
      return { kind: "off", label: t("state.off"), reason: null };
    }
    function nextText(row) {
      const state = taskState(row);
      if (state.kind === "off") return t("state.off");
      if (state.kind === "paused") return t("state.paused");
      return row.fields.nextRun ? t("card.next", { time: moment(row.fields.nextRun, row.fields.timeZone) }) : t("card.noNext");
    }
    function resultPreview(value) {
      return value.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
        .replace(/(\*\*|__|`+)(.*?)\1/g, "$2")
        .replace(/\s+/g, " ").trim();
    }
    const statusLabel = (status) => (status ? t(`runStatus.${status}`) : "");
    const runReason = (error) => (error ? (error.message?.trim() || t(`runError.${error.code}`)) : "");
    const runError = (error) => {
      if (!error) return "";
      const head = t(`runError.${error.code}`);
      const detail = error.message?.trim();
      return detail && detail !== head ? `${head}：${detail}` : head;
    };
    const summaryText = (items) => (items ?? []).map((item) => `${item.label}：${item.value.replace(/\s+/g, " ").trim()}`).join(" · ");

    // ---------- selection and detail ----------
    const detailRow = computed(() => (record.value.status === "ready" ? record.value.value : null));
    const detailForm = computed(() => (form.value.status === "ready" ? form.value.value : null));
    const settings = computed(() => detailForm.value?.values?.task ?? null);
    const revision = computed(() => detailForm.value?.revision ?? null);
    const taskZone = computed(() => settings.value?.timeZone ?? serviceZone.value);
    const paneOpen = computed(() => mode.value === "create" || !!selected.value);

    function select(id) {
      if (selectedId.value === id) return;
      setMode("view");
      instance.state.setState({ selectedTask: { className: TASK, primaryKey: id }, runId: null });
    }
    function closePane() {
      setMode("view");
      instance.state.setState({ selectedTask: null, runId: null });
    }
    function waitFor(predicate, timeout = 10_000) {
      return new Promise((resolve, reject) => {
        if (predicate()) return resolve();
        const timer = setTimeout(() => { stop(); reject(new Error(t("message.notReady"))); }, timeout);
        const stop = watch(predicate, (ok) => {
          if (!ok) return;
          clearTimeout(timer);
          stop();
          resolve();
        });
      });
    }
    /** Card actions run on the selected task: select it, then wait for its owner form, which carries its revision. */
    async function ready(id) {
      select(id);
      await nextTick();
      await waitFor(() => record.value.status === "ready" && record.value.value.primaryKey === id && form.value.status === "ready");
      return form.value.value.revision;
    }

    // ---------- run records ----------
    watch(selectedId, () => {
      cursor.value = null;
      runs.value = [];
      nextCursor.value = null;
      expanded.value = new Set(runId.value ? [runId.value] : []);
    });
    watch(runsData, (state) => {
      if (state.status === "empty") { if (!cursor.value) runs.value = []; nextCursor.value = null; return; }
      if (state.status !== "ready") return;
      const page = state.value;
      if (!cursor.value) runs.value = page.runs;
      else {
        const known = new Set(runs.value.map((run) => run.id));
        runs.value = [...runs.value, ...page.runs.filter((run) => !known.has(run.id))];
      }
      nextCursor.value = page.nextCursor;
    }, { immediate: true });
    const runsLoading = computed(() => runsData.value.status === "loading" && runs.value.length === 0);
    const runsFailure = computed(() => ["error", "forbidden"].includes(runsData.value.status) ? runsData.value : null);
    const loadingMore = computed(() => runsData.value.status === "loading" && !!cursor.value);
    function loadMore() {
      if (nextCursor.value) cursor.value = nextCursor.value;
    }
    const focusRun = computed(() => (focusData.value.status === "ready" ? focusData.value.value : null));
    const pinned = computed(() => (focusRun.value && !runs.value.some((run) => run.id === focusRun.value.id) ? focusRun.value : null));
    const runGroups = computed(() => [
      ...(pinned.value ? [{ key: "linked", runs: [pinned.value] }] : []),
      { key: "history", runs: runs.value },
    ]);
    const historyRecords = ref(null);
    const visibleFocus = computed(() => mode.value === "view" && runId.value &&
      (pinned.value?.id === runId.value || runs.value.some(run => run.id === runId.value)) ? runId.value : null);
    watch(visibleFocus, (id) => {
      if (id) historyRecords.value?.querySelector("[data-run].focused")?.scrollIntoView({ block: "nearest" });
    }, { flush: "post" });
    watch(runId, (id) => { if (id) expanded.value = new Set(expanded.value).add(id); }, { immediate: true });
    watch(focusData, (state) => {
      if (runId.value && ["empty", "error", "forbidden"].includes(state.status)) {
        notify({ kind: "warning", text: t("message.linkUnavailable") });
        instance.state.set("runId", null);
      }
    });
    const latestRun = computed(() => runs.value[0] ?? null);
    const latestResult = computed(() => runs.value.find((run) => run.resultLink) ?? null);
    function toggleRun(id) {
      const next = new Set(expanded.value);
      if (next.has(id)) next.delete(id); else next.add(id);
      expanded.value = next;
    }
    const hasDetails = (run) => run.result !== null || run.executionDetails !== null || (run.snapshot?.summary?.length ?? 0) > 0;
    function openResult(link) {
      if (link?.path) navigate(link.path).catch(() => {});
    }
    function showRecords(id) {
      select(id);
      setMode("view");
      void nextTick(() => historyRecords.value?.scrollIntoView({ block: "nearest" }));
    }

    // ---------- polling while something runs ----------
    const anyRunning = computed(() => rows.value.some((row) => row.fields.lastRun === "running"));
    const detailRunning = computed(() => [...runs.value, ...(pinned.value ? [pinned.value] : [])].some((run) => run.status === "running"));
    let timer = null;
    watch([anyRunning, detailRunning], ([list, detail]) => {
      if (timer) clearInterval(timer);
      timer = list || detail ? setInterval(() => instance.refreshObjects(), detail ? 5000 : 30_000) : null;
    }, { immediate: true });
    onBeforeUnmount(() => { if (timer) clearInterval(timer); });

    // ---------- operations ----------
    function outcomeOf(receipt) {
      if (!receipt || typeof receipt !== "object") return { kind: "unknown" };
      if (receipt.decision === "cancel") return { kind: "cancel" };
      const response = receipt.response ?? receipt;
      if (response?.kind === "not-dispatched") return { kind: "refusal", message: response.message };
      return response?.outcome ?? receipt.outcome ?? { kind: "unknown" };
    }
    async function renewCredential() {
      try {
        const outcome = outcomeOf(await opRenew.run());
        if (outcome.kind !== "success") renewalProblem.value = refusalText(outcome);
      } catch (failure) {
        renewalProblem.value = failure.message;
      }
    }
    onMounted(() => {
      if (opRenew.operation.value) return renewCredential();
      const stop = watch(opRenew.operation, operation => {
        if (!operation) return;
        stop();
        return renewCredential();
      });
    });
    function refusalText(outcome) {
      return outcome.message || outcome.code || t("message.unconfirmed");
    }
    async function act(id, work) {
      if (busy.value.has(id)) return;
      busy.value = new Set(busy.value).add(id);
      try {
        await work();
      } catch (error) {
        notify({ kind: "error", text: t("message.refused", { reason: error?.message ?? String(error) }) });
      } finally {
        const next = new Set(busy.value);
        next.delete(id);
        busy.value = next;
      }
    }
    function refused(outcome) {
      if (outcome.kind === "cancel") return;
      if (outcome.kind === "unknown") { notify({ kind: "warning", text: t("message.unconfirmed") }); return; }
      if (outcome.code === "REVISION_CONFLICT") {
        instance.refreshObjects();
        notify({ kind: "warning", text: t("message.conflict") });
        return;
      }
      notify({ kind: "error", text: t("message.refused", { reason: refusalText(outcome) }) });
    }
    function toggle(row, enabled) {
      return act(row.primaryKey, async () => {
        const rev = await ready(row.primaryKey);
        const outcome = outcomeOf(await opEnable.run({ enabled, revision: rev }));
        if (outcome.kind !== "success") return refused(outcome);
        const pause = outcome.data?.pause;
        if (enabled && pause) notify({ kind: "warning", text: t("message.stillPaused", { reason: pause.message }) });
        else notify({ kind: "success", text: t(enabled ? "message.enabled" : "message.disabled") });
      });
    }
    function runNow(row) {
      return act(row.primaryKey, async () => {
        await ready(row.primaryKey);
        const outcome = outcomeOf(await opRunNow.run({}));
        if (outcome.kind === "success") {
          const run = outcome.data ?? {};
          const reason = runReason(run.error);
          if (run.status === "running") notify({ kind: "success", text: t("message.runStarted") });
          else if (run.status === "completed") notify({ kind: "success", text: t("message.runCompleted") });
          else if (run.status === "skipped") notify({ kind: "warning", text: t("message.runSkipped", { reason }) });
          else notify({ kind: "error", text: t("message.runFailed", { reason }) });
          cursor.value = null;
          return;
        }
        const active = outcome.details?.activeRunId;
        if (outcome.code === "TASK_RUNNING" && active) {
          instance.state.set("runId", active);
          notify({ kind: "info", text: t("message.runActive") });
          showRecords(row.primaryKey);
          return;
        }
        refused(outcome);
      });
    }
    // The platform asks the reader to confirm a delete, with the owner's impact (the task and its run records).
    function askDelete(row) {
      return act(row.primaryKey, async () => {
        const rev = await ready(row.primaryKey);
        const outcome = outcomeOf(await opDelete.run({ revision: rev }));
        if (outcome.kind !== "success") return refused(outcome);
        setMode("view");
        instance.state.setState({ selectedTask: null, runId: null });
        notify({ kind: "success", text: outcome.message });
      });
    }
    function edit(row) {
      select(row.primaryKey);
      setMode("edit");
    }
    function command(row, name) {
      if (name === "runNow") runNow(row);
      else if (name === "edit") edit(row);
      else if (name === "records") showRecords(row.primaryKey);
      else if (name === "remove") askDelete(row);
    }

    // ---------- forms ----------
    // Writing a task is the owner's form (ObjectForm): its fields, dependent fields, validation, revision and save.
    function saved() {
      setMode("view");
      notify({ kind: "success", text: t("message.saved") });
    }
    function created(object) {
      const id = object?.primaryKey;
      instance.state.setState({ compose: null, newTask: null, ...(id ? { selectedTask: { className: TASK, primaryKey: id }, runId: null } : {}) });
      notify({ kind: "success", text: t("message.created") });
    }
    function cancelForm() {
      setMode("view");
    }
    function closeEditOnEscape(event) {
      if (event.defaultPrevented) return;
      cancelForm();
      void nextTick(() => schedulePage.value?.querySelector(".card.is-selected .card-select")?.focus());
    }
    // A draft an agent prepared opens in the form that took it; the reader saves or discards it there.
    watch(instance.draft, (draft) => {
      if (!draft) return;
      setMode(draft.slot === "newForm" ? "create" : "edit");
    }, { immediate: true });

    const selectedRow = computed(() => rows.value.find((row) => row.primaryKey === selectedId.value) ?? detailRow.value);

    return {
      t, app, search, schedulePage, editPane, rowChips, moreChips, chosenMore, shown, rows, emptyText, tasksData, pickApp, appLabel, applicationIcon, appsProblem, renewalProblem, unavailableApps,
      taskState, nextText, statusLabel, moment, duration, runError, summaryText, resultPreview,
      selected, selectedId, selectedRow, record, form, detailRow, settings, revision, taskZone, paneOpen, mode,
      select, closePane, busy, toggle, runNow, askDelete, edit, command, showRecords,
      runGroups, historyRecords, runsLoading, runsFailure, nextCursor, loadingMore, loadMore, runId, expanded, toggleRun, hasDetails,
      latestRun, latestResult, openResult, saved, created, cancelForm, closeEditOnEscape,
    };
  },
});
