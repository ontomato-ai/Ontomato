import { computed, nextTick, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData, usePanelFormDraft } from "@ontomato/sdk/panel";

const TYPE = "platform:Relationship";
const CATALOG_PATH = "/ontology/relations";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));

    const detail = usePanelData("detail", "record");
    const types = usePanelData("types", "rows");

    const typeLabels = computed(() => {
      const rows = types.value.status === "ready" ? types.value.value : [];
      return Object.fromEntries(rows.map((row) => [row.primaryKey, row.label || row.primaryKey]));
    });
    const typeLabel = (className) => (!className ? "" : typeLabels.value[className] ?? className);

    const detailDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && detail.value.status === "ready",
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

    // Open the object types page with the endpoint class selected.
    function openType(className) {
      if (!className) return;
      const state = JSON.stringify({ selected: { className: "platform:ObjectType", primaryKey: className } });
      void navigate(`/ontology/objects?${new globalThis.URLSearchParams({ state })}`).catch(() => undefined);
    }

    // A draft targeting a specific relationship selects it so the form opens that target.
    watch(instance.draft, (draft) => {
      if (draft?.target?.id && draft.target.id !== selectedKey.value) {
        instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
      }
    }, { immediate: true });

    return {
      detail, types, selectedKey, detailDraft, typeLabel, goBack, onRemoveDone, openType,
    };
  },
});
