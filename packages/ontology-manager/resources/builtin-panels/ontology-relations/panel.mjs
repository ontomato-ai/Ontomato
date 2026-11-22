import { computed, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelNarrow } from "@ontomato/sdk/panel";

const TYPE = "platform:Relationship";
const OBJECT_TYPE = "platform:ObjectType";

await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, navigate, t } = panel;

    const rootRef = ref(null);
    const detailBodyRef = ref(null);
    const narrow = usePanelNarrow(rootRef);

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));
    const creating = computed(() => instance.state.values.value.creating === true);
    const hasDetailView = computed(() => creating.value || Boolean(selectedKey.value));

    const showList = computed(() => !narrow.value || !hasDetailView.value);
    const showDetail = computed(() => !narrow.value || hasDetailView.value);

    const setCreating = (value) => instance.state.set("creating", value);

    // Selecting a row exits create mode automatically.
    watch(selectedKey, (next) => {
      if (next && creating.value) setCreating(false);
    });

    // Reset detail scroll position when switching items or entering create mode.
    watch([selectedKey, creating], () => {
      if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
    });

    // Register Escape and browser Back for create mode and narrow-screen detail view.
    const backActive = computed(() => creating.value || (narrow.value && Boolean(selectedKey.value)));
    const { back } = usePanelBack(backActive, () => {
      if (creating.value) {
        setCreating(false);
        return;
      }
      if (narrow.value && selectedKey.value) {
        instance.state.set("selected", null);
      }
    });

    function onSaved(saved) {
      setCreating(false);
      if (saved?.primaryKey) {
        instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
      }
    }

    function onCancel() {
      setCreating(false);
    }

    function onDiscarded() {
      if (creating.value) setCreating(false);
    }

    function onOperationDone(operationName) {
      if (operationName === "delete") {
        instance.state.set("selected", null);
      }
    }

    async function onNavigate(reference) {
      if (!reference || reference.className !== OBJECT_TYPE || !reference.primaryKey) return;
      const state = JSON.stringify({ selected: { className: OBJECT_TYPE, primaryKey: reference.primaryKey } });
      try {
        await navigate(`/ontology/objects?${new globalThis.URLSearchParams({ state })}`);
      } catch {
        panel.notify({ kind: "error", text: t("relations.navigateFailed") });
      }
    }

    // Open the form named by an assistant draft (create draft or edit draft for a specific relation).
    watch(instance.draft, (draft) => {
      if (!draft) return;
      if (draft.target?.id) {
        setCreating(false);
        if (draft.target.id !== selectedKey.value) {
          instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
        }
      } else {
        setCreating(true);
        instance.state.set("selected", null);
      }
    }, { immediate: true });

    return {
      rootRef,
      detailBodyRef,
      narrow,
      selectedKey,
      creating,
      hasDetailView,
      showList,
      showDetail,
      back,
      onSaved,
      onCancel,
      onDiscarded,
      onOperationDone,
      onNavigate,
    };
  },
});
