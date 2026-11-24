import { computed, ref, watch } from "vue";
import {
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

    // Keep create mode consistent for both humans and agents:
    // entering `creating` clears any open detail and fixes `createIn` to the active `className` filter
    // unless the caller already specified `createIn`; leaving `creating` clears `createIn`.
    watch(
      creating,
      (next) => {
        if (next) {
          const patch = {};
          if (selectedKey.value) patch.selected = null;
          const activeClass = className.value || ownerFilterKey.value;
          if (!values.value.createIn && activeClass) patch.createIn = activeClass;
          if (Object.keys(patch).length > 0) instance.state.setState(patch);
          return;
        }
        if (values.value.createIn) instance.state.set("createIn", null);
      },
      { immediate: true },
    );

    // An edited attribute keeps its own owner type; switching to an existing attribute exits create mode.
    watch(selectedKey, (next) => {
      if (!next || !selectedKey.value) return;
      const patch = {};
      if (creating.value) patch.creating = false;
      if (values.value.createIn) patch.createIn = null;
      if (Object.keys(patch).length > 0) instance.state.setState(patch);
    });

    // Read-only outputs published by the list and detail projections.
    const filteredCount = usePanelOutput("attributes", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : t("attr.count", { count: filteredCount.value })));

    const headerStatus = usePanelOutput("detail", "status");
    const detailStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailError = usePanelOutput("detail", "errorMessage");
    const detailErrorText = computed(() => {
      const message = typeof detailError.value === "string" ? detailError.value.trim() : "";
      return message || t("attr.loadError");
    });

    // Track whether the currently selected attribute has loaded at least once so a transient
    // re-read failure does not unmount the edit form or drop unsaved edits.
    const detailEverReady = ref(false);
    watch(
      [selectedKey, detailStatus],
      ([key, status], previous) => {
        const prevKey = previous?.[0] ?? "";
        if (!key) {
          detailEverReady.value = false;
          return;
        }
        if (key !== prevKey) {
          detailEverReady.value = !prevKey && status === "ready";
          return;
        }
        if (status === "ready") detailEverReady.value = true;
      },
      { immediate: true },
    );

    const showDetailBody = computed(
      () =>
        detailEverReady.value
        && detailStatus.value !== "forbidden"
        && detailStatus.value !== "empty"
        && detailStatus.value !== "missing",
    );

    const formDraft = usePanelFormDraft("form", {
      when: () => Boolean(selectedKey.value) && showDetailBody.value,
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

    function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      closeDetail();
    }

    return {
      rootRef,
      narrow,
      selectedKey,
      detailStatus,
      detailEverReady,
      detailErrorText,
      showDetailBody,
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
      onRemoveDone,
      refresh: () => instance.refreshObjects(),
    };
  },
});
