import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in App Builder workspace detail panel: inspects files, diffs, commits, releases,
 * previews, and linked AgentSession conversations for one platform:AppWorkspace.
 */

const LIST_PATH = "/app-builder";
const VALID_TABS = new Set(["files", "changes", "history", "releases"]);

await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const workspace = computed(() => values.value.workspace ?? null);
    const workspaceKey = computed(() => workspace.value?.primaryKey ?? "");

    const activeTab = computed(() => {
      const raw = values.value.tab;
      return typeof raw === "string" && VALID_TABS.has(raw) ? raw : "files";
    });

    const filePath = computed(() => {
      const raw = values.value.filePath;
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    });

    const activeDiffTarget = computed(() => {
      const raw = values.value.diffTarget;
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "latest";
    });

    const isCustomDiffCommit = computed(
      () => activeDiffTarget.value !== "working" && activeDiffTarget.value !== "latest",
    );

    const renameOpen = computed({
      get: () => values.value.renaming === true,
      set: (open) => instance.state.set("renaming", open ? true : null),
    });

    const publishOpen = computed({
      get: () => values.value.publishing === true,
      set: (open) => instance.state.set("publishing", open ? true : null),
    });

    const sessionsOpen = computed({
      get: () => values.value.sessionsOpen === true,
      set: (open) => instance.state.set("sessionsOpen", open ? true : null),
    });

    const nameOutput = usePanelOutput("detailHeader", "name");
    const shortHeadCommitOutput = usePanelOutput("detailHeader", "shortHeadCommit");
    const hasPanelCandidateOutput = usePanelOutput("detailHeader", "hasPanelCandidate");
    const candidatePreviewPathOutput = usePanelOutput("detailHeader", "candidatePreviewPath");
    const hasHostedIndexOutput = usePanelOutput("detailHeader", "hasHostedIndex");
    const hostedPreviewPathOutput = usePanelOutput("detailHeader", "hostedPreviewPath");
    const publishedOutput = usePanelOutput("detailHeader", "published");
    const publishedAppNameOutput = usePanelOutput("detailHeader", "publishedAppName");
    const publishedAppPathOutput = usePanelOutput("detailHeader", "publishedAppPath");
    const buildTestCanRestartOutput = usePanelOutput("detailHeader", "buildTestCanRestart");
    const canManagePermissionsOutput = usePanelOutput("detailHeader", "canManagePermissions");
    const permissionsPathOutput = usePanelOutput("detailHeader", "permissionsPath");

    const headerTitle = computed(() => {
      if (typeof nameOutput.value === "string" && nameOutput.value.trim()) return nameOutput.value;
      return workspaceKey.value || t("panel.title");
    });
    const headerSubtitle = computed(() =>
      typeof shortHeadCommitOutput.value === "string" && shortHeadCommitOutput.value
        ? shortHeadCommitOutput.value
        : null,
    );
    const hasPanelCandidate = computed(() => hasPanelCandidateOutput.value === true);
    const candidatePreviewPath = computed(() =>
      typeof candidatePreviewPathOutput.value === "string" ? candidatePreviewPathOutput.value : "",
    );
    const hasHostedIndex = computed(() => hasHostedIndexOutput.value === true);
    const hostedPreviewPath = computed(() =>
      typeof hostedPreviewPathOutput.value === "string" ? hostedPreviewPathOutput.value : "",
    );
    const published = computed(() => publishedOutput.value === true);
    const publishedAppName = computed(() =>
      typeof publishedAppNameOutput.value === "string" ? publishedAppNameOutput.value : "",
    );
    const publishedAppPath = computed(() =>
      typeof publishedAppPathOutput.value === "string" ? publishedAppPathOutput.value : "",
    );
    const buildTestCanRestart = computed(() => buildTestCanRestartOutput.value === true);
    const canManagePermissions = computed(() => canManagePermissionsOutput.value === true);
    const permissionsPath = computed(() =>
      typeof permissionsPathOutput.value === "string" ? permissionsPathOutput.value : "",
    );

    const releaseStatusText = computed(() =>
      published.value && publishedAppName.value
        ? t("releases.statusPublished", { name: publishedAppName.value })
        : t("releases.statusUnpublished"),
    );

    const tabOptions = computed(() => [
      { value: "files", label: t("tabs.files") },
      { value: "changes", label: t("tabs.changes") },
      { value: "history", label: t("tabs.history") },
      { value: "releases", label: t("tabs.releases") },
    ]);

    watch(
      workspaceKey,
      (nextKey, previousKey) => {
        if (!nextKey || !previousKey || nextKey === previousKey) return;
        const patch = {};
        if (!instance.state.lastPatchedKeys.has("filePath") && values.value.filePath) {
          patch.filePath = null;
        }
        if (!instance.state.lastPatchedKeys.has("fileSearch") && values.value.fileSearch) {
          patch.fileSearch = null;
        }
        if (!instance.state.lastPatchedKeys.has("diffTarget") && values.value.diffTarget !== "latest") {
          patch.diffTarget = "latest";
        }
        if (Object.keys(patch).length > 0) {
          instance.state.setState(patch);
        }
      },
      { flush: "sync" },
    );

    async function openPath(path) {
      if (!path) return;
      try {
        await navigate(path);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function goBack() {
      void openPath(LIST_PATH);
    }

    function refresh() {
      instance.refreshObjects();
    }

    function clearFilePath() {
      instance.state.set("filePath", null);
    }

    function setDiffTarget(target) {
      instance.state.set("diffTarget", target);
    }

    function openRename() {
      instance.state.setState({ publishing: null, sessionsOpen: null, renaming: true });
    }

    function closeRename() {
      instance.state.set("renaming", null);
    }

    function openPublish() {
      instance.state.setState({ renaming: null, sessionsOpen: null, publishing: true });
    }

    function closePublish() {
      instance.state.set("publishing", null);
    }

    function openSessions() {
      instance.state.setState({ renaming: null, publishing: null, sessionsOpen: true });
    }

    function closeSessions() {
      instance.state.set("sessionsOpen", null);
    }

    function onRenamed() {
      closeRename();
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.renamed") });
    }

    function onPublished() {
      closePublish();
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.published") });
    }

    function onRestartBuildTestDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.testRestarted") });
    }

    function onCommitRowAction({ id, ref: rowRef }) {
      if (id !== "diff" || !rowRef?.primaryKey) return;
      instance.state.setState({ diffTarget: rowRef.primaryKey, tab: "changes" });
    }

    function onCommitOperationDone(operation, outcome) {
      if (operation !== "restoreCommit" || outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.restored") });
    }

    function onReleaseOperationDone(operation, outcome) {
      if (operation !== "rollbackRelease" || outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.rolledBack") });
    }

    return {
      t,
      workspaceKey,
      headerTitle,
      headerSubtitle,
      activeTab,
      tabOptions,
      filePath,
      activeDiffTarget,
      isCustomDiffCommit,
      hasPanelCandidate,
      candidatePreviewPath,
      hasHostedIndex,
      hostedPreviewPath,
      published,
      publishedAppPath,
      buildTestCanRestart,
      canManagePermissions,
      permissionsPath,
      releaseStatusText,
      renameOpen,
      publishOpen,
      sessionsOpen,
      openPath,
      goBack,
      refresh,
      clearFilePath,
      setDiffTarget,
      openRename,
      closeRename,
      openPublish,
      closePublish,
      openSessions,
      closeSessions,
      onRenamed,
      onPublished,
      onRestartBuildTestDone,
      onCommitRowAction,
      onCommitOperationDone,
      onReleaseOperationDone,
    };
  },
});
