import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Functions page: the selected function, search keyword, and `creating` toggle are declared panel state.
 * The header's "New Function" button clears `selected` and sets `creating` to true.
 * Reads, saves, and deletes run through the projections' declared owner operations.
 */

await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance } = panel;
    const values = instance.state.values;
    const selected = computed(() => values.value.selected ?? null);
    const creating = computed(() => values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value);

    // Selecting an item leaves create mode, except the initial auto-selection when opened directly in create mode.
    let openedToCreate = creating.value && !selected.value;
    watch(selected, (next) => {
      if (!next) return;
      if (openedToCreate) {
        openedToCreate = false;
        instance.state.set("selected", null);
        return;
      }
      setCreating(false);
    });
    // The owner saved it: say so, as the page always did, and go back to reading it.
    function saved() {
      setCreating(false);
      panel.notify({ kind: "success", text: panel.t("saved") });
    }
    function discard() {
      setCreating(false);
    }

    function startCreate() {
      instance.state.setState({ selected: null, creating: true });
    }

    return { selected, creating, saved, discard, startCreate, refresh: () => instance.refreshObjects() };
  },
});
