import { computed, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelData, usePanelFormDraft } from "@ontomato/sdk/panel";

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
    // Match the original catalog count format (`14 项`, and `0 项` when no rows match the filter).
    const countText = computed(() => {
      if (catalogue.value.status !== "ready") return "";
      return `${rows.value.length} 项`;
    });

    // A new relation is being made: set by the header's "新建关系类型" command, so an address can open the empty form.
    const creating = computed(() => instance.state.values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value);
    const title = computed(() => {
      if (creating.value) return "新建关系类型";
      return detail.value.status === "ready" ? detail.value.value.label || selectedKey.value : selectedKey.value;
    });

    const formHandle = computed(() => instance.forms.handle("form"));
    const saving = computed(() => Boolean(formHandle.value?.busy.value));
    const canSave = computed(() => Boolean(formHandle.value) && !saving.value);

    async function saveDetail() {
      if (!canSave.value) return;
      if (!instance.forms.dirty()) return;
      try {
        await instance.forms.submit("form");
      } catch {
        // ObjectForm renders the owner's validation or refusal message inline on the form.
      }
    }

    function open(row) {
      setCreating(false);
      instance.state.set("selected", { className: TYPE, primaryKey: row.primaryKey });
    }
    function backToCatalog() {
      instance.state.setState({ selected: null, creating: false });
    }
    const back = usePanelBack(
      () => Boolean(selectedKey.value),
      backToCatalog,
      { pushHistory: true },
    );
    const detailDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && detail.value.status === "ready",
    });
    function startCreate() {
      instance.state.setState({ creating: true, selected: null });
    }
    function goBack() {
      void back.back();
    }
    function cancelCreate() {
      instance.state.setState({ creating: false, selected: null });
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
    // Open the object types panel directly with its deep-linkable `selected` state.
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
    // held stays selected, so the page shows the missing-relation empty state instead of silently falling back.
    const seen = new Set();
    watch([allRows, () => catalogue.value.status], ([list, status]) => {
      if (status !== "ready") return;
      for (const row of list) seen.add(row.primaryKey);
      const key = selectedKey.value;
      if (key && seen.has(key) && !list.some((row) => row.primaryKey === key)) {
        instance.state.set("selected", null);
      }
    }, { immediate: true });

    return {
      catalogue, detail, types, allRows, rows, countText, selectedKey, search, creating, createDialog, title,
      saving, canSave, detailDraft, typeLabel, open, backToCatalog, goBack, startCreate, cancelCreate, saveDetail, onSaved, onDiscarded, openType,
      refresh: () => instance.refreshObjects(),
    };
  },
});
