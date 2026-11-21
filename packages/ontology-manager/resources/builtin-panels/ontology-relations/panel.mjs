import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const TYPE = "platform:Relationship";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value),
    });

    const catalogue = usePanelData("catalogue", "rows");
    const types = usePanelData("types", "rows");
    const detail = usePanelData("detail", "record");

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
    const countText = computed(() => {
      const shown = rows.value.length;
      const total = allRows.value.length;
      return search.value.trim() && shown !== total ? `${shown} / ${total} 条` : `${total} 条`;
    });

    const creating = ref(false);
    // The form is drawn while a new relation is being made, or for a relation the owner actually returned: a missing or
    // unreadable relation shows the empty state alone, without a form that could only fail.
    const editing = computed(() => creating.value || (Boolean(selectedKey.value) && detail.value.status === "ready"));
    const title = computed(() => {
      if (creating.value) return "新建关系类型";
      if (!selectedKey.value) return "关系类型";
      return detail.value.status === "ready" ? detail.value.value.label || selectedKey.value : selectedKey.value;
    });

    function open(row) {
      creating.value = false;
      instance.state.set("selected", { className: TYPE, primaryKey: row.primaryKey });
    }
    function startCreate() {
      creating.value = true;
      instance.state.set("selected", null);
    }
    function cancelCreate() {
      creating.value = false;
      instance.state.set("selected", null);
    }
    function onSaved(saved) {
      creating.value = false;
      instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
    }
    function onDiscarded() {
      creating.value = false;
    }
    function openType(className) {
      if (className) void navigate(`/ontology/objects/${encodeURIComponent(className)}`);
    }

    // A draft the assistant wrote opens the form it names: a create draft for a new relation, otherwise that relation's.
    watch(instance.draft, (draft) => {
      if (!draft) return;
      if (draft.target && draft.target.id) {
        creating.value = false;
        if (draft.target.id !== selectedKey.value) instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
      } else {
        creating.value = true;
        instance.state.set("selected", null);
      }
    }, { immediate: true });

    // A relation the list showed and no longer does was deleted: go back to the catalogue. A relation the list never
    // held stays selected, so the page can say it is not there.
    const seen = new Set();
    watch([allRows, () => catalogue.value.status], ([rows, status]) => {
      if (status !== "ready") return;
      for (const row of rows) seen.add(row.primaryKey);
      const key = selectedKey.value;
      if (key && seen.has(key) && !rows.some((row) => row.primaryKey === key)) {
        instance.state.set("selected", null);
      }
    }, { immediate: true });

    return {
      catalogue, detail, types, allRows, rows, countText, selectedKey, search, creating, editing, title,
      typeLabel, open, startCreate, cancelCreate, onSaved, onDiscarded, openType,
    };
  },
});
