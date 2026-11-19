import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Metric views. The declaration says what the instance keeps and composes; listing and filtering the metric views,
 * drawing the owner's form, carrying a draft, saving, deleting and selecting the metric view a create made are the
 * SDK's and the owner's.
 *
 * What this module adds is the instance's mode, kept in step with the selection: choosing a metric view edits it,
 * letting go of it returns to the list. The panel's `newMetric` and `backToList` operations (state changes) clear the
 * selection and create or list; the back button runs `backToList`, the same operation the header and an agent reach.
 * Once a create is saved the SDK selects the new metric view, which is editing it.
 */
const MetricViews = {
  setup() {
    const { instance } = usePanelContext();
    const state = instance.state;
    const selected = computed(() => state.values.value.selectedMetric);
    watch(selected, (metric) => {
      if (metric) state.set("mode", "edit");
      else if (state.values.value.mode === "edit") state.set("mode", "list");
    }, { immediate: true });
    const mode = computed(() => state.values.value.mode ?? "list");
    const backToList = () => instance.invoke("backToList");
    return { mode, backToList };
  },
};

await mountPanel(MetricViews);
