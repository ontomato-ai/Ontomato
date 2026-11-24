import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/assets/metrics/detail";

/*
 * Metric views catalog panel: full-width searchable table with checked-row batch publication status updates.
 * Row selection and creation navigate to the dedicated non-menu detail entry.
 */
await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const state = instance.state.values;

    const batchStatus = computed({
      get: () => state.value.batchStatus || "PUBLISHED",
      set: (next) => instance.state.set("batchStatus", next || "PUBLISHED"),
    });

    function openDetail(ref) {
      if (!ref?.primaryKey) return;
      void navigate(panelAddress(DETAIL_PATH, { selected: ref.primaryKey })).catch(() => undefined);
    }

    function startCreate() {
      void navigate(panelAddress(DETAIL_PATH, { mode: "create" })).catch(() => undefined);
    }

    return {
      batchStatus,
      openDetail,
      startCreate,
      refresh: () => instance.refreshObjects(),
    };
  },
});
