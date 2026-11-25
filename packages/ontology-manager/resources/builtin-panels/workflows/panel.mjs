import { computed } from "vue";
import {
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

/*
 * Built-in workflows catalog panel: renders the domain workflow table via ObjectList with
 * server search, row actions, and three modals (read-only definition view, new draft form,
 * and effective capability grants inspection). All reads and writes go through declared
 * platform:Workflow projections and operations.
 */
await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, t } = panel;
    const state = instance.state.values;

    const viewing = computed(() => state.value.viewing ?? null);
    const viewingKey = computed(() => viewing.value?.primaryKey ?? "");
    const creating = computed(() => state.value.creating === true);
    const inspectingGrants = computed(() => state.value.inspectingGrants ?? null);
    const inspectingGrantsKey = computed(() => inspectingGrants.value?.primaryKey ?? "");

    const viewLabel = usePanelOutput("viewForm", "label");
    const createDraft = usePanelFormDraft("createForm", { when: creating });

    const viewDialogTitle = computed(() =>
      viewLabel.value ? t("view.titleNamed", { name: viewLabel.value }) : t("view.title"),
    );
    const grantsDialogTitle = computed(() => {
      const ref = inspectingGrants.value;
      const name = ref?.primaryKey ? instance.objectName("platform:Workflow", ref.primaryKey) : null;
      return name ? t("grants.titleNamed", { name }) : t("grants.title");
    });

    function readGrantGroup(member) {
      const status = usePanelOutput(member, "status");
      const loadedCount = usePanelOutput(member, "loadedCount");
      return computed(() => {
        const currentStatus = status.value;
        const count = typeof loadedCount.value === "number" ? loadedCount.value : 0;
        const loading = currentStatus === null || currentStatus === "awaiting" || currentStatus === "loading";
        const error = currentStatus === "error" || currentStatus === "forbidden";
        return { count, loading, error };
      });
    }

    const grantGroups = {
      caseScoped: readGrantGroup("grantCaseScopedSteps"),
      inForce: readGrantGroup("grantInForce"),
      superseded: readGrantGroup("grantSuperseded"),
      direct: readGrantGroup("grantDirect"),
    };

    const grantStates = computed(() => ({
      caseScoped: grantGroups.caseScoped.value,
      inForce: grantGroups.inForce.value,
      superseded: grantGroups.superseded.value,
      direct: grantGroups.direct.value,
    }));

    const grantsLoading = computed(
      () =>
        grantStates.value.caseScoped.loading ||
        grantStates.value.inForce.loading ||
        grantStates.value.superseded.loading ||
        grantStates.value.direct.loading,
    );
    const grantsError = computed(
      () =>
        grantStates.value.caseScoped.error ||
        grantStates.value.inForce.error ||
        grantStates.value.superseded.error ||
        grantStates.value.direct.error,
    );
    const grantsHasWorkflowAuthority = computed(
      () =>
        grantStates.value.caseScoped.count > 0 ||
        grantStates.value.inForce.count > 0 ||
        grantStates.value.superseded.count > 0,
    );
    const grantsEmpty = computed(
      () => !grantsLoading.value && !grantsError.value && !grantsHasWorkflowAuthority.value,
    );

    function openView(ref) {
      if (!ref?.primaryKey) return;
      instance.state.setState({ viewing: ref, creating: false, inspectingGrants: null });
    }

    function closeView() {
      instance.state.set("viewing", null);
    }

    function startCreate() {
      instance.state.setState({ creating: true, viewing: null, inspectingGrants: null });
    }

    function closeCreateImmediate() {
      instance.state.set("creating", false);
    }

    const createBack = usePanelBack(() => creating.value, closeCreateImmediate, {
      pushHistory: false,
      forms: "createForm",
    });

    function requestCloseCreate() {
      void createBack.back();
    }

    function beforeCloseCreate() {
      requestCloseCreate();
    }

    function saveCreate() {
      createDraft.value?.save();
    }

    function onCreateSaved() {
      closeCreateImmediate();
      panel.notify({ kind: "success", text: t("notify.saved") });
    }

    function openGrants(ref) {
      if (!ref?.primaryKey) return;
      instance.state.setState({ inspectingGrants: ref, viewing: null, creating: false });
    }

    function closeGrants() {
      instance.state.set("inspectingGrants", null);
    }

    usePanelBack(() => Boolean(viewing.value), closeView, { pushHistory: false });
    usePanelBack(() => Boolean(inspectingGrants.value), closeGrants, { pushHistory: false });

    const viewDialogOpen = computed({
      get: () => Boolean(viewing.value),
      set: (open) => {
        if (!open) closeView();
      },
    });

    const createDialogOpen = computed({
      get: () => creating.value,
      set: (open) => {
        if (!open) requestCloseCreate();
      },
    });

    const grantsDialogOpen = computed({
      get: () => Boolean(inspectingGrants.value),
      set: (open) => {
        if (!open) closeGrants();
      },
    });

    function onRowAction({ id, ref }) {
      if (id === "view") openView(ref);
    }

    return {
      t,
      refreshing: instance.refreshing,
      viewingKey,
      inspectingGrantsKey,
      viewDialogOpen,
      viewDialogTitle,
      createDialogOpen,
      createDraft,
      grantsDialogOpen,
      grantsDialogTitle,
      grantStates,
      grantsLoading,
      grantsError,
      grantsHasWorkflowAuthority,
      grantsEmpty,
      startCreate,
      closeView,
      requestCloseCreate,
      beforeCloseCreate,
      closeCreateImmediate,
      saveCreate,
      onCreateSaved,
      openGrants,
      closeGrants,
      onRowAction,
      refresh: () => instance.refreshObjects(),
    };
  },
});
