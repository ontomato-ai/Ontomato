import { computed, watch } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

/*
 * Built-in Triggers catalog panel: full-width table with inline Edit, Publish/Disable, and Delete actions,
 * owner-computed armed/total counts via ObjectCount, and a modal dialog hosting owner-declared ObjectForm
 * projections for creating and editing triggers.
 */

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();
    const values = instance.state.values;

    const search = computed({
      get: () => (typeof values.value.search === "string" ? values.value.search : ""),
      set: (value) => instance.state.set("search", value || null),
    });

    const creating = computed(() => values.value.creating === true);
    const editing = computed(() => values.value.editing ?? null);
    const editingKey = computed(() => editing.value?.primaryKey ?? null);
    const dialogOpen = computed(() => creating.value || editing.value !== null);
    const dialogTitle = computed(() => (creating.value ? t("dialog.createTitle") : t("dialog.editTitle")));

    // Keep create and edit modal states mutually exclusive when updated via assistant `present`.
    watch(creating, (active) => {
      if (active && editing.value && !instance.state.lastPatchedKeys.has("editing")) {
        instance.state.set("editing", null);
      }
    });
    watch(editingKey, (key) => {
      if (key && creating.value) {
        instance.state.set("creating", false);
      }
    });

    const activeFormSlot = computed(() => (creating.value ? "createForm" : editing.value ? "editForm" : null));
    const activeDraft = usePanelFormDraft(activeFormSlot);

    function closeDialog() {
      instance.state.setState({ creating: false, editing: null });
    }

    const dialogBack = usePanelBack(() => dialogOpen.value, closeDialog, {
      pushHistory: false,
      forms: ["createForm", "editForm"],
    });

    const dialog = computed({
      get: () => dialogOpen.value,
      set: (open) => {
        if (!open && dialogOpen.value) closeDialog();
      },
    });

    function startCreate() {
      instance.state.setState({ creating: true, editing: null });
    }

    function onRowAction({ id, ref }) {
      if (id === "edit" && ref?.primaryKey) {
        instance.state.setState({ creating: false, editing: ref });
      }
    }

    function cancelDialog() {
      void dialogBack.back();
    }

    function onFormSaved() {
      closeDialog();
    }

    return {
      search,
      creating,
      editing,
      dialogOpen,
      dialogTitle,
      dialog,
      activeDraft,
      startCreate,
      onRowAction,
      cancelDialog,
      closeDialog,
      onFormSaved,
      refresh: () => instance.refreshObjects(),
    };
  },
});
