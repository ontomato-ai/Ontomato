import { computed, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/projections/detail";
const SDK_COMPONENT_TYPE = "platform:SDKComponent";
const ONTOLOGY_TYPE = "platform:OntologyType";

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
    const componentId = computed(() => (typeof values.value.componentId === "string" ? values.value.componentId : ""));
    const componentFilterKey = computed(() => values.value.componentFilter?.primaryKey || "");
    const objectType = computed(() => (typeof values.value.objectType === "string" ? values.value.objectType : ""));
    const objectTypeFilterKey = computed(() => values.value.objectTypeFilter?.primaryKey || "");

    // Keep deep-linkable scalar filter states synchronized with their ReferencePicker object selections.
    watch(
      componentId,
      (next) => {
        if (next === componentFilterKey.value) return;
        instance.state.set("componentFilter", next ? { className: SDK_COMPONENT_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(componentFilterKey, (next) => {
      if (next === componentId.value) return;
      instance.state.set("componentId", next || null);
    });
    watch(
      objectType,
      (next) => {
        if (next === objectTypeFilterKey.value) return;
        instance.state.set("objectTypeFilter", next ? { className: ONTOLOGY_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(objectTypeFilterKey, (next) => {
      if (next === objectType.value) return;
      instance.state.set("objectType", next || null);
    });

    function clearFilters() {
      instance.state.setState({
        search: null,
        scope: "all",
        componentId: null,
        componentFilter: null,
        objectType: null,
        objectTypeFilter: null,
      });
    }
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
      clearFilters,
      openDetail,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionsCatalogPanel);
