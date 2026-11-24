import { computed, nextTick } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DEFAULT_CATALOG_PATH = "/ontology/agents";
const AGENT = "platform:AgentDefinition";
const CAPABILITY_MAP = "/ontology/assets/capability-map";

/*
 * Agent detail panel: full-width edit-on-open view for a single platform:AgentDefinition.
 * - Opens via ?selected=<id> from either /ontology/agents/detail or /agents/settings/detail.
 * - Mounts the owner-described form only once the header record is ready, so missing or
 *   forbidden deep links render in place without reading a form or exposing Delete.
 * - System built-in agents surface a read-only notice and model-only form as described by the owner;
 *   preset and system agents have Delete hidden via OperationButton's hideWhenUnavailable.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const catalogPath = computed(() => {
      const configured = values.value.catalogPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_CATALOG_PATH;
    });
    const isOntologyEntry = computed(() => catalogPath.value === DEFAULT_CATALOG_PATH);

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const agentCategory = usePanelOutput("header", "category");

    const recordStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailReady = computed(() => Boolean(selectedKey.value) && recordStatus.value === "ready");

    const recordErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("detail.loadError");
    });

    const detailDraft = usePanelFormDraft("form", { when: detailReady });

    // Route back to the sibling catalog entry so the platform's unified unsaved-changes leave guard runs.
    function goBack() {
      void navigate(catalogPath.value).catch(() => undefined);
    }

    function retry() {
      instance.refreshObjects();
    }

    function viewType() {
      void navigate(panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: AGENT })).catch(() => undefined);
    }

    function onSaved() {
      notify({ kind: "success", text: t("detail.saved") });
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(catalogPath.value).catch(() => undefined);
    }

    return {
      t,
      selectedKey,
      isOntologyEntry,
      agentCategory,
      recordStatus,
      detailReady,
      recordErrorText,
      detailDraft,
      goBack,
      retry,
      viewType,
      onSaved,
      onRemoveDone,
    };
  },
});
