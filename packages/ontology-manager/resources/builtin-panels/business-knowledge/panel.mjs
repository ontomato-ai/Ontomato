import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const TYPE = "platform:BusinessKnowledge";
const NARROW_WIDTH = 760;

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
    const detailOpen = ref(Boolean(selected.value) || mode.value !== "view");
    const narrow = ref(false);
    const root = ref(null);
    const returnTarget = ref(selected.value);

    // ObjectSummary publishes `label` only when the selected record datum is ready.
    const detailLabel = usePanelOutput("detail", "label");
    const detailReady = computed(() => detailLabel.value !== null);

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

    async function confirmLeave() {
      if (!formDirty.value) return true;
      if (ctx.confirmLeaveUnsaved) return ctx.confirmLeaveUnsaved();
      return true;
    }

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
    const narrowBack = usePanelBack(
      () => narrow.value && detailOpen.value && !editing.value,
      () => {
        detailOpen.value = false;
      },
      { pushHistory: false },
    );

    let prevSelected = selected.value;
    let handlingUserSelect = false;
    let suppressAutoDetailOpen = false;
    let closingToList = false;

    function onListUpdateSelected() {
      // ObjectList emits `update:selected` for automatic fallback selections (`fallbackToFirst`
      // and filter fallback) without emitting `choose`. Keep narrow containers on the list view
      // for those automatic updates; explicit clicks emit `choose` synchronously right after and
      // open detail in `onUserSelect`.
      suppressAutoDetailOpen = true;
      void nextTick(() => {
        suppressAutoDetailOpen = false;
      });
    }

    watch(
      selected,
      (value, old) => {
        if (old !== undefined) prevSelected = old ?? null;
        if (handlingUserSelect) return;
        if (mode.value === "view" || mode.value === "edit") {
          if (value) returnTarget.value = value;
          if (!sameRef(formTarget.value, value)) {
            instance.state.set("formTarget", value ?? null);
          }
        }
      },
      { immediate: true },
    );
    watch([selected, editing], ([sel, isEditing]) => {
      if (isEditing) {
        detailOpen.value = true;
        return;
      }
      if (!sel) {
        detailOpen.value = false;
        return;
      }
      if (suppressAutoDetailOpen || closingToList) return;
      detailOpen.value = true;
    });

    let revertingMode = false;
    watch(
      mode,
      async (next, prev) => {
        if (revertingMode) {
          revertingMode = false;
          return;
        }
        if (next === "create") {
          if (prev === "edit") {
            if (!(await confirmLeave())) {
              revertingMode = true;
              instance.state.set("mode", "edit");
              return;
            }
            requestDiscard();
          }
          if (selected.value) returnTarget.value = selected.value;
          if (selected.value !== null || formTarget.value !== null) {
            instance.state.setState({ selected: null, formTarget: null });
          }
          detailOpen.value = true;
        } else if (next === "edit") {
          if (!sameRef(formTarget.value, selected.value)) {
            instance.state.set("formTarget", selected.value);
          }
          if (selected.value) returnTarget.value = selected.value;
          detailOpen.value = true;
        }
      },
      { immediate: true },
    );

    async function onUserSelect(nextSelection) {
      if (!nextSelection) return;
      suppressAutoDetailOpen = false;
      detailOpen.value = true;
      if (!editing.value) return;

      // ObjectList writes `selected` synchronously before emitting `choose`; defer
      // syncing `formTarget` until leave confirmation resolves so dirty edits stay intact.
      handlingUserSelect = true;
      try {
        const target = formTarget.value;
        if (!(await confirmLeave())) {
          instance.state.set("selected", mode.value === "create" ? null : (target ?? prevSelected));
          return;
        }
        requestDiscard();
        returnTarget.value = nextSelection;
        instance.state.setState({ mode: "view", selected: nextSelection, formTarget: nextSelection });
      } finally {
        handlingUserSelect = false;
      }
    }

    function openEdit() {
      if (!selected.value) return;
      returnTarget.value = selected.value;
      instance.state.setState({ formTarget: selected.value, mode: "edit" });
      detailOpen.value = true;
    }

    function cancelEdit() {
      void editBack.back();
    }

    function backToList() {
      if (editing.value) {
        closingToList = true;
        void editBack
          .back()
          .then((left) => {
            if (left) detailOpen.value = false;
          })
          .finally(() => {
            void nextTick(() => {
              closingToList = false;
            });
          });
        return;
      }
      void narrowBack.back();
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
          : (object?.className ? object : selected.value);
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
      onListUpdateSelected,
      onUserSelect,
      openCreate: () => instance.state.set("mode", "create"),
      refresh: () => instance.refreshObjects(),
      openEdit,
      cancelEdit,
      backToList,
      saveForm,
      onSaved,
      onDiscarded,
    };
  },
});
