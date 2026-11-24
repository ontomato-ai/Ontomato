import { computed } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const editing = computed(() => instance.state.values.value.editing);
    const status = usePanelOutput("header", "status");
    const ready = computed(() => status.value === "ready");
    const draft = usePanelFormDraft("form", { when: ready });
    const tab = computed({
      get: () => instance.state.values.value.tab,
      set: (value) => instance.state.set("tab", value),
    });
    function close() {
      instance.state.setState({ editing: null, tab: "details" });
    }
    const { back: cancel } = usePanelBack(() => Boolean(editing.value), close, { forms: "form" });
    const dialog = computed({
      get: () => Boolean(editing.value),
      set: (open) => { if (!open) close(); },
    });

    function rowAction({ id, ref }) {
      if (id === "edit") instance.state.setState({ editing: ref, tab: "details" });
    }

    return { editing, ready, draft, tab, dialog, rowAction, cancel, close };
  },
});
