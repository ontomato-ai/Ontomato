import { computed } from "vue";
import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in App Builder workspaces directory panel: lists platform:AppWorkspace records,
 * opens workspace details, creates new workspaces, renames, and deletes workspaces.
 */

const WORKSPACE_TYPE = "platform:AppWorkspace";
const DETAIL_PATH = "/app-builder/workspace";

await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const createOpen = computed({
      get: () => values.value.creating === true,
      set: (open) => instance.state.set("creating", open ? true : null),
    });

    const renaming = computed(() => values.value.renaming ?? null);

    let navigating = false;
    async function openWorkspace(primaryKey) {
      if (!primaryKey || navigating) return;
      navigating = true;
      try {
        if (values.value.creating) instance.state.set("creating", null);
        await navigate(panelAddress(DETAIL_PATH, { workspace: primaryKey }));
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      } finally {
        navigating = false;
      }
    }

    function refresh() {
      instance.refreshObjects();
    }

    function openCreate() {
      instance.state.setState({ renaming: null, creating: true });
    }

    function closeCreate() {
      instance.state.set("creating", null);
    }

    function closeRename() {
      instance.state.set("renaming", null);
    }

    function onRenameDialogUpdate(open) {
      if (!open) closeRename();
    }

    function onChooseWorkspace(selection) {
      if (!selection?.primaryKey) return;
      void openWorkspace(selection.primaryKey);
    }

    function onRowAction({ id, ref: rowRef }) {
      const primaryKey = rowRef?.primaryKey;
      if (!primaryKey) return;
      if (id === "open") {
        void openWorkspace(primaryKey);
      } else if (id === "rename") {
        instance.state.setState({
          creating: null,
          renaming: { className: WORKSPACE_TYPE, primaryKey },
        });
      }
    }

    function onCreated(saved) {
      instance.state.set("creating", null);
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
      if (saved?.primaryKey) {
        void openWorkspace(saved.primaryKey);
      }
    }

    function onRenamed() {
      closeRename();
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.renamed") });
    }

    function onOperationDone(operation, outcome, rowRef) {
      if (operation !== "delete" || outcome?.kind !== "success") return;
      if (rowRef?.primaryKey && renaming.value?.primaryKey === rowRef.primaryKey) {
        instance.state.set("renaming", null);
      }
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.deleted") });
    }

    return {
      t,
      createOpen,
      renaming,
      refresh,
      openCreate,
      closeCreate,
      closeRename,
      onRenameDialogUpdate,
      onChooseWorkspace,
      onRowAction,
      onCreated,
      onRenamed,
      onOperationDone,
    };
  },
});
