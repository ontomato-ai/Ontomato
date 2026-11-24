import { computed } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const label = usePanelOutput("detail", "label");
    const ready = computed(() => label.value !== null);
    const formDraft = usePanelFormDraft("form", { when: ready });

    const creating = computed(() => instance.state.values.value.creating === true);
    const closeCreate = () => instance.state.set("creating", false);
    const createBack = usePanelBack(creating, closeCreate, { forms: "createForm" });
    const createDialog = computed({
      get: () => creating.value,
      set: (open) => { if (!open) void createBack.back(); },
    });
    function created(target) {
      instance.state.setState({ creating: false, ...(target.primaryKey ? { selected: target } : {}) });
    }

    const { back } = usePanelBack(() => Boolean(selected.value), () => instance.state.set("selected", null), { forms: "form" });
    return { selected, back, label, ready, formDraft, creating, createDialog, closeCreate, created, startCreate: () => instance.state.set("creating", true) };
  },
});
