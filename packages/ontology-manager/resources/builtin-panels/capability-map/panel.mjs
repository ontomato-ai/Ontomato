import { computed, watch } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * The capability map: the four-layer platform ontology seen through the two panels that own it. This panel only picks
 * which half is shown and keeps the addresses and the two halves' selections in step; the types live in the ontology
 * graph and the instances in the object browser, both read from the platform source.
 */

const ONTOLOGY_TYPE = "platform:OntologyType";

await mountPanel({
  setup() {
    const { instance, refreshing, t } = usePanelContext();
    const state = () => instance.state.values.value;

    const mode = computed(() => (state().mode === "type" ? "type" : "instance"));
    const modeOptions = computed(() => [
      { value: "instance", label: t("cm.modeInstance") },
      { value: "type", label: t("cm.modeType") },
    ]);

    // The old address named the table view "list": the object browser has always called it "table".
    watch(
      () => state().view,
      (view) => {
        if (view !== "list") return;
        instance.state.set("view", "table");
      },
      { immediate: true },
    );

    // One selected type, kept as the string its address carries and as the reference the panels read.
    watch(
      () => state().selectedType,
      (key) => {
        const current = state().selectedTypeRef?.primaryKey ?? "";
        if ((key ?? "") === current) return;
        instance.state.set("selectedTypeRef", key ? { className: ONTOLOGY_TYPE, primaryKey: key } : null);
      },
      { immediate: true },
    );
    watch(
      () => state().selectedTypeRef,
      (reference) => {
        const key = reference?.primaryKey ?? "";
        if ((state().selectedType ?? "") === key) return;
        instance.state.set("selectedType", key || null);
      },
      { immediate: true },
    );

    // The type half asks to see a type's instances: the instance half opens its table on that type.
    watch(
      () => state().exploreTypeRequest,
      (request) => {
        if (!request) return;
        instance.state.setState({
          mode: "instance",
          view: "table",
          selectedClass: request,
          exploreTypeRequest: null,
        });
      },
    );

    async function refresh() {
      if (refreshing.value) return;
      await instance.refreshObjects();
    }

    return { mode, modeOptions, refreshing, refresh, t };
  },
});
