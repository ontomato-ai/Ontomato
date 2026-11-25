import { computed, nextTick, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOperation, usePanelOutput } from "@ontomato/sdk/panel";

const TASK = "platform:ScheduledTask";

await mountPanel({
  setup() {
    const { instance, t, notify, navigate } = usePanelContext();
    const values = instance.state.values;
    const selected = computed(() => values.value.selectedTask ?? null);
    const selectedId = computed(() => selected.value?.primaryKey ?? null);
    const runId = computed(() => values.value.runId ?? null);

    // Read-only outputs from official projections.
    const noticeCanCreate = usePanelOutput("pageNotice", "canCreate");
    const noticeBlockedReason = usePanelOutput("pageNotice", "createBlockedReason");
    const noticeCredentialPaused = usePanelOutput("pageNotice", "hasCredentialPaused");

    const tasksStatus = usePanelOutput("tasks", "status");
    const detailStatus = usePanelOutput("detailHeader", "status");
    const detailLabel = usePanelOutput("detailHeader", "label");
    const detailRevision = usePanelOutput("detailHeader", "revision");
    const detailPauseCode = usePanelOutput("detailHeader", "pauseCode");
    const detailLatestResultPath = usePanelOutput("detailHeader", "latestResultPath");
    const detailRunning = usePanelOutput("detailHeader", "isRunning");

    const historyListed = usePanelOutput("history", "listed");
    const focusStatus = usePanelOutput("focus", "status");
    const focusResultPath = usePanelOutput("focus", "resultPath");
    const focusRunning = usePanelOutput("focus", "isRunning");

    const opRenew = usePanelOperation("renew", "renewCredential", { entry: false });
    const renewalProblem = ref("");
    const schedulePage = ref(null);
    const createButton = ref(null);
    const historyRecords = ref(null);

    const canCreate = computed(() => noticeCanCreate.value !== false);
    const createBlockedReason = computed(() =>
      typeof noticeBlockedReason.value === "string" ? noticeBlockedReason.value : "",
    );
    const hasCredentialPaused = computed(() => noticeCredentialPaused.value === true);
    const showCredentialBanner = computed(() => Boolean(renewalProblem.value && hasCredentialPaused.value));

    // Assistants use page state (`compose: "new"` or `compose: "edit"`) to open the owner's form before calling `fill_form`.
    const mode = computed(() => {
      if (values.value.compose === "new") return "create";
      return values.value.compose === "edit" && selected.value ? "edit" : "view";
    });
    const formDialogOpen = computed(() => mode.value === "create" || mode.value === "edit");

    // Independent right-side run records drawer state (SC-11, SC-12).
    const runsDrawerOpen = ref(Boolean(selected.value && mode.value === "view"));
    const expandedRunIds = ref([]);
    const isRunning = computed(() => Boolean(detailRunning.value || focusRunning.value));

    const searchModel = computed({
      get: () => (typeof values.value.search === "string" ? values.value.search : ""),
      set: (next) => instance.state.set("search", typeof next === "string" ? next : ""),
    });
    const hasActiveFilters = computed(() => Boolean(values.value.app || searchModel.value.trim()));
    function clearFilters() {
      instance.state.setState({ app: "", search: "" });
    }

    const runsDrawerTitle = computed(() => {
      const label = typeof detailLabel.value === "string" && detailLabel.value.trim()
        ? detailLabel.value.trim()
        : "";
      return label ? t("runs.titleFor", { title: label }) : t("runs.title");
    });

    const focusIsOffPage = computed(() => {
      if (!runId.value) return false;
      const items = Array.isArray(historyListed.value) ? historyListed.value : [];
      return !items.some((entry) => entry && typeof entry === "object" && entry.primaryKey === runId.value);
    });

    let lastFocusElement = null;
    function rememberFocus() {
      const active = document.activeElement;
      if (active instanceof HTMLElement) lastFocusElement = active;
    }
    function restoreFocusAfterForm() {
      const target = lastFocusElement;
      lastFocusElement = null;
      if (target && target.isConnected) {
        target.focus();
      } else {
        schedulePage.value?.querySelector(".sdk-sts-card.is-selected button")?.focus();
      }
    }

    function setMode(next) {
      const compose = next === "create" ? "new" : next === "edit" ? "edit" : null;
      if ((values.value.compose ?? null) !== compose) instance.state.set("compose", compose);
    }

    // Keep runs drawer synced with deep-linked runId or mode switches.
    watch(mode, (next) => {
      if (next === "create" || next === "edit") {
        runsDrawerOpen.value = false;
      }
    });
    watch(runId, (next) => {
      if (next && selected.value && mode.value === "view") {
        runsDrawerOpen.value = true;
        if (!expandedRunIds.value.includes(next)) {
          expandedRunIds.value = [...expandedRunIds.value, next];
        }
      }
    }, { immediate: true });
    watch(selectedId, (next, prev) => {
      if (next !== prev) expandedRunIds.value = runId.value ? [runId.value] : [];
      if (!next) runsDrawerOpen.value = false;
    });

    // Clear broken deep-linked runId when the owner reports it missing or forbidden.
    watch(focusStatus, (status) => {
      if (runId.value && (status === "empty" || status === "error" || status === "forbidden")) {
        notify({ kind: "warning", text: t("message.linkUnavailable") });
        instance.state.set("runId", null);
      }
    });

    // Declarative auto-reread (SC-13): owners attach rereadAfterMs (30s for active catalog, 5s for active runs).
    // When an active run in the drawer finishes, sync the task cards and counts once.
    watch(isRunning, (active, previous) => {
      if (previous && !active && runsDrawerOpen.value) {
        instance.refresh({ objectTypes: [TASK], objects: [] });
      }
    });

    // ---------- navigation & selection ----------
    function selectTask(id) {
      if (selectedId.value === id) return;
      instance.state.setState({ selectedTask: { className: TASK, primaryKey: id }, runId: null });
    }
    function openResult(path) {
      if (path) navigate(path).catch(() => {});
    }
    function showRecords(id) {
      setMode("view");
      selectTask(id);
      runsDrawerOpen.value = true;
      void nextTick(() => historyRecords.value?.scrollIntoView({ block: "nearest" }));
    }
    function closeRunsDrawer() {
      runsDrawerOpen.value = false;
      expandedRunIds.value = [];
      if (mode.value === "view") {
        instance.state.setState({ selectedTask: null, runId: null });
      }
    }
    function onRunsDrawerToggle(next) {
      if (!next) closeRunsDrawer();
    }
    function closeFocus() {
      instance.state.set("runId", null);
    }

    // ---------- helpers ----------
    function emptyStateMessage(narrowed) {
      if (!narrowed) return t("empty.none");
      const query = typeof values.value.search === "string" ? values.value.search.trim() : "";
      if (query) return t("empty.search", { query });
      if (values.value.app) return t("empty.app");
      return t("empty.noMatch");
    }

    function fieldOptions(field) {
      const options = field?.control?.options;
      return Array.isArray(options) ? options : [];
    }

    function outcomeOf(receipt) {
      if (!receipt || typeof receipt !== "object") return { kind: "unknown" };
      if (receipt.decision === "cancel") return { kind: "cancel" };
      const response = receipt.response ?? receipt;
      if (response?.kind === "not-dispatched") return { kind: "refusal", message: response.message };
      return response?.outcome ?? receipt.outcome ?? { kind: "unknown" };
    }
    function refusalText(outcome) {
      return outcome.message || outcome.code || t("message.unconfirmed");
    }
    function notifyActionError(error) {
      notify({ kind: "error", text: t("message.refused", { reason: error?.message ?? String(error) }) });
    }
    function runReason(error) {
      if (!error) return "";
      const detail = error.message?.trim();
      const category = error.code ? t(`runError.${error.code}`) : "";
      if (category && detail && detail !== category) return `${category}: ${detail}`;
      return category || detail || "";
    }
    function handleTaskGone(taskId) {
      notify({ kind: "warning", text: t("message.gone") });
      if (selectedId.value === taskId) {
        runsDrawerOpen.value = false;
        setMode("view");
        instance.state.setState({ selectedTask: null, runId: null });
      }
      instance.refreshObjects();
    }
    function refused(outcome, taskId = null) {
      if (outcome.kind === "cancel") return;
      if (outcome.code === "TASK_NOT_FOUND") {
        handleTaskGone(taskId ?? selectedId.value);
        return;
      }
      if (outcome.code === "REVISION_CONFLICT") {
        notify({ kind: "warning", text: t("message.conflict") });
        instance.refreshObjects();
        return;
      }
      if (outcome.kind === "unknown") {
        notify({ kind: "warning", text: t("message.unconfirmed") });
        return;
      }
      notify({ kind: "error", text: t("message.refused", { reason: refusalText(outcome) }) });
    }

    // ---------- credential renewal on mount (SC-07) ----------
    async function renewCredential() {
      try {
        const receipt = await opRenew.run({});
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          renewalProblem.value = "";
          instance.refreshObjects();
        } else if (outcome.kind === "refusal") {
          renewalProblem.value = refusalText(outcome);
        }
      } catch (error) {
        renewalProblem.value = error?.message ?? String(error);
      }
    }
    onMounted(() => {
      if (opRenew.operation.value) return void renewCredential();
      const stop = watch(opRenew.operation, (operation) => {
        if (!operation) return;
        stop();
        void renewCredential();
      });
    });

    // ---------- card row operation outcomes (SC-14) ----------
    function notifyRunNowOutcome(outcome, taskId) {
      const run = outcome.data;
      if (run?.status === "completed") {
        notify({ kind: "success", text: t("message.runCompleted") });
      } else if (run?.status === "skipped") {
        notify({ kind: "warning", text: t("message.runSkipped", { reason: runReason(run.error) }) });
      } else if (run?.status === "failed") {
        notify({ kind: "error", text: t("message.runFailed", { reason: runReason(run.error) }) });
      } else {
        notify({ kind: "info", text: t("message.runStarted") });
      }
      instance.refreshObjects();
      if (run?.id && runsDrawerOpen.value && selectedId.value === taskId) {
        instance.state.set("runId", run.id);
      }
    }

    function onTaskOperationDone(operation, outcome, rowRef) {
      const taskId = rowRef?.primaryKey ?? null;
      if (!outcome || outcome.kind !== "success") {
        if (operation === "runNow" && outcome?.code === "TASK_RUNNING") {
          notify({ kind: "info", text: t("message.runActive") });
          if (taskId) showRecords(taskId);
          const active = outcome.details?.activeRunId;
          if (typeof active === "string" && active) instance.state.set("runId", active);
          return;
        }
        refused(outcome ?? { kind: "unknown" }, taskId);
        return;
      }
      if (operation === "runNow") {
        const run = outcome.data;
        instance.refreshObjects();
        if (run?.id && runsDrawerOpen.value && selectedId.value === taskId) {
          instance.state.set("runId", run.id);
        }
        return;
      }
      if (operation === "setEnabled") {
        const task = outcome.data;
        if (task?.enabled && task.pause) {
          notify({ kind: "warning", text: t("message.stillPaused", { reason: task.pause.message }) });
        }
        instance.refreshObjects();
        return;
      }
      if (operation === "delete") {
        if (taskId && selectedId.value === taskId) {
          runsDrawerOpen.value = false;
          expandedRunIds.value = [];
          setMode("view");
          instance.state.setState({ selectedTask: null, runId: null });
        }
        instance.refreshObjects();
      }
    }

    // ---------- assistant-compatible selected-task operations ----------
    const canOperateSelected = () => Boolean(selected.value && detailStatus.value === "ready");
    const opEnable = usePanelOperation("opEnable", "setEnabled", {
      available: canOperateSelected,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind !== "success") return refused(outcome, selectedId.value);
        const task = outcome.data;
        if (task?.enabled && task.pause) {
          notify({ kind: "warning", text: t("message.stillPaused", { reason: task.pause.message }) });
        } else {
          notify({ kind: "success", text: task?.enabled ? t("message.enabled") : t("message.disabled") });
        }
        instance.refreshObjects();
      },
      onError: notifyActionError,
    });
    const opRunNow = usePanelOperation("opRunNow", "runNow", {
      available: canOperateSelected,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          notifyRunNowOutcome(outcome, selectedId.value);
          return;
        }
        if (outcome.code === "TASK_RUNNING") {
          notify({ kind: "info", text: t("message.runActive") });
          if (selectedId.value) showRecords(selectedId.value);
          const active = outcome.details?.activeRunId;
          if (typeof active === "string" && active) instance.state.set("runId", active);
          return;
        }
        refused(outcome, selectedId.value);
      },
      onError: notifyActionError,
    });
    const opDelete = usePanelOperation("opDelete", "delete", {
      available: canOperateSelected,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind !== "success") return refused(outcome, selectedId.value);
        runsDrawerOpen.value = false;
        setMode("view");
        instance.state.setState({ selectedTask: null, runId: null });
        notify({ kind: "success", text: outcome.message });
        instance.refreshObjects();
      },
      onError: notifyActionError,
    });

    // ---------- task card interactions ----------
    function waitFor(predicate, timeout = 8_000) {
      return new Promise((resolve, reject) => {
        if (predicate()) return resolve();
        const timerId = setTimeout(() => {
          stop();
          reject(new Error(t("message.notReady")));
        }, timeout);
        const stop = watch(predicate, (ok) => {
          if (!ok) return;
          clearTimeout(timerId);
          stop();
          resolve();
        });
      });
    }

    async function openTaskLatestResult(taskId) {
      selectTask(taskId);
      await nextTick();
      try {
        await waitFor(() => selectedId.value === taskId && detailStatus.value === "ready");
        if (typeof detailLatestResultPath.value === "string" && detailLatestResultPath.value) {
          openResult(detailLatestResultPath.value);
        }
      } catch (error) {
        notifyActionError(error);
      }
    }

    function onSelectTask(task) {
      const taskId = task?.id ?? task?.ref?.primaryKey;
      if (taskId) showRecords(taskId);
    }

    function onTaskRowAction(id, task) {
      const taskId = task?.id ?? task?.ref?.primaryKey;
      if (!taskId) return;
      if (id === "review" || id === "edit") {
        rememberFocus();
        runsDrawerOpen.value = false;
        selectTask(taskId);
        setMode("edit");
      } else if (id === "records" || id === "recordsQuick") {
        showRecords(taskId);
      } else if (id === "viewResult" || id === "viewEarlierResult") {
        void openTaskLatestResult(taskId);
      }
    }

    function toggleRunExpanded(id) {
      if (!id) return;
      if (expandedRunIds.value.includes(id)) {
        expandedRunIds.value = expandedRunIds.value.filter((item) => item !== id);
      } else {
        expandedRunIds.value = [...expandedRunIds.value, id];
      }
    }
    function onExpandedRunsChange(keys) {
      expandedRunIds.value = Array.isArray(keys) ? [...keys] : [];
    }
    function onChooseRun(chosen) {
      if (chosen?.primaryKey) toggleRunExpanded(chosen.primaryKey);
    }
    function onRunRowAction({ id, ref: rowRef }) {
      if (id === "details" && rowRef?.primaryKey) {
        toggleRunExpanded(rowRef.primaryKey);
      }
    }

    // ---------- create / edit dialog & conflict recovery (SC-08, SC-09, SC-10) ----------
    function startCreate() {
      if (!canCreate.value) return;
      rememberFocus();
      runsDrawerOpen.value = false;
      instance.state.set("compose", "new");
    }
    function openEdit() {
      rememberFocus();
      runsDrawerOpen.value = false;
      setMode("edit");
    }
    function closeFormDialog() {
      setMode("view");
    }
    function onFormDialogToggle(next) {
      if (!next) closeFormDialog();
    }
    async function requestCancelEdit() {
      if (instance.forms.dirty("editForm")) {
        const discarded = await instance.forms.reset("editForm", { confirm: true });
        if (!discarded) return;
      }
      closeFormDialog();
    }
    async function recomputeForm(slotName) {
      const handle = instance.forms.handle(slotName);
      if (!handle) return;
      try {
        await handle.refreshDraft();
      } catch (error) {
        notifyActionError(error);
      }
    }
    async function loadLatestEdit(discard) {
      const handle = instance.forms.handle("editForm");
      if (handle) {
        try {
          await handle.reset({ confirm: false });
          instance.refreshObjects();
          return;
        } catch (error) {
          notifyActionError(error);
          return;
        }
      }
      if (typeof discard === "function") await discard();
    }
    function saved() {
      closeFormDialog();
      instance.refreshObjects();
      notify({ kind: "success", text: t("message.saved") });
    }
    function created(object) {
      const id = object?.primaryKey;
      instance.state.setState({
        compose: null,
        newTask: null,
        ...(id ? { selectedTask: { className: TASK, primaryKey: id }, runId: null } : {}),
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("message.created") });
    }

    // Keep refs referenced cleanly if inspected by tooling.
    void detailRevision;
    void opEnable;
    void opRunNow;
    void opDelete;

    return {
      t,
      schedulePage,
      createButton,
      historyRecords,
      canCreate,
      createBlockedReason,
      renewalProblem,
      showCredentialBanner,
      selected,
      runId,
      mode,
      formDialogOpen,
      runsDrawerOpen,
      runsDrawerTitle,
      focusIsOffPage,
      detailPauseCode,
      focusResultPath,
      isRunning,
      tasksStatus,
      searchModel,
      hasActiveFilters,
      clearFilters,
      expandedRunIds,
      onExpandedRunsChange,
      emptyStateMessage,
      fieldOptions,
      startCreate,
      openEdit,
      closeFormDialog,
      onFormDialogToggle,
      restoreFocusAfterForm,
      requestCancelEdit,
      recomputeForm,
      loadLatestEdit,
      saved,
      created,
      onSelectTask,
      onTaskRowAction,
      onTaskOperationDone,
      onRunsDrawerToggle,
      closeFocus,
      openResult,
      onChooseRun,
      onRunRowAction,
    };
  },
});
