import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

const CATALOG_PATH = "/applications/app-template-two-entry/catalog";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const selected = computed(() => instance.state.values.value.selected);
    const status = usePanelOutput("header", "status");
    const ready = computed(() => status.value === "ready");
    const formDraft = usePanelFormDraft("form", { when: ready });
    return { selected, ready, formDraft, goBack: () => navigate(CATALOG_PATH) };
  },
});
