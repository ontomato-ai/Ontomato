import { computed, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext } from "@ontomato/sdk/panel";

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
    const formHandle = computed(() => instance.forms.handle("form"));
    const saving = computed(() => Boolean(formHandle.value?.busy.value));
    const canSave = computed(() => Boolean(formHandle.value) && !saving.value);
    async function saveDetail() {
      if (!canSave.value || !instance.forms.dirty()) return;
      try {
        await instance.forms.submit("form");
      } catch {
        // ObjectForm renders the owner's validation or refusal message inline on the form.
      }
    }
    function onSaved(saved) {
      instance.state.set("creating", false);
      instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
    }
    function onDiscarded() {
      instance.state.set("creating", false);
    }
    watch(instance.draft, draft => {
      if (!draft) return;
      if (draft.target?.id) {
        instance.state.set("creating", false);
        if (draft.target.id !== selectedKey.value) instance.state.set("selected", { className: TYPE, primaryKey: draft.target.id });
      } else {
        instance.state.setState({ creating: true, selected: null });
      }
    }, { immediate: true });
    function backToCatalog() {
      instance.state.setState({ selected: null, creating: false });
    }
    const { back } = usePanelBack(() => Boolean(selectedKey.value), backToCatalog, { pushHistory: true });
    return { selectedKey, selectedTitle, back, creating, createDialog, startCreate, stopCreating, cancelCreate, saving, canSave, saveDetail, onSaved, onDiscarded };
  },
});
