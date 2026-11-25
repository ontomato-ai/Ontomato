import { computed, reactive, watch } from "vue";
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

    const initialGrantState = () => ({ count: 0, loading: true, error: null });
    const grantStates = reactive({
      caseScoped: initialGrantState(),
      inForce: initialGrantState(),
      superseded: initialGrantState(),
      direct: initialGrantState(),
    });

    watch(inspectingGrantsKey, () => {
      grantStates.caseScoped = initialGrantState();
      grantStates.inForce = initialGrantState();
      grantStates.superseded = initialGrantState();
      grantStates.direct = initialGrantState();
    });

    function onGrantState(group, snapshot) {
      grantStates[group] = {
        count: Number(snapshot?.count ?? 0),
        loading: Boolean(snapshot?.loading),
        error: snapshot?.error ?? null,
      };
    }

    const grantsLoading = computed(
      () => grantStates.caseScoped.loading || grantStates.inForce.loading || grantStates.superseded.loading || grantStates.direct.loading,
    );
    const grantsError = computed(
      () => grantStates.caseScoped.error || grantStates.inForce.error || grantStates.superseded.error || grantStates.direct.error,
    );
    const grantsHasWorkflowAuthority = computed(
      () => grantStates.caseScoped.count > 0 || grantStates.inForce.count > 0 || grantStates.superseded.count > 0,
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
      onGrantState,
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
