import { computed, nextTick, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

const CATALOG_PATH = "/ontology/relations";

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));

    const headerStatus = usePanelOutput("headerTitle", "status");
    const headerError = usePanelOutput("headerTitle", "errorMessage");
    const recordStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const recordErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("rel.loadError");
    });

    // Keep the edit form mounted across transient reread errors/reloads for the same relationship
    // so unsaved draft edits stay intact, aligned with platform reread `previous` semantics.
    const recordEverReady = ref(false);
    watch(
      [selectedKey, recordStatus],
      ([key, status], previous) => {
        const prevKey = previous?.[0] ?? "";
        if (!key) {
          recordEverReady.value = false;
          return;
        }
        if (key !== prevKey) {
          recordEverReady.value = !prevKey && status === "ready";
          return;
        }
        if (status === "ready") recordEverReady.value = true;
      },
      { immediate: true },
    );

    const showDetailBody = computed(
      () =>
        Boolean(selectedKey.value)
        && recordEverReady.value
        && recordStatus.value !== "forbidden"
        && recordStatus.value !== "empty"
        && recordStatus.value !== "missing",
    );

    const detailDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && showDetailBody.value,
    });

    // Route back to the catalog entry so the platform's unified unsaved-changes leave guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      // Clear selection and wait a tick so any dirty form unmounts before leaving for the catalog.
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    // Open the object types page with the endpoint class emitted by ObjectRefCard.
    function openObjectType(reference) {
      if (!reference?.primaryKey) return;
      void navigate(panelAddress("/ontology/objects", { selected: reference.primaryKey })).catch(() => undefined);
    }

    return {
      selectedKey,
      recordStatus,
      recordEverReady,
      recordErrorText,
      showDetailBody,
      detailDraft,
      goBack,
      onRemoveDone,
      openObjectType,
    };
  },
});
