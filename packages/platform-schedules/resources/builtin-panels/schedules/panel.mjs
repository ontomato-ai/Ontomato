import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOperation, usePanelOutput } from "@ontomato/sdk/panel";

const TASK = "platform:ScheduledTask";

await mountPanel({
  setup() {
    const { instance, t, notify, navigate } = usePanelContext();
    const values = instance.state.values;
    const selected = computed(() => values.value.selectedTask ?? null);
    const selectedId = computed(() => selected.value?.primaryKey ?? null);
    const runId = computed(() => values.value.runId ?? null);

    // Read-only outputs from official projections (zero raw record reads).
    const listedTasks = usePanelOutput("tasks", "listed");
    const detailStatus = usePanelOutput("detailHeader", "status");
    const detailRevision = usePanelOutput("detailHeader", "revision");
    const detailEnabled = usePanelOutput("detailHeader", "enabled");
    const detailPauseCode = usePanelOutput("detailHeader", "pauseCode");
    const detailLatestResultPath = usePanelOutput("detailHeader", "latestResultPath");
    const detailRunning = usePanelOutput("detailHeader", "isRunning");
    const focusStatus = usePanelOutput("focus", "status");
    const focusResultPath = usePanelOutput("focus", "resultPath");
    const focusRunning = usePanelOutput("focus", "isRunning");

    const opRenew = usePanelOperation("renew", "renewCredential", { entry: false });
    const renewalProblem = ref("");
    const schedulePage = ref(null);
    const editPane = ref(null);
    const historyRecords = ref(null);
    const preparing = ref(false);

    // Assistants use page state (`compose: "new"` or `compose: "edit"`) to open the owner's form before calling `fill_form`.
    const mode = computed(() => {
      if (values.value.compose === "new") return "create";
      return values.value.compose === "edit" && selected.value ? "edit" : "view";
    });
    const paneOpen = computed(() => mode.value === "create" || Boolean(selected.value));
    const detailReady = computed(() => detailStatus.value === "ready");
    const isRunning = computed(() => Boolean(detailRunning.value || focusRunning.value));

    function setMode(next) {
      const compose = next === "create" ? "new" : next === "edit" ? "edit" : null;
      if ((values.value.compose ?? null) !== compose) instance.state.set("compose", compose);
    }

    watch([mode, editPane], ([next, pane]) => {
      if (next !== "edit" || !pane) return;
      requestAnimationFrame(() => {
        if (mode.value === "edit" && editPane.value === pane) pane.focus();
      });
    }, { flush: "post" });

    // ---------- selection & navigation ----------
    function selectTask(id) {
      if (selectedId.value === id) return;
      setMode("view");
      instance.state.setState({ selectedTask: { className: TASK, primaryKey: id }, runId: null });
    }
    function closePane() {
      setMode("view");
      instance.state.setState({ selectedTask: null, runId: null });
    }
    function closeFocus() {
      instance.state.set("runId", null);
    }
    function openResult(path) {
      if (path) navigate(path).catch(() => {});
    }
    function showRecords(id) {
      selectTask(id);
      setMode("view");
      void nextTick(() => historyRecords.value?.scrollIntoView({ block: "nearest" }));
    }

    // Clear broken deep-linked runId when the owner reports it missing or forbidden.
    watch(focusStatus, (status) => {
      if (runId.value && (status === "empty" || status === "error" || status === "forbidden")) {
        notify({ kind: "warning", text: t("message.linkUnavailable") });
        instance.state.set("runId", null);
      }
    });

    // ---------- polling while a task run is active ----------
    let timer = null;
    watch(isRunning, (active) => {
      if (timer) clearInterval(timer);
      timer = active ? setInterval(() => instance.refreshObjects(), 5000) : null;
    }, { immediate: true });
    onBeforeUnmount(() => {
      if (timer) clearInterval(timer);
    });

    // ---------- operations ----------
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
      return detail || t(`runError.${error.code}`);
    }
    function refused(outcome) {
      if (outcome.kind === "cancel") return;
      if (outcome.kind === "unknown") {
        notify({ kind: "warning", text: t("message.unconfirmed") });
        return;
      }
      if (outcome.code === "REVISION_CONFLICT") {
        instance.refreshObjects();
        notify({ kind: "warning", text: t("message.conflict") });
        return;
      }
      notify({ kind: "error", text: t("message.refused", { reason: refusalText(outcome) }) });
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
      const stop = watch(opRenew.operation, (operation) => {
        if (!operation) return;
        stop();
        return renewCredential();
      });
    });

    const canOperateSelected = computed(() => Boolean(
      selectedId.value
      && (
        (mode.value === "view" && detailReady.value)
        || (Array.isArray(listedTasks.value) && listedTasks.value.some((item) => item?.primaryKey === selectedId.value))
      ),
    ));
    const isSelectedBusy = (self) => Boolean(
      selectedId.value && (
        preparing.value
        || (self !== "enable" && opEnable.running.value)
        || (self !== "runNow" && opRunNow.running.value)
        || (self !== "delete" && opDelete.running.value)
      ),
    );

    const opEnable = usePanelOperation("opEnable", "setEnabled", {
      available: canOperateSelected,
      busy: () => isSelectedBusy("enable"),
      onSettled(receipt, context) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind !== "success") return refused(outcome);
        const pause = outcome.data?.pause;
        const enabled = Boolean(context.input.enabled);
        if (enabled && pause) notify({ kind: "warning", text: t("message.stillPaused", { reason: pause.message }) });
        else notify({ kind: "success", text: t(enabled ? "message.enabled" : "message.disabled") });
      },
      onError: notifyActionError,
    });

    const opRunNow = usePanelOperation("opRunNow", "runNow", {
      available: canOperateSelected,
      busy: () => isSelectedBusy("runNow"),
      onSettled(receipt, context) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          const run = outcome.data ?? {};
          const reason = runReason(run.error);
          if (run.status === "running") notify({ kind: "success", text: t("message.runStarted") });
          else if (run.status === "completed") notify({ kind: "success", text: t("message.runCompleted") });
          else if (run.status === "skipped") notify({ kind: "warning", text: t("message.runSkipped", { reason }) });
          else notify({ kind: "error", text: t("message.runFailed", { reason }) });
          return;
        }
        const active = outcome.details?.activeRunId;
        if (outcome.code === "TASK_RUNNING" && active) {
          instance.state.set("runId", active);
          notify({ kind: "info", text: t("message.runActive") });
          const targetId = context.target && !Array.isArray(context.target) && context.target.kind === "object"
            ? context.target.primaryKey
            : selectedId.value;
          if (targetId) showRecords(targetId);
          return;
        }
        refused(outcome);
      },
      onError: notifyActionError,
    });

    const opDelete = usePanelOperation("opDelete", "delete", {
      available: canOperateSelected,
      busy: () => isSelectedBusy("delete"),
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind !== "success") return refused(outcome);
        setMode("view");
        instance.state.setState({ selectedTask: null, runId: null });
        notify({ kind: "success", text: outcome.message });
      },
      onError: notifyActionError,
    });

    const selectedBusy = computed(() => Boolean(
      preparing.value || opEnable.running.value || opRunNow.running.value || opDelete.running.value,
    ));

    function waitFor(predicate, timeout = 10_000) {
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

    async function readyRevision(id) {
      selectTask(id);
      await nextTick();
      await waitFor(() => selectedId.value === id && detailStatus.value === "ready" && typeof detailRevision.value === "number");
      return detailRevision.value;
    }

    async function actOnTask(id, prepareWork, runWork) {
      if (selectedBusy.value) return;
      preparing.value = true;
      let prepared;
      try {
        prepared = await prepareWork(id);
      } catch (error) {
        notifyActionError(error);
        return;
      } finally {
        preparing.value = false;
      }
      await runWork(prepared);
    }

    function toggleSelected(enabled) {
      if (!selectedId.value) return;
      return actOnTask(selectedId.value, readyRevision, (rev) => opEnable.run({ enabled, revision: rev }));
    }
    function runNowSelected() {
      if (!selectedId.value) return;
      return actOnTask(selectedId.value, readyRevision, () => opRunNow.run({}));
    }
    function deleteSelected() {
      if (!selectedId.value) return;
      return actOnTask(selectedId.value, readyRevision, (rev) => opDelete.run({ revision: rev }));
    }

    function onTaskRowAction({ id, ref: rowRef }) {
      const taskId = rowRef?.primaryKey;
      if (!taskId) return;
      if (id === "review" || id === "edit") {
        selectTask(taskId);
        setMode("edit");
      } else if (id === "records") {
        showRecords(taskId);
      } else if (id === "runNow") {
        void actOnTask(taskId, readyRevision, () => opRunNow.run({}));
      } else if (id === "delete") {
        void actOnTask(taskId, readyRevision, (rev) => opDelete.run({ revision: rev }));
      }
    }

    function onChooseRun(chosen) {
      if (chosen?.primaryKey) instance.state.set("runId", chosen.primaryKey);
    }
    function onRunRowAction({ id, ref: rowRef }) {
      if (id === "details" && rowRef?.primaryKey) {
        instance.state.set("runId", rowRef.primaryKey);
      }
    }

    // ---------- forms ----------
    function saved() {
      setMode("view");
      notify({ kind: "success", text: t("message.saved") });
    }
    function created(object) {
      const id = object?.primaryKey;
      instance.state.setState({
        compose: null,
        newTask: null,
        ...(id ? { selectedTask: { className: TASK, primaryKey: id }, runId: null } : {}),
      });
      notify({ kind: "success", text: t("message.created") });
    }
    function cancelForm() {
      setMode("view");
    }
    function closeEditOnEscape(event) {
      if (event.defaultPrevented) return;
      cancelForm();
      void nextTick(() => schedulePage.value?.querySelector(".sdk-object-list-card.chosen")?.focus());
    }

    return {
      t,
      schedulePage,
      editPane,
      historyRecords,
      renewalProblem,
      selected,
      runId,
      mode,
      paneOpen,
      detailReady,
      detailEnabled,
      detailPauseCode,
      detailLatestResultPath,
      focusResultPath,
      isRunning,
      selectedBusy,
      closePane,
      closeFocus,
      openResult,
      toggleSelected,
      runNowSelected,
      deleteSelected,
      onTaskRowAction,
      onChooseRun,
      onRunRowAction,
      saved,
      created,
      cancelForm,
      closeEditOnEscape,
      openEdit: () => setMode("edit"),
      startCreate: () => instance.state.set("compose", "new"),
      refresh: () => instance.refreshObjects(),
    };
  },
});
