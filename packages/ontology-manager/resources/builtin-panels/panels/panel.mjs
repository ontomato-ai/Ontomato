import { computed } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/panels/detail";
const OPEN_EDIT_KEY_PREFIX = "ontomato:open-edit:builtin-product-ontology-panel-detail:";

function markOpenEditOnDetail(primaryKey) {
  if (!primaryKey) return;
  try {
    sessionStorage.setItem(`${OPEN_EDIT_KEY_PREFIX}${primaryKey}`, "1");
  } catch {
    // Ignore storage unavailability (for example private browsing or restricted contexts).
  }
}

const PanelsCatalog = {
  setup() {
    const { instance, navigate, notify, t, confirmLeaveUnsaved } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const creating = computed(() => values.value.creating === true);

    let closingCreate = false;
    async function requestCloseCreate() {
      if (!creating.value || closingCreate) return;
      closingCreate = true;
      try {
        if (instance.forms.dirty("createForm")) {
          const allowed = confirmLeaveUnsaved
            ? await confirmLeaveUnsaved()
            : await instance.forms.reset("createForm", { confirm: true });
          if (!allowed) return;
          if (instance.forms.dirty("createForm")) {
            instance.forms.discard("createForm");
          }
        }
        state.set("creating", null);
      } finally {
        closingCreate = false;
      }
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (open) => {
        if (!open && creating.value) {
          void requestCloseCreate();
        }
      },
    });

    const scopeModel = computed({
      get: () => (typeof values.value.scope === "string" && values.value.scope ? values.value.scope : "all"),
      set: (next) => state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => (typeof values.value.sort === "string" && values.value.sort ? values.value.sort : "updated"),
      set: (next) => state.set("sort", next || "updated"),
    });
    const templateFilterModel = computed({
      get: () => {
        if (values.value.templateFilter === true) return "template";
        if (values.value.templateFilter === false) return "ordinary";
        return "all";
      },
      set: (next) => {
        if (next === "template") state.set("templateFilter", true);
        else if (next === "ordinary") state.set("templateFilter", false);
        else state.set("templateFilter", null);
      },
    });

    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    // Read-only count published by the unavailable panels diagnostic list.
    const unavailableCountOutput = usePanelOutput("unavailableList", "loadedCount");
    const hasUnavailablePanels = computed(
      () => typeof unavailableCountOutput.value === "number" && unavailableCountOutput.value > 0,
    );

    let forwarding = false;
    async function navigateToDetail(primaryKey) {
      if (!primaryKey || forwarding) return;
      forwarding = true;
      try {
        if (creating.value) state.set("creating", null);
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

    function startCreate() {
      state.set("creating", true);
    }

    function onCreateCancelled() {
      state.set("creating", null);
    }

    function onCreated(saved) {
      state.set("creating", null);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
      if (saved?.primaryKey) {
        markOpenEditOnDetail(saved.primaryKey);
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
      templateFilterModel,
      hasUnavailablePanels,
      openDetail,
      startCreate,
      onCreateCancelled,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(PanelsCatalog);
