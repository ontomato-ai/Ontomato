import { computed, nextTick, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const CATALOG_PATH = "/ontology/assets/functions";
const FUNCTION = "platform:Function";

/*
 * Function detail panel: full-width edit and create entry for platform:Function.
 * - Edit mode opens with ?selected=<id>; form mounts only once header record status is ready.
 * - Create mode opens with ?mode=create; saving converges state to ?selected=<id> and clears mode,
 *   while discarding or cancelling returns to the functions catalog.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const isCreate = computed(() => !selectedKey.value && values.value.mode === "create");

    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");

    const recordStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailReady = computed(() => Boolean(selectedKey.value) && recordStatus.value === "ready");
    const formMounted = computed(() => isCreate.value || detailReady.value);

    const recordErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("detail.loadError");
    });

    const detailDraft = usePanelFormDraft("definition", { when: formMounted });

    // Once a function is selected (for example right after creating one), clear create mode from the URL.
    watch(
      selectedKey,
      (next) => {
        if (next && values.value.mode != null) {
          instance.state.set("mode", null);
        }
      },
      { immediate: true },
    );

    // Route back to the catalog entry so the platform's unified unsaved-changes leave guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    function retry() {
      instance.refreshObjects();
    }

    async function onSaved(saved) {
      // ObjectForm.settleSave calls moveTo synchronously before emitting saved, so check mode === "create" as well.
      const wasCreate = isCreate.value || values.value.mode === "create";
      notify({ kind: "success", text: t("saved") });
      if (wasCreate) {
        if (!saved?.primaryKey) return;
        const patch = {};
        if (values.value.mode != null) patch.mode = null;
        if (values.value.selected?.primaryKey !== saved.primaryKey) {
          patch.selected = { className: FUNCTION, primaryKey: saved.primaryKey };
        }
        if (Object.keys(patch).length > 0) instance.state.setState(patch);
        return;
      }
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onDiscarded() {
      if (!isCreate.value) return;
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onCancel() {
      if (!isCreate.value) return;
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    return {
      t,
      selectedKey,
      isCreate,
      recordStatus,
      detailReady,
      formMounted,
      recordErrorText,
      detailDraft,
      goBack,
      retry,
      onSaved,
      onDiscarded,
      onCancel,
      onRemoveDone,
    };
  },
});
