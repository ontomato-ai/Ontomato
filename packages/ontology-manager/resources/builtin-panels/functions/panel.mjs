import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/assets/functions/detail";

/*
 * Functions catalog: full-width unpaged searchable table without default row selection.
 * Selecting a row navigates to the non-menu detail entry; clicking "New function"
 * navigates to the detail entry in create mode.
 */
await mountPanel({
  setup() {
    const { navigate, t } = usePanelContext();
    const listTotal = usePanelOutput("list", "total");

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigate(panelAddress(DETAIL_PATH, { selected: item.primaryKey })).catch(() => undefined);
    }

    function startCreate() {
      void navigate(panelAddress(DETAIL_PATH, { mode: "create" })).catch(() => undefined);
    }

    return {
      t,
      listTotal,
      openDetail,
      startCreate,
    };
  },
});
