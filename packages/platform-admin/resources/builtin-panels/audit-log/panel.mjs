import { computed, ref } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelNarrow,
} from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const values = instance.state.values;
    const root = ref(null);
    const narrow = usePanelNarrow(root);
    const drawerSize = computed(() => (narrow.value ? "94%" : "560px"));

    const businessFilter = computed({
      get: () => values.value.business ?? "",
      set: (next) => instance.state.set("business", next || null),
    });

    const operationFilter = computed({
      get: () => values.value.operation ?? "",
      set: (next) => instance.state.set("operation", next || null),
    });

    const hasSelection = computed(() => Boolean(values.value.selectedLog));

    const { back: closeDetail } = usePanelBack(
      hasSelection,
      () => {
        instance.state.set("selectedLog", null);
      },
      { forms: [] },
    );

    const detailOpen = computed({
      get: () => hasSelection.value,
      set: (open) => {
        if (!open) void closeDetail();
      },
    });

    function onRowAction({ id, ref: rowRef }) {
      if (id === "detail" && rowRef) {
        instance.state.set("selectedLog", rowRef);
      }
    }

    function refresh() {
      instance.refreshObjects();
    }

    return {
      root,
      t,
      drawerSize,
      businessFilter,
      operationFilter,
      detailOpen,
      closeDetail,
      onRowAction,
      refresh,
    };
  },
});
