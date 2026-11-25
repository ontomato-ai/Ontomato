import { computed, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelFormDraft, usePanelNarrow, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const root = ref(null);
    const narrow = usePanelNarrow(root);
    const values = instance.state.values;
    const selected = computed(() => values.value.selected);
    const mode = computed(() => values.value.mode);
    const detailOpen = ref(Boolean(selected.value));
    const listed = usePanelOutput("list", "listed");
    const detailStatus = usePanelOutput("detail", "status");
    const ready = computed(() => detailStatus.value === "ready");
    const formSlot = computed(() => {
      if (mode.value === "create") return "createForm";
      return mode.value === "edit" && ready.value ? "editForm" : null;
    });
    const formDraft = usePanelFormDraft(formSlot);
    const editing = computed(() => mode.value !== "view");
    const editBack = usePanelBack(editing, () => instance.state.set("mode", "view"), {
      forms: () => mode.value === "create" ? "createForm" : "editForm",
    });
    const detailBack = usePanelBack(
      () => narrow.value && detailOpen.value && !editing.value,
      () => { detailOpen.value = false; },
      { pushHistory: false, forms: [] },
    );

    // A supplied selection survives missing records and every subsequent list update.
    if (!selected.value && mode.value === "view") {
      const stop = watch([listed, selected, mode], ([refs, target, view]) => {
        if (!target && view === "view" && refs === null) return;
        stop();
        if (!target && view === "view" && refs.length) instance.state.set("selected", refs[0]);
      });
    }
    watch(selected, (target) => { detailOpen.value = Boolean(target); }, { flush: "sync" });

    async function choose(target) {
      if (editing.value && !(await editBack.back())) return;
      instance.state.set("selected", target);
      detailOpen.value = true;
    }

    async function create() {
      if (editing.value && !(await editBack.back())) return;
      instance.state.set("mode", "create");
    }

    function created(target) {
      instance.state.setState({ mode: "view", ...(target.primaryKey ? { selected: target } : {}) });
    }

    return {
      root, narrow, detailOpen, selected, mode, ready, formSlot, formDraft, editing,
      choose, create, created, cancel: editBack.back, back: detailBack.back,
      edit: () => instance.state.set("mode", "edit"),
      saved: () => instance.state.set("mode", "view"),
    };
  },
});
