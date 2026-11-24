import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/assets/functions/detail";

/*
 * Functions catalog: full-width searchable table without default row selection.
 * Selecting a row navigates to the non-menu detail entry; clicking "New function"
 * navigates to the detail entry in create mode.
 */
await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigate(panelAddress(DETAIL_PATH, { selected: item.primaryKey })).catch(() => undefined);
    }

    function startCreate() {
      void navigate(panelAddress(DETAIL_PATH, { mode: "create" })).catch(() => undefined);
    }

    return {
      t,
      openDetail,
      startCreate,
      refresh: () => instance.refreshObjects(),
    };
  },
});
