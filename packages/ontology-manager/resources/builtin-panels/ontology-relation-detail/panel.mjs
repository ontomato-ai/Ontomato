import { computed, nextTick } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

const CATALOG_PATH = "/ontology/relations";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));

    const headerStatus = usePanelOutput("headerTitle", "status");
    const recordStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });

    const detailDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && recordStatus.value === "ready",
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
      selectedKey, recordStatus, detailDraft, goBack, onRemoveDone, openObjectType,
    };
  },
});
