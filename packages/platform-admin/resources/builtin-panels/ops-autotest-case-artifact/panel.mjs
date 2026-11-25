import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in autotest case artifact panel: inspects one AutotestCaseArtifact (primary key `runId::caseId`),
 * showing case summary, evidence gaps and runs, a searchable artifact file browser with automatic format
 * rendering, ZIP download, and a ConversationEntry trigger for the operations diagnosis agent.
 */

const RESULTS_PATH = "/ops/results";
const KEY_SEPARATOR = "::";

function parseCaseArtifactKey(primaryKey) {
  if (typeof primaryKey !== "string") return { runId: "", caseId: "" };
  const index = primaryKey.indexOf(KEY_SEPARATOR);
  if (index <= 0 || index >= primaryKey.length - KEY_SEPARATOR.length) {
    return { runId: "", caseId: primaryKey };
  }
  return {
    runId: primaryKey.slice(0, index),
    caseId: primaryKey.slice(index + KEY_SEPARATOR.length),
  };
}

await mountPanel({
  setup() {
    const context = usePanelContext();
    const { instance, navigate, t } = context;

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const filePath = computed(() => {
      const value = instance.state.values.value.filePath;
      return typeof value === "string" && value.length > 0 ? value : null;
    });
    const fileSearch = computed(() => {
      const value = instance.state.values.value.fileSearch;
      return typeof value === "string" && value.length > 0 ? value : null;
    });

    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const parsedKey = computed(() => parseCaseArtifactKey(selectedKey.value));

    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const ownerRunId = usePanelOutput("header", "runId");
    const ownerCaseId = usePanelOutput("header", "caseId");
    const ownerHasEvidence = usePanelOutput("header", "hasEvidence");
    const rawRunsTotal = usePanelOutput("evidenceRuns", "total");
    const rawGapsTotal = usePanelOutput("evidenceGaps", "total");

    const detailStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailReady = computed(() => detailStatus.value === "ready");
    const detailErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("panel.loadFailed");
    });

    const displayCaseId = computed(() => {
      if (typeof ownerCaseId.value === "string" && ownerCaseId.value.length > 0) return ownerCaseId.value;
      return parsedKey.value.caseId;
    });
    const displayRunId = computed(() => {
      if (typeof ownerRunId.value === "string" && ownerRunId.value.length > 0) return ownerRunId.value;
      return parsedKey.value.runId;
    });
    const fallbackTitle = computed(() => displayCaseId.value || selectedKey.value || t("panel.name"));
    const hasEvidence = computed(() => (typeof ownerHasEvidence.value === "boolean" ? ownerHasEvidence.value : null));
    const runsCount = computed(() => (typeof rawRunsTotal.value === "number" ? rawRunsTotal.value : null));
    const gapsCount = computed(() => (typeof rawGapsTotal.value === "number" ? rawGapsTotal.value : null));

    // Reset file selection and filter when switching cases unless the caller explicitly patched them together.
    watch(
      () => selected.value?.primaryKey ?? null,
      (nextKey, previousKey) => {
        if (!nextKey) {
          const patch = {};
          if (filePath.value) patch.filePath = null;
          if (fileSearch.value) patch.fileSearch = null;
          if (Object.keys(patch).length > 0) instance.state.setState(patch);
          return;
        }
        if (previousKey && previousKey !== nextKey) {
          const patch = {};
          if (!instance.state.lastPatchedKeys.has("filePath") && filePath.value) patch.filePath = null;
          if (!instance.state.lastPatchedKeys.has("fileSearch") && fileSearch.value) patch.fileSearch = null;
          if (Object.keys(patch).length > 0) instance.state.setState(patch);
        }
      },
      { immediate: true, flush: "sync" },
    );

    function goBack() {
      void navigate(RESULTS_PATH).catch(() => undefined);
    }

    function refresh() {
      instance.refreshObjects();
    }

    function clearFileSelection() {
      instance.state.setState({ filePath: null });
    }

    return {
      t,
      selectedKey,
      filePath,
      detailStatus,
      detailReady,
      detailErrorText,
      displayCaseId,
      displayRunId,
      fallbackTitle,
      hasEvidence,
      runsCount,
      gapsCount,
      goBack,
      refresh,
      clearFileSelection,
    };
  },
});
