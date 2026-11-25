import { computed, defineComponent } from "vue";
import {
  mountPanel,
  useListRowSlot,
  usePanelContext,
} from "@ontomato/sdk/panel";

const SERVICE_TYPE = "platform:ExternalMcpService";

const RowSlotRunner = defineComponent({
  name: "RowSlotRunner",
  setup(_props, { slots }) {
    const rowSlot = useListRowSlot();
    return () => slots.default?.({
      runOperation: (operationName, extraInput) => rowSlot?.runOperation(operationName, extraInput),
    });
  },
});

await mountPanel({
  components: {
    RowSlotRunner,
  },
  setup() {
    const { instance, notify, refreshing, refreshObjects, t } = usePanelContext();
    const values = instance.state.values;

    const resultVersions = new WeakMap();
    let nextResultVersion = 0;

    const createOpen = computed({
      get: () => values.value.creating === true,
      set: (open) => instance.state.set("creating", open ? true : null),
    });

    const editingKey = computed(() => values.value.editingService?.primaryKey ?? "");
    const editOpen = computed({
      get: () => Boolean(editingKey.value),
      set: (open) => {
        if (!open) closeEdit();
      },
    });

    function checkErrorText(checkState) {
      if (!checkState || checkState.running) return "";
      if (checkState.error) return checkState.error;
      const value = checkState.result?.kind === "json" ? checkState.result.value : null;
      if (value && typeof value === "object" && value.reachable === false) {
        return typeof value.error === "string" && value.error
          ? value.error
          : (checkState.result?.message || "");
      }
      return "";
    }

    function toolsRenderKey(rowRef, checkState) {
      const result = checkState?.result;
      if (!result || typeof result !== "object") return `${rowRef.primaryKey}:0`;
      let version = resultVersions.get(result);
      if (version === undefined) {
        version = ++nextResultVersion;
        resultVersions.set(result, version);
      }
      return `${rowRef.primaryKey}:${version}`;
    }

    function refresh() {
      void refreshObjects();
    }

    function openCreate() {
      instance.state.setState({
        editingService: null,
        creating: true,
      });
    }

    function closeEdit() {
      instance.state.set("editingService", null);
    }

    function onCreated() {
      createOpen.value = false;
      void refreshObjects();
      notify({ kind: "success", text: t("services.created") });
    }

    function onEdited() {
      closeEdit();
      void refreshObjects();
      notify({ kind: "success", text: t("services.saved") });
    }

    function onRowAction({ id, ref: rowRef }) {
      const primaryKey = rowRef?.primaryKey;
      if (!primaryKey) return;
      const target = { className: SERVICE_TYPE, primaryKey };
      if (id === "edit") {
        instance.state.setState({
          creating: null,
          editingService: target,
        });
      }
    }

    function onServiceOperationDone(operation, outcome, rowRef) {
      if (operation !== "delete" || outcome?.kind !== "success") return;
      const deletedId = rowRef?.primaryKey;
      if (deletedId && editingKey.value === deletedId) {
        instance.state.set("editingService", null);
      }
      void refreshObjects();
      notify({ kind: "success", text: t("services.deleted") });
    }

    return {
      t,
      refreshing,
      createOpen,
      editOpen,
      editingKey,
      checkErrorText,
      toolsRenderKey,
      refresh,
      openCreate,
      closeEdit,
      onCreated,
      onEdited,
      onRowAction,
      onServiceOperationDone,
    };
  },
});
