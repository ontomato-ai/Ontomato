import { computed, onBeforeUnmount, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const REBUILD_POLL_MS = 3000;

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    if (!instance.state.values.value.domain) {
      instance.state.set("domain", { className: "platform:ModelUsage", primaryKey: "domain" });
    }
    const usageDraft = usePanelFormDraft("usageForm");

    const configuredOutput = usePanelOutput("vectorStatus", "configured");
    const stateOutput = usePanelOutput("vectorStatus", "state");
    const aliveOutput = usePanelOutput("vectorStatus", "alive");
    const canRebuildOutput = usePanelOutput("vectorStatus", "canRebuild");
    const canResumeOutput = usePanelOutput("vectorStatus", "canResume");
    const canPauseOutput = usePanelOutput("vectorStatus", "canPause");

    const vectorConfigured = computed(() => configuredOutput.value === true);
    const vectorState = computed(() => (typeof stateOutput.value === "string" ? stateOutput.value : ""));
    const showVectorBanner = computed(() => vectorConfigured.value && Boolean(vectorState.value) && vectorState.value !== "READY");
    const vectorStateLabel = computed(() => {
      if (!vectorConfigured.value || !vectorState.value) return "";
      const key = `vector.states.${vectorState.value}`;
      const translated = t(key);
      return translated === key ? "" : translated;
    });
    const rebuildAlive = computed(() => aliveOutput.value === true);
    const canRebuild = computed(() => canRebuildOutput.value === true);
    const canResume = computed(() => canResumeOutput.value === true);
    const canPause = computed(() => canPauseOutput.value === true);

    let pollTimer;
    function clearPoll() {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    watch(
      rebuildAlive,
      (alive) => {
        clearPoll();
        if (alive) {
          pollTimer = setInterval(() => {
            instance.refreshObjects();
          }, REBUILD_POLL_MS);
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(clearPoll);

    function onUsageSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("defaults.saved") });
    }

    function onRebuildStarted(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "success", text: t("vector.started") });
    }

    function onRebuildPaused(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
      notify({ kind: "info", text: t("vector.paused") });
    }

    return {
      t,
      usageDraft,
      vectorConfigured,
      showVectorBanner,
      vectorStateLabel,
      rebuildAlive,
      canRebuild,
      canResume,
      canPause,
      onUsageSaved,
      onRebuildStarted,
      onRebuildPaused,
    };
  },
});
