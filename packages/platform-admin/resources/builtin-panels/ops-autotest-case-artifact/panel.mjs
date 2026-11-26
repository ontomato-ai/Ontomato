import { computed, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in autotest case artifact panel: keeps the left 280px AutotestRun list context
 * alongside a frameless full-height ArtifactDetail workspace for one AutotestCaseArtifact
 * (`runId::caseId`), with run-preserving back navigation and on-demand artifact file loading.
 */

const RESULTS_PATH = "/ops/results";
const AUTOTEST_RUN_TYPE = "platform:AutotestRun";
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
    const { instance, navigate, navigateBack, t } = context;

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const activeRun = computed(() => instance.state.values.value.activeRun ?? null);
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
    const gapsCount = usePanelOutput("evidenceGaps", "loadedCount");
    const gapsStatus = usePanelOutput("evidenceGaps", "status");

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
    const showGaps = computed(
      () => (typeof gapsCount.value === "number" && gapsCount.value > 0) || gapsStatus.value === "error",
    );

    // Keep the left run sidebar highlighted on the test run owning the current case artifact.
    watch(
      displayRunId,
      (runId) => {
        const currentRunKey = activeRun.value?.primaryKey ?? "";
        if (!runId) {
          if (activeRun.value !== null) {
            instance.state.set("activeRun", null);
          }
          return;
        }
        if (currentRunKey !== runId) {
          instance.state.set("activeRun", { className: AUTOTEST_RUN_TYPE, primaryKey: runId });
        }
      },
      { immediate: true, flush: "sync" },
    );

    // Reset file selection and filter when switching cases unless the caller explicitly patched them together;
    // files load on demand when the user clicks a node in the artifact tree.
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
      const runId = displayRunId.value;
      const target = runId ? panelAddress(RESULTS_PATH, { selected: runId }) : RESULTS_PATH;
      void navigateBack(target);
    }

    function openRun(ref) {
      const runId = ref?.primaryKey;
      if (!runId) return;
      void navigate(panelAddress(RESULTS_PATH, { selected: runId })).catch(() => undefined);
    }

    function onRunRowOperationDone(operationName, outcome, rowRef) {
      if (outcome?.kind !== "success") return;
      if (operationName === "delete" && rowRef?.primaryKey && rowRef.primaryKey === displayRunId.value) {
        void navigateBack(RESULTS_PATH);
        return;
      }
      instance.refreshObjects();
    }

    function refresh() {
      instance.refreshObjects();
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
      showGaps,
      goBack,
      openRun,
      onRunRowOperationDone,
      refresh,
    };
  },
});
