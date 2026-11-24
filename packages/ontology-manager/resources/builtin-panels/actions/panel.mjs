import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in actions catalog panel: lists domain actions through ObjectList (with local keyword search and batch status
 * updates via OperationButton), exposes the ConversationEntry new-action trigger in <page-header>, and navigates to
 * the dedicated detail entry when a row is chosen.
 */

const DETAIL_PATH = "/ontology/assets/actions/detail";

const ActionsCatalog = {
  setup() {
    const { instance, navigate } = usePanelContext();

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigate(panelAddress(DETAIL_PATH, { selected: item.primaryKey })).catch(() => undefined);
    }

    return {
      openDetail,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ActionsCatalog);
