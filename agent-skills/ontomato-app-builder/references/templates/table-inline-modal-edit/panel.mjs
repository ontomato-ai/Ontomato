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
    const dialog = computed(() => Boolean(editing.value));
    const dialogBack = usePanelBack(() => dialog.value, close, { forms: "form" });
    const cancel = () => dialogBack.back();
    async function beforeClose(done) {
      if (await dialogBack.back()) done();
    }

    function rowAction({ id, ref }) {
      if (id === "edit") instance.state.setState({ editing: ref, tab: "details" });
    }

    return { editing, ready, draft, tab, dialog, rowAction, cancel, close, beforeClose };
  },
});
