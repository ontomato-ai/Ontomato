import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const DEFAULT_DETAIL_PATH = "/ontology/agents/detail";

/*
 * Agents catalog: full-width searchable table without default row selection, plus a centered
 * creation dialog collecting only what the owner requires (/name, plus optional /description).
 * Navigating to detail uses the application-entry-wired `detailPath` input so the same panel
 * serves both /ontology/agents and /agents/settings under their own entry permissions.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const listStatus = usePanelOutput("list", "status");
    const detailPath = computed(() => {
      const configured = values.value.detailPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_DETAIL_PATH;
    });

    const creating = computed(() => values.value.creating === true);
    const setCreating = (open) => instance.state.set("creating", Boolean(open));

    const createDialog = computed({
      get: () => creating.value,
      set: (open) => {
        if (Boolean(open) !== creating.value) setCreating(Boolean(open));
      },
    });

    function detailAddress(primaryKey) {
      return panelAddress(detailPath.value, { selected: primaryKey });
    }

    function openDetail(item) {
      if (!item?.primaryKey) return;
      if (creating.value) setCreating(false);
      void navigate(detailAddress(item.primaryKey)).catch(() => undefined);
    }

    function startCreate() {
      setCreating(true);
    }

    function cancelCreate() {
      setCreating(false);
    }

    function onCreated(saved) {
      setCreating(false);
      notify({ kind: "success", text: t("agents.created") });
      if (saved?.primaryKey) {
        void navigate(detailAddress(saved.primaryKey)).catch(() => undefined);
      }
    }

    return {
      t,
      listStatus,
      creating,
      createDialog,
      openDetail,
      startCreate,
      cancelCreate,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
});
