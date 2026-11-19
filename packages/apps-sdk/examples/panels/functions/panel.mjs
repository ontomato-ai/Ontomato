import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Functions. The declaration says what the instance keeps and composes; listing and filtering the functions, drawing
 * the owner's form, carrying a draft, saving, deleting and selecting the function a create made are the SDK's and the
 * owner's.
 *
 * What this module adds is the instance's mode, kept in step with the selection: choosing a function edits it, letting
 * go of it returns to the list. The panel's `newFunction` and `backToList` operations (state changes) clear the
 * selection and create or list; the back button runs `backToList`, the same operation the header and an agent reach.
 * Once a create is saved the SDK selects the new function, which is editing it.
 */
const Functions = {
  setup() {
    const { instance } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selectedFunction);
    watch(selected, (fn) => {
      if (fn) state.set("mode", "edit");
      else if (state.values.value.mode === "edit") state.set("mode", "list");
    }, { immediate: true });
    const mode = computed(() => state.values.value.mode ?? "list");
    const backToList = () => instance.invoke("backToList");
    return { mode, backToList };
  },
};

await mountPanel(Functions);
