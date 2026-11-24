import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/projections/detail";
const OPEN_EDIT_KEY_PREFIX = "ontomato:open-edit:builtin-product-ontology-projection-detail:";

function markOpenDetailInEdit(primaryKey) {
  if (!primaryKey) return;
  try {
    globalThis.window?.sessionStorage?.setItem(`${OPEN_EDIT_KEY_PREFIX}${primaryKey}`, "1");
  } catch {
    // Ignore storage unavailability (e.g. private browsing or restricted storage).
  }
}

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

    let closingCreatePromise = null;
    async function requestCloseCreate() {
      if (!creating.value || closingCreatePromise) return;
      const run = (async () => {
        if (instance.forms.dirty("createForm")) {
          const allowed = ctx.confirmLeaveUnsaved
            ? await ctx.confirmLeaveUnsaved()
            : await instance.forms.reset("createForm", { confirm: true });
          if (!allowed) return;
          instance.forms.discard("createForm");
        }
        instance.state.set("creating", false);
      })();
      closingCreatePromise = run;
      try {
        await run;
      } finally {
        closingCreatePromise = null;
      }
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (open) => {
        if (!open && creating.value) {
          void requestCloseCreate();
        } else if (open && !creating.value) {
          startCreate();
        }
      },
    });

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
        // One-time handoff so the newly created projection opens directly in edit mode without polluting the URL.
        markOpenDetailInEdit(saved.primaryKey);
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
      startCreate,
      requestCloseCreate,
      openDetail,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ProjectionsCatalogPanel);
