import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/applications/detail";

const ApplicationsCatalogPanel = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const creating = computed(() => values.value.creating === true);
    const createDialog = computed({
      get: () => creating.value,
      set: (open) => {
        if (!open && creating.value) cancelCreate();
      },
    });

    const scopeModel = computed({
      get: () => values.value.scope || "visible",
      set: (next) => instance.state.set("scope", next || "visible"),
    });
    const sortModel = computed({
      get: () => values.value.sort || "id",
      set: (next) => instance.state.set("sort", next || "id"),
    });
    const scopeOptions = computed(() => [
      { value: "visible", label: t("scope.visible") },
      { value: "maintainable", label: t("scope.maintainable") },
    ]);

    function detailAddress(primaryKey) {
      return panelAddress(DETAIL_PATH, { selected: primaryKey });
    }

    let forwarding = false;
    async function navigateToDetail(primaryKey) {
      if (!primaryKey || forwarding) return;
      forwarding = true;
      try {
        if (creating.value) instance.state.set("creating", null);
        await navigate(detailAddress(primaryKey));
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      } finally {
        forwarding = false;
      }
    }

    function openDetail(item) {
      if (!item?.primaryKey) return;
      void navigateToDetail(item.primaryKey);
    }

    function startCreate() {
      instance.state.set("creating", true);
    }

    function cancelCreate() {
      instance.state.set("creating", null);
    }

    function onCreated(saved) {
      instance.state.set("creating", null);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
      if (saved?.primaryKey) {
        void navigateToDetail(saved.primaryKey);
      }
    }

    return {
      t,
      creating,
      createDialog,
      scopeModel,
      scopeOptions,
      sortModel,
      openDetail,
      startCreate,
      cancelCreate,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ApplicationsCatalogPanel);
