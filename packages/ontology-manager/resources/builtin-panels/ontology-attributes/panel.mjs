import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const context = usePanelContext();
    const { instance } = context;
    const values = instance.state.values;
    const selected = computed(() => values.value.selected);
    const className = computed(() => values.value.className || "");
    const search = computed(() => values.value.search || "");

    const typesData = usePanelData("types", "types");
    const rowsData = usePanelData("attributes", "rows");
    const detail = usePanelData("detail", "record");

    // A new attribute is being made: set by the header's "新建属性" command, so an address can open the empty form.
    const creating = computed(() => values.value.creating === true);
    const setCreating = value => instance.state.set("creating", value);
    const selectedKey = computed(() => selected.value?.primaryKey || "");
    // The owner admits "set as primary key" on the attribute that already is one, so the page offers it only on others.
    const isPrimaryKey = computed(() => detail.value.status === "ready" && detail.value.value.fields.primaryKey === "true");

    const types = computed(() => (typesData.value.status === "ready" ? typesData.value.value : []));
    const typeLabel = computed(() => Object.fromEntries(types.value.map(type => [type.primaryKey, type.label])));
    const rows = computed(() => (rowsData.value.status === "ready" ? rowsData.value.value : []));
    const ownerOf = row => row.fields.className || "";
    const ownerLabel = row => typeLabel.value[ownerOf(row)] || ownerOf(row);
    const visibleRows = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return rows.value;
      return rows.value.filter(row =>
        [row.label, row.fields.name, row.fields.type, ownerLabel(row)].join(" ").toLowerCase().includes(query));
    });

    // A count waits for the owner's answer: while the list is still being read there is no number to show.
    const countText = computed(() => (rowsData.value.status === "ready" ? visibleRows.value.length : null));

    const setClassName = value => instance.state.setState({ className: value || null });
    const setSearch = value => instance.state.set("search", value || null);
    const isSelected = row => selected.value?.primaryKey === row.primaryKey;
    const selectedVisible = computed(() => Boolean(selected.value && visibleRows.value.some(row => row.primaryKey === selected.value.primaryKey)));
    const selectRow = row => {
      setCreating(false);
      instance.state.set("selected", isSelected(row) ? null : { className: "platform:Attribute", primaryKey: row.primaryKey });
    };
    // An attribute being edited keeps its own owner type: only a new one is fixed to the class being created in.
    watch(selected, value => {
      if (value && values.value.createIn) instance.state.set("createIn", null);
    });
    const closeEditor = () => {
      instance.state.setState({ selected: null, createIn: null, creating: false });
    };
    // One owner form edits the selected attribute and, with nothing selected, creates one; the host selects what it created.
    const onSaved = () => { setCreating(false); };
    const onDiscarded = () => {
      if (selected.value) return;
      instance.state.setState({ creating: false, createIn: null });
    };
    const yes = value => value === "true";
    const openOwner = row => context.navigate(`/ontology/objects/${encodeURIComponent(ownerOf(row))}`);

    // When the selected attribute leaves the owner's list (it was deleted), the page lets go of it.
    let lastList = null;
    watch(rowsData, state => {
      if (state.status !== "ready") return;
      const now = { filter: className.value, rows: state.value };
      const before = lastList;
      lastList = now;
      const key = selected.value?.primaryKey;
      if (!key || !before || before.filter !== now.filter) return;
      const listed = list => list.some(row => row.primaryKey === key);
      if (listed(before.rows) && !listed(now.rows)) instance.state.set("selected", null);
    });

    // A draft opens the form: in creation for a new attribute, in editing for an existing one. A create draft brings its
    // own owner type, so the page stops fixing the class it was filtered to.
    watch(instance.draft, draft => {
      if (!draft) return;
      if (draft.target?.id) setCreating(false);
      else instance.state.setState({ creating: true, createIn: null });
    }, { immediate: true });

    return {
      selected, selectedKey, selectedVisible, isPrimaryKey, className, search, typesData, rowsData, detail, creating, types, rows, visibleRows,
      ownerLabel, countText, setClassName, setSearch, isSelected, selectRow, closeEditor, onSaved, onDiscarded, yes, openOwner,
    };
  },
});
