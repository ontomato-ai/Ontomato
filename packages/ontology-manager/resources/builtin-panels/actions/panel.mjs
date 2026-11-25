import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in actions catalog panel: lists domain actions through ObjectList (with local keyword search and batch status
 * updates via OperationButton), exposes the ConversationEntry new-action trigger in <page-header>, and navigates to
 * the dedicated detail entry when a row is chosen.
 */

const DETAIL_PATH = "/ontology/assets/actions/detail";

const ActionsCatalog = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const sandboxStatus = usePanelOutput("sandboxCapability", "sandboxStatus");
    const canCheckSandbox = computed(() => sandboxStatus.value === "failed" || sandboxStatus.value === "unchecked");
    const showSandboxNotice = computed(() => canCheckSandbox.value || sandboxStatus.value === "unsupported");

    function onSandboxChecked(outcome) {
      if (outcome.kind !== "success") return;
      instance.refreshObjects();
      const capability = outcome.data.sandboxCapability;
      switch (capability.status) {
        case "passed":
          notify({ kind: "success", text: t("sandbox.passed") });
          break;
        case "failed":
          notify({ kind: "warning", text: t("sandbox.failed", { reason: capability.reason }) });
          break;
        case "unsupported":
          notify({ kind: "info", text: t("sandbox.unsupported") });
          break;
      }
    }

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigate(panelAddress(DETAIL_PATH, { selected: item.primaryKey })).catch(() => undefined);
    }

    return {
      openDetail,
      sandboxStatus,
      canCheckSandbox,
      showSandboxNotice,
      onSandboxChecked,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ActionsCatalog);
