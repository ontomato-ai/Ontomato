import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelBack, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const TYPE = "platform:BusinessKnowledge";
const NARROW_WIDTH = 760;
const GOVERNANCE_CHAT_ADDRESS = panelAddress("/agents/chat", { agentKind: "knowledge-governance" });

function sameRef(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (a.className ?? TYPE) === (b.className ?? TYPE) && a.primaryKey === b.primaryKey;
}

await mountPanel({
  setup() {
    const ctx = usePanelContext();
    const { instance } = ctx;
    const t = ctx.t ?? ((key) => key);
    // The selection watcher feeds formTarget after the list's local selection handling.
    instance.forms.bindInputState("form", "selected");
    instance.forms.bindInputState("form", "mode");

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const formTarget = computed(() => instance.state.values.value.formTarget ?? null);
    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value === "" ? null : value),
    });
    const mode = computed(() => {
      const value = instance.state.values.value.mode;
      return value === "edit" || value === "create" ? value : "view";
    });
    const editing = computed(() => mode.value !== "view");
    const detailOpen = ref(Boolean(selected.value) || Boolean(formTarget.value) || mode.value !== "view");
    const narrow = ref(false);
    const root = ref(null);
    const returnTarget = ref(selected.value ?? formTarget.value);

    // Unfiltered domain entry count distinguishes an empty domain from a filtered-empty match.
    const domainTotal = usePanelOutput("domainCount", "total");

    // ObjectSummary publishes `label` only when the selected record datum is ready.
    const detailLabel = usePanelOutput("detail", "label");
    const detailReady = computed(() => detailLabel.value !== null);

    function emptyMessage(narrowed) {
      if (typeof domainTotal.value === "number") {
        return t(domainTotal.value > 0 ? "panel.noMatch" : "panel.empty");
      }
      return t(narrowed ? "panel.noMatch" : "panel.empty");
    }

    const formDirty = computed(() => {
      try {
        return Boolean(instance.forms?.dirty?.());
      } catch {
        return false;
      }
    });

    const formBusy = computed(() => {
      try {
        const handle = instance.forms?.handle?.("form");
        return Boolean(handle?.busy?.value ?? handle?.busy);
      } catch {
        return false;
      }
    });

    const formCanSubmit = computed(() => {
      try {
        const handle = instance.forms?.handle?.("form");
        return Boolean(handle?.canSubmit?.value ?? handle?.canSubmit);
      } catch {
        return false;
      }
    });

    let silentDiscard = false;
    function requestDiscard() {
      if (!formDirty.value) return;
      silentDiscard = true;
      try {
        instance.forms?.discard?.("form");
      } finally {
        silentDiscard = false;
      }
    }

    function exitEditing() {
      requestDiscard();
      const restore = formTarget.value ?? returnTarget.value ?? selected.value;
      instance.state.setState({
        mode: "view",
        ...(restore ? { selected: restore, formTarget: restore } : { formTarget: null }),
      });
    }

    const editBack = usePanelBack(() => editing.value, exitEditing, { pushHistory: true });
    usePanelBack(
      () => narrow.value && detailOpen.value && !editing.value,
      () => {
        detailOpen.value = false;
      },
      { pushHistory: false },
    );

    let suppressAutoDetailOpen = false;

    function onListUpdateSelected() {
      // ObjectList emits `update:selected` for automatic fallback selections (`fallbackToFirst`
      // and filter fallback) without emitting `choose`. Keep narrow containers on the list view
      // for those automatic updates; explicit clicks emit `choose` right after and open detail in `onUserSelect`.
      suppressAutoDetailOpen = true;
      void nextTick(() => {
        suppressAutoDetailOpen = false;
      });
    }

    watch(
      selected,
      (value) => {
        if (mode.value === "view") {
          if (value) returnTarget.value = value;
          if (!sameRef(formTarget.value, value)) {
            instance.state.set("formTarget", value ?? null);
          }
          if (!value) {
            detailOpen.value = false;
          } else if (!suppressAutoDetailOpen) {
            detailOpen.value = true;
          }
        } else if (mode.value === "edit" && value) {
          if (suppressAutoDetailOpen) {
            // Keep the directory list unselected during edit when ObjectList triggers fallbackToFirst.
            instance.state.set("selected", null);
            return;
          }
          // External state updates (such as agent `present({ selected: B, mode: "edit" })`)
          // retarget the edit form to `value` and keep the list's reading highlight cleared.
          returnTarget.value = value;
          instance.state.setState({ formTarget: value, selected: null });
          detailOpen.value = true;
        } else if (mode.value === "create" && value && suppressAutoDetailOpen) {
          instance.state.set("selected", null);
        }
      },
      { immediate: true },
    );

    watch(
      mode,
      (next, prev) => {
        if (next === "create") {
          if (selected.value) returnTarget.value = selected.value;
          else if (formTarget.value) returnTarget.value = formTarget.value;
          if (selected.value !== null || formTarget.value !== null) {
            instance.state.setState({ selected: null, formTarget: null });
          }
          detailOpen.value = true;
        } else if (next === "edit") {
          const target = selected.value ?? formTarget.value ?? returnTarget.value ?? null;
          if (target) returnTarget.value = target;
          if (selected.value !== null || !sameRef(formTarget.value, target)) {
            instance.state.setState({ formTarget: target, selected: null });
          }
          detailOpen.value = true;
        } else if (next === "view" && prev !== undefined && prev !== "view" && !formDirty.value) {
          const restore = selected.value ?? formTarget.value ?? returnTarget.value ?? null;
          if (restore && !sameRef(selected.value, restore)) {
            instance.state.setState({ selected: restore, formTarget: restore });
          }
        }
      },
      { immediate: true },
    );

    function onUserSelect(nextSelection) {
      if (!nextSelection) return;
      suppressAutoDetailOpen = false;
      if (!editing.value) {
        detailOpen.value = true;
        return;
      }
      returnTarget.value = nextSelection;
      instance.state.setState({ mode: "view", selected: nextSelection, formTarget: nextSelection });
      detailOpen.value = true;
    }

    function openEdit() {
      if (!selected.value) return;
      const target = selected.value;
      returnTarget.value = target;
      instance.state.setState({ formTarget: target, selected: null, mode: "edit" });
      detailOpen.value = true;
    }

    function openCreate() {
      if (mode.value === "create") {
        detailOpen.value = true;
        return;
      }
      if (selected.value) returnTarget.value = selected.value;
      else if (formTarget.value) returnTarget.value = formTarget.value;
      const applied = instance.state.setState({ mode: "create", selected: null, formTarget: null });
      if (applied === true) detailOpen.value = true;
      else if (applied !== false) void applied.then((ok) => { if (ok) detailOpen.value = true; });
    }

    function openGovernance() {
      void ctx.navigate(GOVERNANCE_CHAT_ADDRESS).catch(() => undefined);
    }

    function cancelEdit() {
      void editBack.back();
    }

    function backToList() {
      // Narrow-screen Back only hides the right pane and preserves any active edit draft.
      detailOpen.value = false;
    }

    function saveForm() {
      try {
        void instance.forms.submit("form").catch(() => undefined);
      } catch {
        // ObjectForm renders validation and owner refusal messages inline.
      }
    }

    function onDiscarded() {
      if (silentDiscard) return;
      const restore = formTarget.value ?? returnTarget.value ?? selected.value;
      instance.state.setState({
        mode: "view",
        ...(restore ? { selected: restore, formTarget: restore } : { formTarget: null }),
      });
    }

    function onSaved(object) {
      const key = object?.primaryKey ?? object?.id ?? object;
      const ref =
        typeof key === "string" && key.length > 0
          ? { className: object?.className ?? TYPE, primaryKey: key }
          : (object?.className ? object : (formTarget.value ?? returnTarget.value ?? selected.value));
      if (ref) returnTarget.value = ref;
      instance.state.setState({ ...(ref ? { selected: ref, formTarget: ref } : {}), mode: "view" });
      detailOpen.value = true;
    }

    let observer;
    onMounted(() => {
      if (root.value && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver((entries) => {
          narrow.value = (entries[0]?.contentRect?.width ?? 0) < NARROW_WIDTH;
        });
        observer.observe(root.value);
      }
    });
    onBeforeUnmount(() => observer?.disconnect());

    return {
      selected,
      search,
      mode,
      editing,
      detailOpen,
      detailReady,
      narrow,
      root,
      formDirty,
      formBusy,
      formCanSubmit,
      t,
      emptyMessage,
      onListUpdateSelected,
      onUserSelect,
      openCreate,
      openGovernance,
      openEdit,
      cancelEdit,
      backToList,
      saveForm,
      onSaved,
      onDiscarded,
    };
  },
});
