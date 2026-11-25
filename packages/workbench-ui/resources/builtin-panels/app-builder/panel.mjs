import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelContext,
  usePanelOperation,
  usePanelOutputs,
} from "@ontomato/sdk/panel";

function safeJsonArray(raw) {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

await mountPanel({
  setup() {
    const panel = usePanelContext();
    const t = (key, params) => panel.t(key, params);

    const projectOutputs = usePanelOutputs("project");
    const chatOutputs = usePanelOutputs("chat");

    const syncOp = usePanelOperation("project", "sync");
    const restartBuildTestOp = usePanelOperation("project", "restartBuildTest");

    const projectsRef = ref(null);
    const projectRef = ref(null);
    const chatRef = ref(null);
    const sourceFilesRef = ref(null);
    const sourceFileRef = ref(null);
    const sourceDiffRef = ref(null);
    const sourceCommitsRef = ref(null);
    const publishFormRef = ref(null);
    const releasesRef = ref(null);

    const previewReloadKey = ref(0);
    const previewFlashVisible = ref(false);
    const previewSelection = shallowRef([]);
    let flashTimer = null;

    function showPreviewFlash() {
      previewFlashVisible.value = true;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        previewFlashVisible.value = false;
        flashTimer = null;
      }, 3000);
    }

    onBeforeUnmount(() => {
      if (flashTimer) clearTimeout(flashTimer);
    });

    // ---- Panel state bindings ----
    const currentAppRef = computed(() => panel.state.app ?? null);
    const currentAppId = computed(() => currentAppRef.value?.primaryKey ?? null);

    const activeTab = computed(() => panel.state.tab || "preview");
    const paneMode = computed(() => panel.state.pane || "side");
    const selectedCommit = computed(() => panel.state.commit || null);
    const diffMode = computed(() => panel.state.diffMode || "latest");

    const createDialogOpen = computed({
      get: () => Boolean(panel.state.createDialogOpen),
      set: (value) => {
        panel.state.createDialogOpen = Boolean(value);
      },
    });

    const editDialogOpen = computed({
      get: () => Boolean(panel.state.editDialogOpen),
      set: (value) => {
        panel.state.editDialogOpen = Boolean(value);
      },
    });

    const editTargetRef = computed(() => panel.state.editTarget ?? null);

    const publishDrawerOpen = computed({
      get: () => Boolean(panel.state.publishDrawerOpen),
      set: (value) => {
        panel.state.publishDrawerOpen = Boolean(value);
        if (!value) panel.state.publishCommit = null;
      },
    });

    const activePreviewEntryId = computed({
      get: () => panel.state.previewEntryId || "",
      set: (value) => {
        panel.state.previewEntryId = value ? String(value) : null;
      },
    });

    // Keep diffTarget synchronized with commit & diffMode.
    watch(
      [selectedCommit, diffMode],
      ([commit, mode]) => {
        const next = commit || mode || "latest";
        if (panel.state.diffTarget !== next) {
          panel.state.diffTarget = next;
        }
      },
      { immediate: true },
    );

    // Keep selectedSession synchronized with session string state.
    watch(
      () => panel.state.session,
      (sessionId) => {
        const currentKey = panel.state.selectedSession?.primaryKey ?? null;
        if (sessionId && currentKey !== sessionId) {
          panel.state.selectedSession = { objectType: "platform:AgentSession", primaryKey: sessionId };
        } else if (!sessionId && currentKey !== null) {
          panel.state.selectedSession = null;
        }
      },
      { immediate: true },
    );

    // Reset per-app transient view state when switching applications.
    let previousAppId = currentAppId.value;
    watch(currentAppId, (nextAppId) => {
      if (nextAppId === previousAppId) return;
      previousAppId = nextAppId;
      panel.state.file = null;
      panel.state.commit = null;
      panel.state.publishCommit = null;
      panel.state.previewEntryId = null;
      panel.state.previewPage = null;
      previewSelection.value = [];
      if (panel.state.session && panel.state.selectedSession?.primaryKey !== panel.state.session) {
        panel.state.session = null;
      }
    });

    // ---- Project outputs ----
    const currentAppName = computed(() => {
      const name = projectOutputs.value.name;
      return typeof name === "string" && name ? name : (currentAppId.value ?? "");
    });
    const currentAppIcon = computed(() => {
      const icon = projectOutputs.value.icon;
      return typeof icon === "string" && icon ? icon : "app-window";
    });
    const appIconComponent = computed(() => appIcon(currentAppIcon.value));
    const projectPublished = computed(() => projectOutputs.value.published === true);
    const projectOpenPath = computed(() => {
      const val = projectOutputs.value.openPath;
      return typeof val === "string" && val ? val : null;
    });
    const projectManagePath = computed(() => {
      const val = projectOutputs.value.managePath;
      return typeof val === "string" && val ? val : null;
    });
    const projectHeadCommit = computed(() => {
      const val = projectOutputs.value.headCommit;
      return typeof val === "string" && val ? val : null;
    });
    const projectBusy = computed(() => projectOutputs.value.busy === true);
    const chatBusy = computed(() => chatOutputs.value.busy === true);
    const otherSessionBusy = computed(() => projectBusy.value && !chatBusy.value);

    const projectHasDrift = computed(() => projectOutputs.value.hasDrift === true);
    const projectDriftCount = computed(() => Number(projectOutputs.value.driftCount ?? 0));
    const driftItems = computed(() => safeJsonArray(projectOutputs.value.driftItemsJson));

    const projectHasConflicts = computed(() => projectOutputs.value.hasConflicts === true);
    const projectConflictCount = computed(() => Number(projectOutputs.value.conflictCount ?? 0));
    const conflictFiles = computed(() => safeJsonArray(projectOutputs.value.conflictFilesJson));

    const previewEntries = computed(() => safeJsonArray(projectOutputs.value.previewEntriesJson));

    // Auto-select first preview entry for multi-entry panel apps when none is chosen.
    watch(
      previewEntries,
      (entries) => {
        if (entries.length === 0) {
          if (panel.state.previewEntryId !== null) panel.state.previewEntryId = null;
          return;
        }
        const current = panel.state.previewEntryId;
        if (!current || !entries.some((entry) => entry.id === current)) {
          panel.state.previewEntryId = entries[0].id;
        }
      },
      { immediate: true },
    );

    // ---- Build-test status bar ----
    const buildTestStatus = computed(() => String(projectOutputs.value.buildTestStatus || "NONE"));
    const buildTestSampleName = computed(() => String(projectOutputs.value.buildTestSampleName || ""));
    const buildTestCanRestart = computed(() => projectOutputs.value.buildTestCanRestart === true);

    const buildTestTagType = computed(() => {
      switch (buildTestStatus.value) {
        case "READY": return "success";
        case "PREPARE_FAILED": return "danger";
        case "PREPARING": return "warning";
        case "EXPIRED":
        case "CLOSED": return "warning";
        default: return "info";
      }
    });

    const buildTestStatusText = computed(() => {
      const map = {
        NONE: "test.none",
        PREPARING: "test.preparing",
        READY: "test.ready",
        PREPARE_FAILED: "test.failed",
        CLOSED: "test.closed",
        EXPIRED: "test.expired",
        UNAVAILABLE: "test.unavailable",
      };
      return t(map[buildTestStatus.value] || "test.unavailable");
    });

    const buildTestNotice = computed(() => {
      if (buildTestStatus.value === "NONE") {
        return { type: "info", message: t("test.noneHint") };
      }
      if (buildTestStatus.value === "EXPIRED" || buildTestStatus.value === "CLOSED") {
        return { type: "warning", message: t("test.expiredHint") };
      }
      if (buildTestStatus.value === "PREPARE_FAILED") {
        return { type: "error", message: t("test.failedHint") };
      }
      return null;
    });

    // ---- AgentChat context & chips ----
    const chatSessionContext = computed(() => (currentAppId.value ? { appId: currentAppId.value } : undefined));
    const chatGreeting = computed(() => t("chat.greeting", { name: currentAppName.value }));

    const carriedPageChip = computed(() => {
      if (activeTab.value === "preview") {
        const page = panel.state.previewPage || currentAppName.value;
        return `${t("tab.preview")} · ${page}`;
      }
      if (activeTab.value === "files") {
        return panel.state.file ? `${t("tab.files")} · ${panel.state.file}` : t("tab.files");
      }
      if (activeTab.value === "changes") {
        if (selectedCommit.value) return `${t("tab.changes")} · ${shortCommit(selectedCommit.value)}`;
        return `${t("tab.changes")} · ${diffMode.value === "working" ? t("changes.working") : t("changes.latest")}`;
      }
      return t("tab.history");
    });

    const carriedSelectionChip = computed(() => {
      const list = previewSelection.value;
      if (!list.length) return "";
      const first = list[0];
      return first.label || first.primaryKey || "";
    });

    const refreshTooltip = computed(() => {
      const base = t("action.refreshPreview");
      return projectHeadCommit.value ? `${base} (${shortCommit(projectHeadCommit.value)})` : base;
    });

    // ---- Helper functions & actions ----
    function shortCommit(sha) {
      return typeof sha === "string" ? sha.slice(0, 7) : "";
    }

    function outcomeCommit(outcome) {
      if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return "";
      return typeof outcome.commit === "string" ? outcome.commit : "";
    }

    function setTab(nextTab) {
      panel.state.tab = nextTab;
    }

    function setPane(nextPane) {
      panel.state.pane = nextPane;
    }

    function toggleFullPane() {
      panel.state.pane = paneMode.value === "full" ? "side" : "full";
    }

    function selectDiffMode(mode) {
      panel.state.commit = null;
      panel.state.diffMode = mode;
    }

    function startNewConversation(appRef) {
      if (appRef && appRef.primaryKey) {
        panel.state.app = { objectType: "platform:Application", primaryKey: appRef.primaryKey };
      }
      panel.state.session = null;
      panel.state.selectedSession = null;
      if (paneMode.value === "full") {
        panel.state.pane = "side";
      }
    }

    function onChooseSession(appRef, sessionRef) {
      if (!sessionRef || !sessionRef.primaryKey) return;
      if (appRef && appRef.primaryKey && currentAppId.value !== appRef.primaryKey) {
        panel.state.app = { objectType: "platform:Application", primaryKey: appRef.primaryKey };
      }
      panel.state.session = sessionRef.primaryKey;
      panel.state.selectedSession = { objectType: "platform:AgentSession", primaryKey: sessionRef.primaryKey };
      if (paneMode.value === "full") {
        panel.state.pane = "side";
      }
    }

    function openCreateDialog() {
      createDialogOpen.value = true;
    }

    function onDraftCreated(saved) {
      createDialogOpen.value = false;
      if (saved && saved.primaryKey) {
        panel.state.app = { objectType: "platform:Application", primaryKey: saved.primaryKey };
        panel.state.session = null;
        panel.state.selectedSession = null;
        panel.state.tab = "preview";
        if (paneMode.value === "closed") panel.state.pane = "side";
      }
      projectsRef.value?.refresh?.();
    }

    function onProjectRowAction({ id, ref: appRef }) {
      if (!appRef || !appRef.primaryKey) return;
      if (id === "newChat") {
        startNewConversation(appRef);
      } else if (id === "editMeta") {
        panel.state.editTarget = { objectType: "platform:Application", primaryKey: appRef.primaryKey };
        editDialogOpen.value = true;
      }
    }

    function onMetaSaved() {
      editDialogOpen.value = false;
      projectsRef.value?.refresh?.();
      projectRef.value?.refresh?.();
    }

    function openPublishDrawer(commitSha = null) {
      panel.state.publishCommit = commitSha || null;
      publishDrawerOpen.value = true;
      projectRef.value?.refresh?.();
    }

    function onPublished() {
      projectsRef.value?.refresh?.();
      projectRef.value?.refresh?.();
      releasesRef.value?.refresh?.();
      publishFormRef.value?.refresh?.();
    }

    function openCommitChanges(commitSha) {
      if (!commitSha) return;
      panel.state.commit = commitSha;
      panel.state.tab = "changes";
      if (paneMode.value === "closed") {
        panel.state.pane = "side";
      }
    }

    function onCommitRowAction({ id, ref: commitRef }) {
      if (!commitRef || !commitRef.primaryKey) return;
      if (id === "viewDiff") {
        openCommitChanges(commitRef.primaryKey);
      } else if (id === "publishCommit") {
        openPublishDrawer(commitRef.primaryKey);
      }
    }

    function refreshPreview() {
      previewReloadKey.value += 1;
      projectRef.value?.refresh?.();
    }

    function refreshWorkspaceViews() {
      projectRef.value?.refresh?.();
      sourceFilesRef.value?.refresh?.();
      sourceFileRef.value?.refresh?.();
      sourceDiffRef.value?.refresh?.();
      sourceCommitsRef.value?.refresh?.();
      if (publishDrawerOpen.value) {
        publishFormRef.value?.refresh?.();
        releasesRef.value?.refresh?.();
      }
    }

    function onChatRunComplete(payload) {
      refreshWorkspaceViews();
      projectsRef.value?.refresh?.();
      if (payload?.ok) {
        previewReloadKey.value += 1;
        showPreviewFlash();
      }
    }

    function onPreviewContextChange(ctx) {
      panel.state.previewPage = ctx?.page ?? null;
      previewSelection.value = Array.isArray(ctx?.selection) ? ctx.selection : [];
    }

    function onPreviewStatusChange() {
      // Status is displayed directly inside AppPreview; no extra panel action required.
    }

    const syncSourceRunning = computed(() => Boolean(syncOp.running.value));
    async function runSyncSource() {
      await syncOp.run();
      refreshWorkspaceViews();
      previewReloadKey.value += 1;
    }

    const restartTestRunning = computed(() => Boolean(restartBuildTestOp.running.value));
    async function runRestartBuildTest() {
      await restartBuildTestOp.run();
      projectRef.value?.refresh?.();
      previewReloadKey.value += 1;
    }

    function driftStatusLabel(status) {
      if (status === "added") return t("drawer.driftAdded");
      if (status === "removed") return t("drawer.driftRemoved");
      return t("drawer.driftModified");
    }

    function jumpToConflictFile(filePath) {
      publishDrawerOpen.value = false;
      panel.state.file = filePath;
      panel.state.tab = "files";
      if (paneMode.value === "closed") panel.state.pane = "side";
    }

    function openExternalPath(path) {
      if (path) panel.navigate(path);
    }

    function navigateInternal(path) {
      if (path) {
        publishDrawerOpen.value = false;
        panel.navigate(path);
      }
    }

    return {
      t,
      projectsRef,
      projectRef,
      chatRef,
      sourceFilesRef,
      sourceFileRef,
      sourceDiffRef,
      sourceCommitsRef,
      publishFormRef,
      releasesRef,
      currentAppId,
      currentAppName,
      appIconComponent,
      activeTab,
      paneMode,
      selectedCommit,
      diffMode,
      createDialogOpen,
      editDialogOpen,
      editTargetRef,
      publishDrawerOpen,
      activePreviewEntryId,
      previewReloadKey,
      previewFlashVisible,
      projectPublished,
      projectOpenPath,
      projectManagePath,
      otherSessionBusy,
      projectHasDrift,
      projectDriftCount,
      driftItems,
      projectHasConflicts,
      projectConflictCount,
      conflictFiles,
      previewEntries,
      buildTestSampleName,
      buildTestTagType,
      buildTestStatusText,
      buildTestNotice,
      buildTestCanRestart,
      chatSessionContext,
      chatGreeting,
      carriedPageChip,
      carriedSelectionChip,
      refreshTooltip,
      syncSourceRunning,
      restartTestRunning,
      shortCommit,
      outcomeCommit,
      setTab,
      setPane,
      toggleFullPane,
      selectDiffMode,
      startNewConversation,
      onChooseSession,
      openCreateDialog,
      onDraftCreated,
      onProjectRowAction,
      onMetaSaved,
      openPublishDrawer,
      onPublished,
      openCommitChanges,
      onCommitRowAction,
      refreshPreview,
      onChatRunComplete,
      onPreviewContextChange,
      onPreviewStatusChange,
      runSyncSource,
      runRestartBuildTest,
      driftStatusLabel,
      jumpToConflictFile,
      openExternalPath,
      navigateInternal,
    };
  },
});
