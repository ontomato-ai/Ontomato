import { computed, watch } from "vue";
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
    // The count waits for the owner's answer: while reading, or when the read failed, there is no number to show.
    const countText = computed(() => {
      if (catalogue.value.status !== "ready") return "";
      const shown = rows.value.length;
      const total = allRows.value.length;
      return search.value.trim() && shown !== total ? `${shown} / ${total} 项` : `${total} 项`;
    });

    // A new relation is being made: set by the header's "新建关系类型" command, so an address can open the empty form.
    const creating = computed(() => instance.state.values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value);
    // The form is drawn while a new relation is being made, or for a relation the owner actually returned: a missing or
    // unreadable relation shows the empty state alone, without a form that could only fail.
    const editing = computed(() => creating.value || (Boolean(selectedKey.value) && detail.value.status === "ready"));
    const title = computed(() => {
      if (creating.value) return "新建关系类型";
      return detail.value.status === "ready" ? detail.value.value.label || selectedKey.value : selectedKey.value;
    });
    // With nothing selected the column says what it is for, in agreement with what the list shows: nothing while the
    // list is still reading or failed (the list says so), and no "pick one on the left" when the left has nothing.
    const idleNote = computed(() => {
      if (catalogue.value.status !== "ready") return "";
      if (!allRows.value.length) return "新建一条关系类型后，在这里查看两端对象、修改说明和关联字段。";
      if (!rows.value.length) return "没有可选的关系类型：清空或换个搜索词后，再从左侧选一条。";
      return "从左侧选一条关系类型，在这里查看两端对象、修改说明和关联字段。";
    });

    function open(row) {
      setCreating(false);
      instance.state.set("selected", { className: TYPE, primaryKey: row.primaryKey });
    }
    function backToCatalog() {
      instance.state.setState({ selected: null, creating: false });
    }
    function cancelCreate() {
      setCreating(false);
      instance.state.set("selected", null);
    }
    const createDialog = computed({
      get: () => creating.value && !selectedKey.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });
    function onSaved(saved) {
      setCreating(false);
      instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
    }
    function onDiscarded() {
      setCreating(false);
    }
    // Open the object types panel directly with its deep-linkable `selected` state rather than the retired detail path.
    function openType(className) {
      if (!className) return;
      const state = JSON.stringify({ selected: { className: "platform:ObjectType", primaryKey: className } });
      void navigate(`/ontology/objects?${new globalThis.URLSearchParams({ state })}`).catch(() => undefined);
    }

    // A draft the assistant wrote opens the form it names: a create draft for a new relation, otherwise that relation's.
    watch(instance.draft, (draft) => {
      if (!draft) return;
      if (draft.target && draft.target.id) {
        setCreating(false);
        if (draft.target.id !== selectedKey.value) instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
      } else {
        setCreating(true);
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
      catalogue, detail, types, allRows, rows, countText, selectedKey, search, creating, createDialog, editing, title, idleNote,
      typeLabel, open, backToCatalog, cancelCreate, onSaved, onDiscarded, openType,
    };
  },
});
