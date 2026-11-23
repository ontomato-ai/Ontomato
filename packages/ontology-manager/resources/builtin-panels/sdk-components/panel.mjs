import { computed, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Base components (platform:SDKComponent, read-only catalogue).
 *
 * The left list renders the owner's catalogue read with search and selection synced as flat URL parameters.
 * The right detail pane renders the selected component exclusively through official projections: ObjectHeader and
 * ObjectSummary bound to `record`, and five read-only ObjectList tables bound to `dataRows`, `configRows`,
 * `inputRows`, `outputRows`, and `operationRows`. Readiness is coordinated solely via ObjectHeader's read-only
 * `status` output.
 */

/** The capability map's type mode, opened at the platform's SDK component class. */
const CAPABILITY_MAP = "/ontology/assets/capability-map";
const COMPONENT_CLASS = "platform:SDKComponent";

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const navigateError = ref("");

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    // Read-only readiness signal from ObjectHeader; detail sections mount once the selected component resolves.
    const recordStatus = usePanelOutput("header", "status");
    const recordReady = computed(() => recordStatus.value === "ready");

    watch(selectedKey, () => {
      navigateError.value = "";
    });

    async function openComponentClass() {
      navigateError.value = "";
      try {
        await navigate(panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: COMPONENT_CLASS }));
      } catch (error) {
        navigateError.value = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      selectedKey,
      recordReady,
      navigateError,
      openComponentClass,
      refresh: () => instance.refreshObjects(),
    };
  },
});
