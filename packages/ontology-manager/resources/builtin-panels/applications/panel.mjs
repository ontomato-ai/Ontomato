import { computed, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/applications/detail";
const APPLICATION_TYPE = "platform:Application";

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
    const copySourceKey = computed(() => values.value.copySource?.primaryKey ?? "");
    const copyDialog = computed({
      get: () => Boolean(copySourceKey.value),
      set: (open) => {
        if (!open && copySourceKey.value) cancelCopy();
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
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
      { value: "maintainable", label: t("scope.maintainable") },
    ]);

    // Prefill default copy suffix once when the copy form loads so the user can submit immediately or edit.
    const copyNameSeededFor = ref("");
    watch(
      [copySourceKey, () => instance.forms.handle("copyForm")?.values.value?.declaration?.names],
      ([sourceKey, names]) => {
        if (!sourceKey) {
          copyNameSeededFor.value = "";
          return;
        }
        if (copyNameSeededFor.value === sourceKey || !names || typeof names !== "object") return;
        const handle = instance.forms.handle("copyForm");
        if (!handle) return;
        const entries = Object.entries(names).filter(([, v]) => typeof v === "string" && v.trim());
        if (!entries.length) return;
        copyNameSeededFor.value = sourceKey;
        const nextNames = Object.fromEntries(
          entries.map(([lang, text]) => [lang, t("copy.suffix", { name: text.trim() })]),
        );
        handle.set("/declaration/names", nextNames);
      },
      { deep: true },
    );

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

    function onRowAction({ id, ref: rowRef }) {
      if (id === "copy" && rowRef?.primaryKey) {
        instance.state.set("copySource", { className: APPLICATION_TYPE, primaryKey: rowRef.primaryKey });
      }
    }

    function cancelCopy() {
      copyNameSeededFor.value = "";
      instance.state.set("copySource", null);
    }

    function onCopied(saved) {
      copyNameSeededFor.value = "";
      instance.state.set("copySource", null);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.copied") });
      if (saved?.primaryKey) {
        void navigateToDetail(saved.primaryKey);
      }
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
      copyDialog,
      scopeModel,
      scopeOptions,
      sortModel,
      openDetail,
      onRowAction,
      cancelCopy,
      onCopied,
      startCreate,
      cancelCreate,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ApplicationsCatalogPanel);
