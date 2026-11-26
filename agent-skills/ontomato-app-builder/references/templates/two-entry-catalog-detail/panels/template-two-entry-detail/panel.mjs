import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

const CATALOG_PATH = "/applications/app-template-two-entry/catalog";

await mountPanel({
  setup() {
    const { instance, navigateBack } = usePanelContext();
    const selectedKey = computed(() => instance.state.values.value.selected?.primaryKey);
    const status = usePanelOutput("header", "status");
    const ready = computed(() => status.value === "ready");
    const formDraft = usePanelFormDraft("form", { when: ready });
    return { selectedKey, status, ready, formDraft, goBack: () => navigateBack(CATALOG_PATH) };
  },
});
