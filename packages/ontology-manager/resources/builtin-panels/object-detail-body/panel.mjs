import { computed, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const OBJECT_TYPE = "platform:ObjectType";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const hasSelected = computed(() => Boolean(selected.value?.className && selected.value?.primaryKey));
    const selectedClassKey = computed(() => selected.value?.className ?? "");

    // Sync the object type reference from the selected instance's className.
    watch(
      selectedClassKey,
      (className) => {
        const current = instance.state.values.value.selectedClass;
        const next = className ? { className: OBJECT_TYPE, primaryKey: className } : null;
        if ((current?.primaryKey ?? null) !== (next?.primaryKey ?? null)) {
          instance.state.set("selectedClass", next);
        }
      },
      { immediate: true },
    );

    const panelStatus = usePanelOutput("detailBinding", "panelStatus");
    const detailPanelId = usePanelOutput("detailBinding", "panelId");

    const isBlocked = computed(
      () => panelStatus.value === "unavailable" || panelStatus.value === "forbidden",
    );
    const customDetailKey = computed(() => `${selectedClassKey.value}:${detailPanelId.value ?? ""}`);

    return {
      t,
      hasSelected,
      selectedClassKey,
      panelStatus,
      isBlocked,
      customDetailKey,
    };
  },
});
