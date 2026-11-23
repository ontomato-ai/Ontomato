import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";

const TYPE = "platform:AgentDefinition";
const CATALOG_PATH = "/applications/app-template-two-entry/catalog";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));
    const selectedTitle = computed(() => {
      const key = selectedKey.value;
      if (!key) return "";
      const match = instance.pageContext.value.selection.find(item => item.id === key);
      return match?.label || key;
    });
    const formDraft = usePanelFormDraft("form", { when: () => Boolean(selectedKey.value) });
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }
    function onSaved(saved) {
      if (saved?.primaryKey) {
        instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });
      }
    }
    return { selectedTitle, formDraft, goBack, onSaved };
  },
});
