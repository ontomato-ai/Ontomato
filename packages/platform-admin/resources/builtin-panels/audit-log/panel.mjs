import { computed, ref, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
} from "@ontomato/sdk/panel";

const BUSINESS_LABEL_KEYS = {
  BKNOWLEDGE: "business.knowledge",
  BTERM: "business.glossary",
  BEXAMPLE: "business.example",
  SCHEMA: "business.schema",
  ANALYSIS: "business.analysis",
};

const OPERATION_LABEL_KEYS = {
  ADD: "operation.add",
  UPD: "operation.modify",
  DEL: "operation.delete",
};

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const values = instance.state.values;

    const draftBusiness = ref(values.value.business ?? "");
    const draftOperation = ref(values.value.operation ?? "");

    watch(
      () => values.value.business ?? "",
      (next) => {
        if (draftBusiness.value !== next) draftBusiness.value = next;
      },
    );

    watch(
      () => values.value.operation ?? "",
      (next) => {
        if (draftOperation.value !== next) draftOperation.value = next;
      },
    );

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

    function openDetail(rowRef) {
      if (rowRef) {
        instance.state.set("selectedLog", rowRef);
      }
    }

    function applyFilters() {
      const nextBusiness = draftBusiness.value || null;
      const nextOperation = draftOperation.value || null;
      const curBusiness = values.value.business || null;
      const curOperation = values.value.operation || null;
      if (nextBusiness === curBusiness && nextOperation === curOperation) {
        instance.refreshObjects();
        return;
      }
      instance.state.setState({
        business: nextBusiness,
        operation: nextOperation,
      });
    }

    function filterLabel(value, labelKeys) {
      if (!value) return t("filter.all");
      const key = labelKeys[value];
      return key ? t(key) : String(value);
    }

    function resultScopeLabel(page) {
      return t("list.resultScope", {
        page,
        business: filterLabel(values.value.business, BUSINESS_LABEL_KEYS),
        operation: filterLabel(values.value.operation, OPERATION_LABEL_KEYS),
      });
    }

    function refresh() {
      instance.refreshObjects();
    }

    return {
      t,
      draftBusiness,
      draftOperation,
      detailOpen,
      openDetail,
      closeDetail,
      applyFilters,
      resultScopeLabel,
      refresh,
    };
  },
});
