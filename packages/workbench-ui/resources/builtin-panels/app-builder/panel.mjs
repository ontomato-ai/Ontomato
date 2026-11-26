import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelContext,
  usePanelOperation,
  usePanelOutputs,
} from "@ontomato/sdk/panel";

const APPLICATION_TYPE = "platform:Application";
const AGENT_SESSION_TYPE = "platform:AgentSession";

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
    const { instance, navigate, t } = usePanelContext();
    const values = instance.state.values;

    const projectsOutputs = usePanelOutputs("projects");
    const projectOutputs = usePanelOutputs("project");
    const chatOutputs = usePanelOutputs("chat");

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
    const currentAppRef = computed(() => values.value.app ?? null);
    const currentAppId = computed(() => currentAppRef.value?.primaryKey ?? null);

    const activeTab = computed(() => (typeof values.value.tab === "string" && values.value.tab ? values.value.tab : "preview"));
    const paneMode = computed(() => (typeof values.value.pane === "string" && values.value.pane ? values.value.pane : "closed"));
    const selectedCommit = computed(() => (typeof values.value.commit === "string" && values.value.commit ? values.value.commit : null));
    const diffMode = computed(() => (typeof values.value.diffMode === "string" && values.value.diffMode ? values.value.diffMode : "latest"));

    const createDialogOpen = computed({
      get: () => values.value.createDialogOpen === true,
      set: (value) => {
        instance.state.set("createDialogOpen", Boolean(value));
      },
    });

    const editDialogOpen = computed({
      get: () => values.value.editDialogOpen === true,
      set: (value) => {
        instance.state.set("editDialogOpen", Boolean(value));
      },
    });

    const editTargetRef = computed(() => values.value.editTarget ?? null);

    const publishDrawerOpen = computed({
      get: () => values.value.publishDrawerOpen === true,
      set: (value) => {
        const next = Boolean(value);
        if (next) {
          instance.state.set("publishDrawerOpen", true);
        } else {
          instance.state.setState({ publishDrawerOpen: false, publishCommit: null });
        }
      },
    });

    const activePreviewEntryId = computed({
      get: () => (typeof values.value.previewEntryId === "string" ? values.value.previewEntryId : ""),
      set: (value) => {
        instance.state.set("previewEntryId", value ? String(value) : null);
      },
    });

    // Keep diffTarget synchronized with commit & diffMode.
    watch(
      [selectedCommit, diffMode],
      ([commit, mode]) => {
        const next = commit || mode || "latest";
        if (values.value.diffTarget !== next) {
          instance.state.set("diffTarget", next);
        }
      },
      { immediate: true },
    );

    // Keep selectedSession synchronized with session string state.
    watch(
      () => values.value.session,
      (sessionId) => {
        const currentKey = values.value.selectedSession?.primaryKey ?? null;
        if (typeof sessionId === "string" && sessionId && currentKey !== sessionId) {
          instance.state.set("selectedSession", { className: AGENT_SESSION_TYPE, primaryKey: sessionId });
        } else if ((!sessionId || typeof sessionId !== "string") && currentKey !== null) {
          instance.state.set("selectedSession", null);
        }
      },
      { immediate: true },
    );

    // Track expanded applications so the active app opens automatically and expanding another selects it.
    let knownExpandedApps = new Set(
      Array.isArray(values.value.expandedApps) ? values.value.expandedApps : [],
    );

    function ensureAppExpanded(appId) {
      if (!appId) return;
      const current = Array.isArray(values.value.expandedApps) ? values.value.expandedApps : [];
      if (current.includes(appId)) {
        knownExpandedApps = new Set(current);
        return;
      }
      const next = [...current, appId];
      knownExpandedApps = new Set(next);
      instance.state.set("expandedApps", next);
    }

    function onProjectsExpandedChange(nextKeys) {
      if (!Array.isArray(nextKeys)) return;
      const prev = knownExpandedApps;
      knownExpandedApps = new Set(nextKeys);
      const added = nextKeys.find((key) => typeof key === "string" && !prev.has(key));
      if (added && added !== currentAppId.value) {
        instance.state.setState({
          app: { className: APPLICATION_TYPE, primaryKey: added },
          session: null,
          selectedSession: null,
        });
      }
    }

    watch(
      currentAppId,
      (nextAppId) => {
        if (nextAppId) ensureAppExpanded(nextAppId);
      },
      { immediate: true },
    );

    // Reset per-app transient view state when switching applications.
    let previousAppId = currentAppId.value;
    watch(currentAppId, (nextAppId) => {
      if (nextAppId === previousAppId) return;
      previousAppId = nextAppId;
      previewSelection.value = [];
      const patch = {
        file: null,
        commit: null,
        publishCommit: null,
        previewEntryId: null,
        previewPage: null,
      };
      if (!instance.state.lastPatchedKeys.has("session")) {
        patch.session = null;
        patch.selectedSession = null;
      }
      instance.state.setState(patch);
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
          if (values.value.previewEntryId !== null) instance.state.set("previewEntryId", null);
          return;
        }
        const current = values.value.previewEntryId;
        if (!current || !entries.some((entry) => entry.id === current)) {
          instance.state.set("previewEntryId", entries[0].id);
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

    // ---- Member operations (shared by human clicks and agent page_action) ----
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

    const syncOp = usePanelOperation("project", "sync", {
      available: () => Boolean(currentAppId.value && projectHasDrift.value),
      onSettled: () => {
        refreshWorkspaceViews();
        previewReloadKey.value += 1;
      },
    });

    const restartBuildTestOp = usePanelOperation("project", "restartBuildTest", {
      available: () => Boolean(currentAppId.value && buildTestCanRestart.value),
      onSettled: () => {
        projectRef.value?.refresh?.();
        previewReloadKey.value += 1;
      },
    });

    // ---- AgentChat context & chips ----
    const chatSessionContext = computed(() => (currentAppId.value ? { appId: currentAppId.value } : undefined));
    const chatGreeting = computed(() => t("chat.greeting", { name: currentAppName.value }));

    const carriedPageChip = computed(() => {
      if (activeTab.value === "preview") {
        const page = (typeof values.value.previewPage === "string" && values.value.previewPage) || currentAppName.value;
        return `${t("tab.preview")} · ${page}`;
      }
      if (activeTab.value === "files") {
        const file = typeof values.value.file === "string" ? values.value.file : "";
        return file ? `${t("tab.files")} · ${file}` : t("tab.files");
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
      instance.state.set("tab", nextTab);
    }

    function setPane(nextPane) {
      instance.state.set("pane", nextPane);
    }

    function toggleFullPane() {
      instance.state.set("pane", paneMode.value === "full" ? "side" : "full");
    }

    function selectDiffMode(mode) {
      instance.state.setState({ commit: null, diffMode: mode });
    }

    function startNewConversation(appRef) {
      const targetAppId = appRef?.primaryKey || currentAppId.value;
      const patch = { session: null, selectedSession: null };
      if (appRef && appRef.primaryKey) {
        patch.app = { className: APPLICATION_TYPE, primaryKey: appRef.primaryKey };
      }
      if (paneMode.value === "full") {
        patch.pane = "side";
      }
      instance.state.setState(patch);
      if (targetAppId) ensureAppExpanded(targetAppId);
    }

    function onChooseSession(appRef, sessionRef) {
      if (!sessionRef || !sessionRef.primaryKey) return;
      const patch = {
        session: sessionRef.primaryKey,
        selectedSession: { className: AGENT_SESSION_TYPE, primaryKey: sessionRef.primaryKey },
      };
      if (appRef && appRef.primaryKey && currentAppId.value !== appRef.primaryKey) {
        patch.app = { className: APPLICATION_TYPE, primaryKey: appRef.primaryKey };
      }
      if (paneMode.value === "full") {
        patch.pane = "side";
      }
      instance.state.setState(patch);
      if (appRef && appRef.primaryKey) ensureAppExpanded(appRef.primaryKey);
    }

    function openCreateDialog() {
      createDialogOpen.value = true;
    }

    function onDraftCreated(saved) {
      const patch = { createDialogOpen: false };
      if (saved && saved.primaryKey) {
        patch.app = { className: APPLICATION_TYPE, primaryKey: saved.primaryKey };
        patch.session = null;
        patch.selectedSession = null;
        patch.tab = "preview";
      }
      instance.state.setState(patch);
      if (saved && saved.primaryKey) ensureAppExpanded(saved.primaryKey);
      projectsRef.value?.refresh?.();
    }

    let initialProjectsReconciled = false;
    watch(() => projectsOutputs.value.listed, (refs) => {
      if (initialProjectsReconciled || !Array.isArray(refs)) return;
      if (projectsOutputs.value.status === "error") return;
      initialProjectsReconciled = true;
      if (refs.length === 0) {
        if (currentAppId.value) {
          instance.state.setState({
            app: null,
            session: null,
            selectedSession: null,
            publishDrawerOpen: false,
            publishCommit: null,
          });
        }
        return;
      }
      if (currentAppId.value && !refs.some((item) => item && item.primaryKey === currentAppId.value)) {
        const first = refs[0];
        if (first && first.primaryKey) {
          instance.state.setState({
            app: { className: first.className || APPLICATION_TYPE, primaryKey: first.primaryKey },
            session: null,
            selectedSession: null,
            publishDrawerOpen: false,
            publishCommit: null,
          });
        }
      }
    });

    function onProjectRowAction({ id, ref: appRef }) {
      if (!appRef || !appRef.primaryKey) return;
      if (id === "newChat") {
        startNewConversation(appRef);
      } else if (id === "editMeta") {
        instance.state.setState({
          editTarget: { className: APPLICATION_TYPE, primaryKey: appRef.primaryKey },
          editDialogOpen: true,
        });
      }
    }

    function onMetaSaved() {
      editDialogOpen.value = false;
      projectsRef.value?.refresh?.();
      projectRef.value?.refresh?.();
    }

    function openPublishDrawer(commitSha = null) {
      instance.state.setState({
        publishCommit: commitSha || null,
        publishDrawerOpen: true,
      });
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
      const patch = { commit: commitSha, tab: "changes" };
      if (paneMode.value === "closed") patch.pane = "side";
      instance.state.setState(patch);
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

    function onChatRunComplete(payload) {
      refreshWorkspaceViews();
      projectsRef.value?.refresh?.();
      if (payload?.ok) {
        previewReloadKey.value += 1;
        showPreviewFlash();
      }
    }

    function onPreviewContextChange(ctx) {
      instance.state.set("previewPage", ctx?.page ?? null);
      previewSelection.value = Array.isArray(ctx?.selection) ? ctx.selection : [];
    }

    function onPreviewStatusChange() {
      // Status is displayed directly inside AppPreview; no extra panel action required.
    }

    const syncSourceRunning = computed(() => Boolean(syncOp.running.value));
    async function runSyncSource() {
      await syncOp.run();
    }

    const restartTestRunning = computed(() => Boolean(restartBuildTestOp.running.value));
    async function runRestartBuildTest() {
      await restartBuildTestOp.run();
    }

    function driftStatusLabel(status) {
      if (status === "added") return t("drawer.driftAdded");
      if (status === "removed") return t("drawer.driftRemoved");
      return t("drawer.driftModified");
    }

    function jumpToConflictFile(filePath) {
      const patch = { publishDrawerOpen: false, publishCommit: null, file: filePath, tab: "files" };
      if (paneMode.value === "closed") patch.pane = "side";
      instance.state.setState(patch);
    }

    function openExternalPath(path) {
      if (path) navigate(path);
    }

    function navigateInternal(path) {
      if (path) {
        instance.state.setState({ publishDrawerOpen: false, publishCommit: null });
        navigate(path);
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
      onProjectsExpandedChange,
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
