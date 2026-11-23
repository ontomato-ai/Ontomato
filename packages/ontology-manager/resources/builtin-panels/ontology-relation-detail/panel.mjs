import { computed, nextTick, watch } from "vue";
import { mountPanel, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

const TYPE = "platform:Relationship";
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
      const state = JSON.stringify({
        selected: { className: reference.className || "platform:ObjectType", primaryKey: reference.primaryKey },
      });
      void navigate(`/ontology/objects?${new globalThis.URLSearchParams({ state })}`).catch(() => undefined);
    }

    // A draft targeting a specific relationship selects it so the form opens that target.
    watch(instance.draft, (draft) => {
      if (draft?.target?.id && draft.target.id !== selectedKey.value) {
        instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
      }
    }, { immediate: true });

    return {
      selectedKey, recordStatus, detailDraft, goBack, onRemoveDone, openObjectType,
    };
  },
});
