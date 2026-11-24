import { computed } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/projections/detail";

const ProjectionsCatalogPanel = {
  setup() {
    const ctx = usePanelContext();
    const { instance, navigate, notify, t } = ctx;
    const values = instance.state.values;

    const creating = computed(() => values.value.creating === true);
    const scopeModel = computed({
      get: () => values.value.scope || "all",
      set: (next) => instance.state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => values.value.sort || "updated",
      set: (next) => instance.state.set("sort", next || "updated"),
    });
    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    const createDraft = usePanelFormDraft("createForm", {
      when: () => creating.value,
    });

    function exitCreate() {
      if (creating.value) {
        instance.state.set("creating", false);
      }
    }

    const createBack = usePanelBack(() => creating.value, exitCreate, {
      pushHistory: false,
      forms: "createForm",
    });

    async function cancelCreate() {
      if (!creating.value) return;
      if (ctx.confirmLeaveUnsaved) {
        await createBack.back();
        return;
      }
      if (instance.forms.dirty("createForm")) {
        const allowed = await instance.forms.reset("createForm", { confirm: true });
        if (!allowed) return;
      }
      exitCreate();
    }

    function startCreate() {
      instance.state.set("creating", true);
    }

    let forwarding = false;
    async function navigateToDetail(primaryKey) {
      if (!primaryKey || forwarding) return;
      forwarding = true;
      try {
        await navigate(panelAddress(DETAIL_PATH, { selected: primaryKey }));
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

    function onCreated(saved) {
      instance.state.set("creating", false);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
      if (saved?.primaryKey) {
        void navigateToDetail(saved.primaryKey);
      }
    }

    return {
      t,
      creating,
      createDraft,
      scopeModel,
      scopeOptions,
      sortModel,
      startCreate,
      cancelCreate,
      openDetail,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionsCatalogPanel);
