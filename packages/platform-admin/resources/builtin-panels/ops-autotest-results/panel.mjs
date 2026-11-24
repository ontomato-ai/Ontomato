import { computed, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DEFAULT_CASE_DETAIL_PATH = "/ops/autotest/case";
const VALID_VERDICTS = new Set(["all", "correct", "wrong", "abnormal"]);

/*
 * Built-in automatic test results panel: two-pane run catalog and run inspection view with
 * owner-computed metrics, retention/download/delete operations, verdict filtering, manual
 * refresh (no client-side polling timers), and navigation to AutotestCaseArtifact details.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const caseDetailPath = computed(() => {
      const configured = values.value.caseDetailPath;
      return typeof configured === "string" && configured.startsWith("/")
        ? configured
        : DEFAULT_CASE_DETAIL_PATH;
    });

    // Owner-declared read-only outputs from AutotestRun.record (zero client calculation).
    const runActive = usePanelOutput("runHeader", "active");
    const runKept = usePanelOutput("runHeader", "kept");

    const verdictOptions = [
      { value: "all", labelKey: "filter.all" },
      { value: "correct", labelKey: "filter.correct" },
      { value: "wrong", labelKey: "filter.wrong" },
      { value: "abnormal", labelKey: "filter.abnormal" },
    ];

    // Guard invalid deep-linked verdict values back to "all".
    watch(
      () => values.value.verdict,
      (next) => {
        if (next != null && (typeof next !== "string" || !VALID_VERDICTS.has(next))) {
          instance.state.set("verdict", "all");
        }
      },
      { immediate: true, flush: "sync" },
    );

    // Reset verdict filter to "all" when switching to another test run unless explicitly set in the same patch.
    watch(
      selectedKey,
      (nextKey, previousKey) => {
        if (
          previousKey
          && nextKey
          && nextKey !== previousKey
          && !instance.state.lastPatchedKeys.has("verdict")
          && values.value.verdict !== "all"
        ) {
          instance.state.set("verdict", "all");
        }
      },
      { flush: "sync" },
    );

    function refresh() {
      instance.refreshObjects();
    }

    function clearSelection() {
      instance.state.setState({ selected: null, verdict: "all" });
    }

    function openCaseArtifact(ref) {
      const primaryKey = ref?.primaryKey;
      if (!primaryKey) return;
      void navigate(panelAddress(caseDetailPath.value, { selected: primaryKey })).catch(() => undefined);
    }

    function onResultRowAction({ id, ref }) {
      if (id === "openArtifact") {
        openCaseArtifact(ref);
      }
    }

    function onKeepDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notice.kept") });
    }

    function onUnkeepDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notice.unkept") });
    }

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.state.setState({ selected: null, verdict: "all" });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notice.deleted") });
    }

    return {
      t,
      selectedKey,
      runActive,
      runKept,
      verdictOptions,
      refresh,
      clearSelection,
      openCaseArtifact,
      onResultRowAction,
      onKeepDone,
      onUnkeepDone,
      onDeleteDone,
    };
  },
});
