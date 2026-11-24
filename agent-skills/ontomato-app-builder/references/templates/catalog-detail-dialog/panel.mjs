import { computed } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const creating = computed(() => instance.state.values.value.creating === true);
    const status = usePanelOutput("header", "status");
    const ready = computed(() => status.value === "ready");
    const formDraft = usePanelFormDraft("form", { when: ready });

    const closeCreate = () => instance.state.set("creating", false);
    const createBack = usePanelBack(creating, closeCreate, { forms: "createForm" });
    const createDialog = computed({
      get: () => creating.value,
      set: (open) => { if (!open) void createBack.back(); },
    });
    const { back } = usePanelBack(() => Boolean(selected.value), () => instance.state.set("selected", null), {
      forms: "form",
    });

    async function choose(target) {
      if (creating.value && !(await createBack.back())) return;
      instance.state.set("selected", target);
    }

    function created(target) {
      instance.state.setState({ creating: false, ...(target.primaryKey ? { selected: target } : {}) });
    }

    return {
      selected, creating, createDialog, ready, formDraft, back, choose, closeCreate, created,
      startCreate: () => instance.state.set("creating", true),
    };
  },
});
