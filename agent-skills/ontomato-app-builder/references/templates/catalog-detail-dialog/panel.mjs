import { computed } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";

const TYPE = "platform:AgentDefinition";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));
    const selectedTitle = computed(() => {
      const key = selectedKey.value;
      if (!key) return "";
      const match = instance.pageContext.value.selection.find(item => item.id === key);
      return match?.label || key;
    });
    const creating = computed(() => instance.state.values.value.creating === true);
    const createDialog = computed({
      get: () => creating.value && !selectedKey.value,
      set: value => {
        if (!value && creating.value) cancelCreate();
      },
    });
    function startCreate() {
      instance.state.setState({ creating: true, selected: null });
    }
    function stopCreating() {
      if (creating.value) instance.state.set("creating", false);
    }
    function cancelCreate() {
      instance.state.setState({ creating: false, selected: null });
    }
    const formDraft = usePanelFormDraft("form", { when: () => Boolean(selectedKey.value) });
    function onSaved(saved) {
      instance.state.set("creating", false);
      instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
    }
    function onDiscarded() {
      instance.state.set("creating", false);
    }
    function backToCatalog() {
      instance.state.setState({ selected: null, creating: false });
    }
    const { back } = usePanelBack(() => Boolean(selectedKey.value), backToCatalog, { pushHistory: true, forms: "form" });
    return { selectedKey, selectedTitle, back, creating, createDialog, startCreate, stopCreating, cancelCreate, formDraft, onSaved, onDiscarded };
  },
});
