import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const TYPE = "platform:BusinessKnowledge";
const NARROW_WIDTH = 760;

await mountPanel({
  setup() {
    const ctx = usePanelContext();
    const { instance } = ctx;
    const t = ctx.t ?? ((key) => key);

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const checked = computed(() => {
      const value = instance.state.values.value.checked;
      return Array.isArray(value) ? value : [];
    });
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
    const detailOpen = ref(mode.value !== "view");
    const narrow = ref(false);
    const root = ref(null);
    const returnTarget = ref(selected.value);

    const probe = usePanelData("probe", "rows", () => ({ size: 200 }));
    const detailData = usePanelData("detail", "record");

    const probeRows = computed(() => {
      const result = probe.value?.status === "ready" ? probe.value.value : null;
      return Array.isArray(result) ? result : (result?.rows ?? []);
    });
    const visibleKeys = computed(() => new Set(probeRows.value.map((row) => row.primaryKey).filter(Boolean)));
    const probePendingByKey = computed(() => {
      const map = new Map();
      for (const row of probeRows.value) {
        if (row?.primaryKey) map.set(row.primaryKey, row.tones?.status === "warning");
      }
      return map;
    });
    const checkedHasPending = computed(() => {
      if (!checked.value.length) return false;
      return checked.value.some((item) => {
        const key = item?.primaryKey;
        if (!key || !probePendingByKey.value.has(key)) return true;
        return probePendingByKey.value.get(key) === true;
      });
    });

    const detailReady = computed(() => detailData.value?.status === "ready");
    const selectedIsPending = computed(
      () => detailReady.value && detailData.value.value?.tones?.status === "warning",
    );

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
    watch(selected, (value, old) => {
      prevSelected = old ?? null;
      if (value && mode.value === "view") returnTarget.value = value;
    });

    const activeDraft = computed(() => {
      const candidate = instance.draft;
      if (candidate && typeof candidate === "object" && "value" in candidate) {
        return candidate.value ?? null;
      }
      return candidate ?? null;
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
          if (prev === "edit" && !activeDraft.value) {
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
          if (!formTarget.value && selected.value) instance.state.set("formTarget", selected.value);
          detailOpen.value = true;
        }
      },
      { immediate: true },
    );

    let revertingSelection = false;
    async function onUserSelect(nextSelection) {
      if (revertingSelection) {
        revertingSelection = false;
        return;
      }
      if (!nextSelection) return;
      detailOpen.value = true;
      if (!editing.value) return;

      const target = formTarget.value;
      const previousMissing = prevSelected != null && !visibleKeys.value.has(prevSelected.primaryKey);
      if (previousMissing && mode.value === "edit") return;

      if (!(await confirmLeave())) {
        revertingSelection = true;
        instance.state.set("selected", mode.value === "create" ? null : (target ?? prevSelected));
        return;
      }
      requestDiscard();
      returnTarget.value = nextSelection;
      instance.state.setState({ mode: "view", selected: nextSelection, formTarget: nextSelection });
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
        void editBack.back().then((left) => {
          if (left) detailOpen.value = false;
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

    watch(
      activeDraft,
      (draft) => {
        if (!draft) return;
        detailOpen.value = true;
        if (draft.target?.id) {
          const ref = { className: TYPE, primaryKey: draft.target.id };
          returnTarget.value = ref;
          instance.state.setState({ selected: ref, formTarget: ref, mode: "edit" });
        } else {
          if (selected.value) returnTarget.value = selected.value;
          instance.state.setState({ selected: null, formTarget: null, mode: "create" });
        }
      },
      { immediate: true },
    );

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
      selectedIsPending,
      checkedHasPending,
      narrow,
      root,
      formDirty,
      formBusy,
      t,
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
