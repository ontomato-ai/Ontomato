import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";

await mountPanel({
  setup() {
    const { instance, t, navigate, notify } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const dialogWidth = computed(() => (narrow.value ? "94%" : "560px"));

    const state = computed(() => instance.state.values.value);
    const selected = computed(() => state.value.selected ?? null);
    const hasSelected = computed(() => Boolean(selected.value?.className && selected.value?.primaryKey));
    const selectedClassKey = computed(() => selected.value?.className ?? "");
    const returnTarget = computed(() => (typeof state.value.returnTo === "string" ? state.value.returnTo : ""));

    watch(
      selectedClassKey,
      (className) => {
        const current = instance.state.values.value.selectedClass;
        const next = className ? { className: OBJECT_TYPE, primaryKey: className } : null;
        if ((current?.primaryKey ?? null) !== (next?.primaryKey ?? null)) {
          instance.state.set("selectedClass", next);
        }
      },
      { immediate: true },
    );

    const headerLabel = usePanelOutput("headerTitle", "label");
    const headerStatus = usePanelOutput("headerTitle", "status");
    const canConfigureOutput = usePanelOutput("detailBinding", "canConfigure");
    const favoritedOutput = usePanelOutput("favoriteStatus", "favorited");

    const canConfigure = computed(() => canConfigureOutput.value === true);
    const favorited = computed(() => favoritedOutput.value === true);
    const fallbackHeading = computed(
      () => headerLabel.value || selected.value?.primaryKey || t("panel.name"),
    );
    const backLabel = computed(() =>
      returnTarget.value === "workspace" ? t("od.backWorkspace") : t("od.backBrowser"),
    );

    const addFavoriteOp = usePanelOperation("addFavorite", "add", {
      available: () => Boolean(hasSelected.value && !favorited.value),
      prepareInput: () => {
        const title = String(headerLabel.value || "").trim();
        return title ? { title } : {};
      },
    });
    const removeFavoriteOp = usePanelOperation("removeFavorite", "remove", {
      available: () => Boolean(hasSelected.value && favorited.value),
    });
    const favoriteBusy = computed(() => addFavoriteOp.running.value || removeFavoriteOp.running.value);

    async function toggleFavorite() {
      if (!hasSelected.value || favoriteBusy.value) return;
      if (favorited.value) {
        await removeFavoriteOp.run();
      } else {
        await addFavoriteOp.run();
      }
    }

    // Local dialog toggle for configuring this object type's detail presentation (never enters URL).
    const configureDialog = ref(false);
    watch(selectedClassKey, () => {
      configureDialog.value = false;
    });

    const dialogBack = usePanelBack(
      () => configureDialog.value,
      () => {
        configureDialog.value = false;
      },
      { pushHistory: false, forms: "detailPanelForm" },
    );

    function openConfigureDialog() {
      if (!canConfigure.value || !selectedClassKey.value) return;
      configureDialog.value = true;
    }

    async function handleConfigureDialogClose(done) {
      if (await dialogBack.back()) done();
    }

    function onDetailPanelSaved() {
      configureDialog.value = false;
      notify({ kind: "success", text: t("od.savedNotice") });
      instance.refreshObjects();
    }

    function onDetailPanelCleared(outcome) {
      if (outcome?.kind !== "success") return;
      configureDialog.value = false;
      notify({ kind: "success", text: t("od.clearedNotice") });
      instance.refreshObjects();
    }

    function openPanelsDirectory() {
      configureDialog.value = false;
      void navigate("/ontology/panels").catch(() => undefined);
    }

    function goBack() {
      const target = returnTarget.value === "workspace"
        ? "/workspace"
        : selectedClassKey.value
          ? `/browser/data/${encodeURIComponent(selectedClassKey.value)}`
          : "/browser/data";
      void navigate(target).catch(() => undefined);
    }

    return {
      rootRef,
      dialogWidth,
      t,
      hasSelected,
      selectedClassKey,
      headerStatus,
      fallbackHeading,
      backLabel,
      canConfigure,
      favorited,
      favoriteBusy,
      configureDialog,
      toggleFavorite,
      refresh: () => instance.refreshObjects(),
      openConfigureDialog,
      handleConfigureDialogClose,
      onDetailPanelSaved,
      onDetailPanelCleared,
      openPanelsDirectory,
      goBack,
    };
  },
});
