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
    const checked = computed(() => instance.state.values.value.checked ?? []);
    const mode = ref("view");
    const detailOpen = ref(false);
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

    const confirmDiscard = () => !dirty() || window.confirm(t("panel.discardConfirm"));

    let prevSelected = null;
    watch(selected, (_value, old) => {
      prevSelected = old ?? null;
    });

    function newRecord() {
      if (!confirmDiscard()) return;
      requestDiscard();
      instance.state.set("formTarget", null);
      mode.value = "edit";
      detailOpen.value = true;
    }

    function onUserSelect() {
      detailOpen.value = true;
      if (mode.value !== "edit") return;
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
        mode.value = "view";
        instance.state.set("formTarget", selected.value);
        return;
      }
      if (window.confirm(t("panel.discardConfirm"))) {
        requestDiscard();
        mode.value = "view";
        instance.state.set("formTarget", selected.value);
      } else {
        instance.state.set("selected", target ?? prevSelected);
      }
    }

    function clearChecked() {
      instance.state.set("checked", []);
    }

    function openEdit() {
      if (!selected.value) return;
      instance.state.set("formTarget", selected.value);
      mode.value = "edit";
    }

    function cancelEdit() {
      if (dirty() && !window.confirm(t("panel.discardConfirm"))) return;
      requestDiscard();
      mode.value = "view";
      if (formTarget.value) instance.state.set("selected", formTarget.value);
      instance.state.set("formTarget", selected.value);
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
      mode.value = "view";
      instance.state.setState({ formTarget: selected.value });
    }

    function onSaved(object) {
      const key = object?.primaryKey ?? object?.id ?? object;
      const ref =
        typeof key === "string" && key.length > 0
          ? { className: object?.className ?? TYPE, primaryKey: key }
          : (object?.className ? object : selected.value);
      if (ref) instance.state.setState({ selected: ref, formTarget: ref });
      mode.value = "view";
      detailOpen.value = true;
    }

    watch(
      () => instance.draft?.value ?? instance.draft,
      (draft) => {
        if (!draft) return;
        mode.value = "edit";
        detailOpen.value = true;
        if (draft.target?.id) {
          const ref = { className: TYPE, primaryKey: draft.target.id };
          instance.state.setState({ selected: ref, formTarget: ref });
        } else {
          instance.state.set("formTarget", null);
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
      checked,
      mode,
      detailOpen,
      narrow,
      root,
      formProj,
      formBusy,
      t,
      newRecord,
      onUserSelect,
      clearChecked,
      openEdit,
      cancelEdit,
      saveForm,
      onSaved,
      onDiscarded,
    };
  },
});
