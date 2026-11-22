import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";
const DETAIL_PATH = "/ontology/object-detail";

const readyRows = data => (data.value.status === "ready" && Array.isArray(data.value.value) ? data.value.value : []);

function detailAddress(primaryKey) {
  const param = JSON.stringify({ selected: { className: OBJECT_TYPE, primaryKey } });
  return `${DETAIL_PATH}?${new globalThis.URLSearchParams({ state: param })}`;
}

await mountPanel({
  setup() {
    const { instance, t, navigate } = usePanelContext();
    const state = computed(() => instance.state.values.value);
    const catalog = usePanelData("catalog", "rows");

    // A new object type is being made: set by the header's "新建对象类型" command, so an address can open the dialog.
    const creating = computed(() => state.value.creating === true);
    const setCreating = value => instance.state.set("creating", value);

    // The search keyword is public, deep-linkable state, so the assistant and the address see the same filter.
    const search = computed({
      get: () => state.value.search ?? "",
      set: value => instance.state.set("search", value || null),
    });
    const rows = computed(() => readyRows(catalog));
    const filteredRows = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return rows.value;
      return rows.value.filter(row =>
        `${row.fields.showName ?? row.label} ${row.fields.className ?? row.primaryKey} ${row.fields.classDesc ?? ""}`
          .toLowerCase()
          .includes(query));
    });
    // A count waits for the owner's answer: while the list is still being read there is no number to show.
    const catalogCount = computed(() => (catalog.value.status === "ready" ? filteredRows.value.length : null));

    function openClass(primaryKey) {
      if (!primaryKey) return;
      setCreating(false);
      void navigate(detailAddress(primaryKey)).catch(() => undefined);
    }

    // Legacy deep links or cross-panel links targeting `/ontology/objects?state={"selected":...}` forward directly to
    // the dedicated non-menu detail entry and clear local selection so returning to the catalog stays clean.
    watch(() => state.value.selected, value => {
      if (!value?.primaryKey) return;
      const targetKey = value.primaryKey;
      instance.state.setState({ selected: null, creating: false });
      void navigate(detailAddress(targetKey)).catch(() => undefined);
    }, { immediate: true });

    // A create draft link opens the create modal dialog.
    watch(instance.draft, draft => {
      if (!draft) return;
      if (draft.slot === "createForm" && !draft.target?.id) setCreating(true);
    }, { immediate: true });

    function cancelCreate() {
      setCreating(false);
    }
    const createObjectDialog = computed({
      get: () => creating.value,
      set: value => {
        if (!value && creating.value) cancelCreate();
      },
    });
    function objectSaved(object) {
      setCreating(false);
      if (object?.primaryKey) openClass(object.primaryKey);
    }

    return {
      t,
      catalog,
      filteredRows,
      catalogCount,
      search,
      createObjectDialog,
      openClass,
      cancelCreate,
      objectSaved,
    };
  },
});
