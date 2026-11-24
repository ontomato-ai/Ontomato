import { computed } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const SERVICE_TYPE = "platform:ExternalMcpService";

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const values = instance.state.values;

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

    const inspectedKey = computed(() => values.value.inspectedService?.primaryKey ?? "");
    const inspectOpen = computed({
      get: () => Boolean(inspectedKey.value),
      set: (open) => {
        if (!open) closeInspect();
      },
    });

    const inspectedToolTotal = usePanelOutput("inspectedTools", "total");

    function refresh() {
      instance.refreshObjects();
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

    function closeInspect() {
      instance.state.set("inspectedService", null);
    }

    function recheck() {
      instance.refreshObjects();
    }

    function onCreated() {
      createOpen.value = false;
      instance.refreshObjects();
      notify({ kind: "success", text: t("services.created") });
    }

    function onEdited() {
      closeEdit();
      instance.refreshObjects();
      notify({ kind: "success", text: t("services.saved") });
    }

    function onRowAction({ id, ref: rowRef }) {
      const primaryKey = rowRef?.primaryKey;
      if (!primaryKey) return;
      const target = { className: SERVICE_TYPE, primaryKey };
      if (id === "check") {
        instance.state.set("inspectedService", target);
      } else if (id === "edit") {
        instance.state.setState({
          creating: null,
          editingService: target,
        });
      }
    }

    function onServiceOperationDone(operation, outcome, rowRef) {
      if (operation !== "delete" || outcome?.kind !== "success") return;
      const deletedId = rowRef?.primaryKey;
      if (deletedId && inspectedKey.value === deletedId) {
        instance.state.set("inspectedService", null);
      }
      if (deletedId && editingKey.value === deletedId) {
        instance.state.set("editingService", null);
      }
      instance.refreshObjects();
      notify({ kind: "success", text: t("services.deleted") });
    }

    return {
      t,
      createOpen,
      editOpen,
      editingKey,
      inspectOpen,
      inspectedKey,
      inspectedToolTotal,
      refresh,
      openCreate,
      closeEdit,
      closeInspect,
      recheck,
      onCreated,
      onEdited,
      onRowAction,
      onServiceOperationDone,
    };
  },
});
