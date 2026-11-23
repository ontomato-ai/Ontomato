import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const TYPE = "platform:Relationship";
const DETAIL_PATH = "/ontology/relations/detail";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value),
    });

    const catalogue = usePanelData("catalogue", "rows");
    const types = usePanelData("types", "rows");

    const typeLabels = computed(() => {
      const rows = types.value.status === "ready" ? types.value.value : [];
      return Object.fromEntries(rows.map((row) => [row.primaryKey, row.label || row.primaryKey]));
    });
    const typeLabel = (className) => (!className ? "" : typeLabels.value[className] ?? className);

    const allRows = computed(() => (catalogue.value.status === "ready" ? catalogue.value.value : []));
    const rows = computed(() => {
      const term = search.value.trim().toLowerCase();
      if (!term) return allRows.value;
      return allRows.value.filter((row) =>
        [row.primaryKey, row.label, row.fields.desc, row.fields.fromclass, row.fields.toclass,
          typeLabel(row.fields.fromclass), typeLabel(row.fields.toclass)]
          .filter(Boolean).join(" ").toLowerCase().includes(term));
    });
    // Match the original catalog count format (`14 项`, and `0 项` when no rows match the filter).
    const countText = computed(() => {
      if (catalogue.value.status !== "ready") return "";
      return `${rows.value.length} 项`;
    });

    const creating = computed(() => instance.state.values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value);

    function detailAddress(primaryKey) {
      const state = JSON.stringify({ selected: { className: TYPE, primaryKey } });
      return `${DETAIL_PATH}?${new globalThis.URLSearchParams({ state })}`;
    }

    function open(row) {
      if (!row?.primaryKey) return;
      setCreating(false);
      void navigate(detailAddress(row.primaryKey)).catch(() => undefined);
    }

    function startCreate() {
      setCreating(true);
    }

    function cancelCreate() {
      setCreating(false);
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });

    function onSaved(saved) {
      setCreating(false);
      const key = saved?.primaryKey;
      if (key) void navigate(detailAddress(key)).catch(() => undefined);
    }

    function onDiscarded() {
      setCreating(false);
    }

    // A create draft from the assistant opens the create dialog directly.
    watch(instance.draft, (draft) => {
      if (!draft) return;
      if (!draft.target || !draft.target.id) {
        setCreating(true);
      }
    }, { immediate: true });

    return {
      catalogue, types, allRows, rows, countText, search, creating, createDialog,
      typeLabel, open, startCreate, cancelCreate, onSaved, onDiscarded,
      refresh: () => instance.refreshObjects(),
    };
  },
});
