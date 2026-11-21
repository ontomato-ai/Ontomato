import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

const TYPE = "platform:BusinessKnowledge";
const NARROW_WIDTH = 720;

await mountPanel({
  setup() {
    const ctx = usePanelContext();
    const { instance } = ctx;
    const t = ctx.t ?? ((key) => key);

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const formTarget = computed(() => instance.state.values.value.formTarget ?? null);
    const mode = computed(() => {
      const value = instance.state.values.value.mode;
      return value === "edit" || value === "create" ? value : "view";
    });
    const editing = computed(() => mode.value !== "view");
    const detailOpen = ref(mode.value !== "view");
    const narrow = ref(false);
    const root = ref(null);
    const formProj = ref(null);

    const probe = usePanelData("probe", "rows", () => ({ size: 200 }));
    const visibleKeys = computed(() => {
      const result = probe.value?.status === "ready" ? probe.value.value : null;
      const rows = Array.isArray(result) ? result : result?.rows;
      return new Set((rows ?? []).map((row) => row.primaryKey).filter(Boolean));
    });

    const dirty = () => {
      try {
        return Boolean(instance.dirty?.());
      } catch {
        return false;
      }
    };

    const formBusy = computed(() => {
      try {
        const handle = instance.forms?.handle?.("form");
        return Boolean(handle?.busy?.value ?? handle?.busy);
      } catch {
        return false;
      }
    });

    function discardForm() {
      const el = formProj.value?.$el ?? formProj.value;
      el?.querySelector?.(".sdk-owner-form-actions button")?.click();
    }

    let silentDiscard = false;
    function requestDiscard() {
      if (!dirty()) return;
      silentDiscard = true;
      discardForm();
    }

    let prevSelected = null;
    watch(selected, (_value, old) => {
      prevSelected = old ?? null;
    });

    watch(
      mode,
      (next, prev) => {
        if (next === "create") {
          if (prev === "edit" && !(instance.draft?.value ?? instance.draft)) {
            if (dirty() && !window.confirm(t("panel.discardConfirm"))) {
              instance.state.set("mode", "edit");
              return;
            }
            requestDiscard();
          }
          if (formTarget.value !== null) instance.state.set("formTarget", null);
          detailOpen.value = true;
        } else if (next === "edit") {
          if (!formTarget.value && selected.value) instance.state.set("formTarget", selected.value);
          detailOpen.value = true;
        }
      },
      { immediate: true },
    );

    function onUserSelect() {
      detailOpen.value = true;
      if (!editing.value) return;
      const target = formTarget.value;
      const previousMissing = prevSelected != null && !visibleKeys.value.has(prevSelected.primaryKey);
      if (previousMissing) {
        // The list re-selected automatically because the previous row was
        // filtered out; keep editing the form target. While creating, keep
        // the previous row selected so cancel still lands on it.
        if (target == null && prevSelected) instance.state.set("selected", prevSelected);
        return;
      }
      if (!dirty()) {
        instance.state.setState({ mode: "view", formTarget: selected.value });
        return;
      }
      if (window.confirm(t("panel.discardConfirm"))) {
        requestDiscard();
        instance.state.setState({ mode: "view", formTarget: selected.value });
      } else {
        instance.state.set("selected", target ?? prevSelected);
      }
    }

    function openEdit() {
      if (!selected.value) return;
      instance.state.setState({ formTarget: selected.value, mode: "edit" });
    }

    function cancelEdit() {
      if (dirty() && !window.confirm(t("panel.discardConfirm"))) return;
      requestDiscard();
      instance.state.setState({
        mode: "view",
        ...(formTarget.value ? { selected: formTarget.value } : {}),
        formTarget: formTarget.value ?? selected.value,
      });
    }

    function saveForm() {
      try {
        instance.forms.submit("form");
      } catch {
        // The built-in actions are hidden; a failed programmatic submit just
        // leaves the form open for the user to retry.
      }
    }

    function onDiscarded() {
      if (silentDiscard) {
        silentDiscard = false;
        return;
      }
      instance.state.setState({ mode: "view", formTarget: selected.value });
    }

    function onSaved(object) {
      const key = object?.primaryKey ?? object?.id ?? object;
      const ref =
        typeof key === "string" && key.length > 0
          ? { className: object?.className ?? TYPE, primaryKey: key }
          : (object?.className ? object : selected.value);
      instance.state.setState({ ...(ref ? { selected: ref, formTarget: ref } : {}), mode: "view" });
      detailOpen.value = true;
    }

    watch(
      () => instance.draft?.value ?? instance.draft,
      (draft) => {
        if (!draft) return;
        detailOpen.value = true;
        if (draft.target?.id) {
          const ref = { className: TYPE, primaryKey: draft.target.id };
          instance.state.setState({ selected: ref, formTarget: ref, mode: "edit" });
        } else {
          instance.state.setState({ formTarget: null, mode: "create" });
        }
      },
    );

    // The panel stylesheet is scope-limited to outside member projections, so
    // hide the form's own actions row with a document-level rule instead; the
    // hidden discard button still drives programmatic discards.
    const actionStyle = document.createElement("style");
    actionStyle.textContent = ".sdk-owner-form-actions{display:none!important}";
    document.head.appendChild(actionStyle);
    onBeforeUnmount(() => actionStyle.remove());

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
      mode,
      editing,
      detailOpen,
      narrow,
      root,
      formProj,
      formBusy,
      t,
      onUserSelect,
      openEdit,
      cancelEdit,
      saveForm,
      onSaved,
      onDiscarded,
    };
  },
});
