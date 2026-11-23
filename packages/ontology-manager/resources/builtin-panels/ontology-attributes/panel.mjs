import { computed, ref, watch } from "vue";
import {
  draftTarget,
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelNarrow,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const ATTRIBUTE_TYPE = "platform:Attribute";
const OBJECT_TYPE = "platform:ObjectType";

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const values = instance.state.values;
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const selected = computed(() => values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));
    const className = computed(() => values.value.className || "");
    const ownerFilterKey = computed(() => values.value.ownerFilter?.primaryKey || "");
    const creating = computed(() => values.value.creating === true);

    const search = computed({
      get: () => values.value.search ?? "",
      set: (value) => instance.state.set("search", value || null),
    });

    // Keep the deep-linkable scalar `className` and ReferencePicker's object `ownerFilter` synchronized.
    watch(
      className,
      (next) => {
        if (next === ownerFilterKey.value) return;
        instance.state.set("ownerFilter", next ? { className: OBJECT_TYPE, primaryKey: next } : null);
      },
      { immediate: true },
    );
    watch(ownerFilterKey, (next) => {
      if (next === className.value) return;
      instance.state.set("className", next || null);
    });

    // An edited attribute keeps its own owner type; only creation fixes `/className` to the filtered class.
    watch(selectedKey, (next) => {
      if (next && values.value.createIn) instance.state.set("createIn", null);
    });

    // Read-only outputs published by the list and detail projections.
    const filteredCount = usePanelOutput("attributes", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : t("attr.count", { count: filteredCount.value })));

    const headerStatus = usePanelOutput("detail", "status");
    const detailStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const isPrimaryKeyOutput = usePanelOutput("detail", "isPrimaryKey");
    const isPrimaryKey = computed(() => isPrimaryKeyOutput.value === true);

    const formDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && detailStatus.value === "ready",
    });

    function closeDetail() {
      instance.state.setState({ selected: null, createIn: null, creating: false });
    }

    const { back } = usePanelBack(() => Boolean(selectedKey.value), closeDetail, {
      pushHistory: true,
      forms: "form",
    });

    function onChoose(ref) {
      if (!ref?.primaryKey) return;
      if (creating.value || values.value.createIn) {
        instance.state.setState({ creating: false, createIn: null });
      }
    }

    function openOwner(reference) {
      const owner = reference?.primaryKey;
      if (!owner) return;
      void navigate(panelAddress("/ontology/objects", { selected: owner })).catch(() => undefined);
    }

    function clearFilters() {
      instance.state.setState({ className: null, ownerFilter: null, search: null });
    }

    function startCreate() {
      instance.state.setState({ creating: true, selected: null, createIn: className.value || null });
    }

    function cancelCreate() {
      instance.state.setState({ creating: false, createIn: null });
    }

    const createDialog = computed({
      get: () => creating.value && !selectedKey.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });

    function onSaved(saved) {
      const key = saved?.primaryKey;
      const patch = { creating: false, createIn: null };
      if (key && key !== selectedKey.value) {
        patch.selected = { className: saved.className || ATTRIBUTE_TYPE, primaryKey: key };
      }
      instance.state.setState(patch);
    }

    function onDiscarded() {
      if (selectedKey.value) return;
      cancelCreate();
    }

    function onSetPrimaryKeyDone(outcome) {
      if (outcome?.kind !== "success") return;
      instance.refreshObjects();
    }

    function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      closeDetail();
    }

    // Open the target editor or create dialog for an accepted assistant draft. A create draft brings its own
    // `className`, so clear `createIn` instead of fixing the current list filter.
    watch(
      instance.draft,
      (draft) => {
        if (!draft) return;
        const target = draftTarget(draft);
        if (target.kind === "update") {
          const patch = { creating: false, createIn: null };
          if (target.id && target.id !== selectedKey.value) {
            patch.selected = { className: ATTRIBUTE_TYPE, primaryKey: target.id };
          }
          instance.state.setState(patch);
        } else {
          instance.state.setState({ creating: true, selected: null, createIn: null });
        }
      },
      { immediate: true },
    );

    return {
      rootRef,
      narrow,
      selectedKey,
      detailStatus,
      isPrimaryKey,
      search,
      countText,
      creating,
      createDialog,
      formDraft,
      back,
      onChoose,
      openOwner,
      clearFilters,
      startCreate,
      cancelCreate,
      onSaved,
      onDiscarded,
      onSetPrimaryKeyDone,
      onRemoveDone,
      refresh: () => instance.refreshObjects(),
    };
  },
});
