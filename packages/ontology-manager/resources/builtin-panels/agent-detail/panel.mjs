import { computed, nextTick, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelFormDraft,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DEFAULT_CATALOG_PATH = "/ontology/agents";
const AGENT = "platform:AgentDefinition";
const CAPABILITY_MAP = "/ontology/assets/capability-map";

const GRANT_VERBS = new Set(["use", "view", "edit"]);
const GRANT_DIALOG_RESET = {
  grantDialog: null,
  grantUser: null,
  grantRole: null,
  grantPrincipalId: null,
};

/*
 * Agent detail panel: full-width edit-on-open view for a single platform:AgentDefinition.
 * - Opens via ?selected=<id> from either /ontology/agents/detail or /agents/settings/detail.
 * - Mounts the owner-described form only once the header record is ready, so missing or
 *   forbidden deep links render in place without reading a form or exposing Delete.
 * - Readers with `view` only see a read-only banner and form, with Save/Delete/Grants hidden.
 * - Editors (`canGrant`) can switch to the Permissions & sharing tab to toggle domain-wide use
 *   and grant or revoke single-select 3-level (use / view / edit) principal and role access.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const catalogPath = computed(() => {
      const configured = values.value.catalogPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_CATALOG_PATH;
    });
    const isOntologyEntry = computed(() => catalogPath.value === DEFAULT_CATALOG_PATH);

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const tabModel = computed({
      get: () => (values.value.tab === "grants" ? "grants" : "config"),
      set: (next) => state.set("tab", next === "grants" ? "grants" : "config"),
    });

    // Read-only projection outputs published by the selected agent header.
    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const agentCategory = usePanelOutput("header", "category");
    const canEditOutput = usePanelOutput("header", "canEdit");
    const canGrantOutput = usePanelOutput("header", "canGrant");
    const domainSharedOutput = usePanelOutput("header", "domainShared");

    const recordStatus = computed(() => {
      if (!selectedKey.value) return "empty";
      return headerStatus.value ?? "loading";
    });
    const detailReady = computed(() => Boolean(selectedKey.value) && recordStatus.value === "ready");
    const canEdit = computed(() => canEditOutput.value === true);
    const canGrant = computed(() => canGrantOutput.value === true);
    const domainShared = computed(() => domainSharedOutput.value === true);

    const recordErrorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("detail.loadError");
    });

    const detailDraft = usePanelFormDraft("form", {
      when: () => detailReady.value && canEdit.value && tabModel.value === "config",
    });

    // Grant dialog state aligned with edit/grant permission and readiness.
    const grantEntryAllowed = computed(() => detailReady.value && canGrant.value);
    const grantDialogOpen = computed({
      get: () => values.value.grantDialog === true && grantEntryAllowed.value,
      set: (open) => {
        if (!open) {
          state.setState(GRANT_DIALOG_RESET);
        } else if (grantEntryAllowed.value) {
          state.set("grantDialog", true);
        }
      },
    });
    const grantPrincipalKindModel = computed({
      get: () => (values.value.grantPrincipalKind === "role" ? "role" : "principal"),
      set: (next) => {
        state.setState({
          grantPrincipalKind: next === "role" ? "role" : "principal",
          grantUser: null,
          grantRole: null,
          grantPrincipalId: null,
        });
      },
    });
    const grantVerbModel = computed({
      get: () => (GRANT_VERBS.has(values.value.grantVerb) ? values.value.grantVerb : "use"),
      set: (next) => state.set("grantVerb", GRANT_VERBS.has(next) ? next : "use"),
    });
    const grantPrincipalId = computed(() =>
      typeof values.value.grantPrincipalId === "string" ? values.value.grantPrincipalId : "",
    );
    const canSubmitGrant = computed(
      () => grantEntryAllowed.value && grantDialogOpen.value && Boolean(grantPrincipalId.value),
    );
    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);
    const grantVerbOptions = computed(() => [
      { value: "use", label: t("grants.use") },
      { value: "view", label: t("grants.view") },
      { value: "edit", label: t("grants.edit") },
    ]);
    const grantVerbDescription = computed(() => t(`grants.levelDesc.${grantVerbModel.value}`));

    // Keep grantPrincipalId synced from the active ReferencePicker selection.
    watch(
      () => ({
        kind: grantPrincipalKindModel.value,
        userId: values.value.grantUser?.primaryKey ?? null,
        roleId: values.value.grantRole?.primaryKey ?? null,
      }),
      ({ kind, userId, roleId }) => {
        const nextId = kind === "role" ? roleId : userId;
        if ((values.value.grantPrincipalId ?? null) !== nextId) {
          state.set("grantPrincipalId", nextId);
        }
      },
      { immediate: true },
    );

    // Reset transient grant dialog fields when switching to a different agent unless patched atomically.
    watch(
      selectedKey,
      (next, prev) => {
        if (!prev || next === prev) return;
        const patched = state.lastPatchedKeys;
        const defaults = {
          ...GRANT_DIALOG_RESET,
          grantPrincipalKind: "principal",
          grantVerb: "use",
        };
        const resetPatch = {};
        for (const [field, fallback] of Object.entries(defaults)) {
          if (!patched?.has(field) && values.value[field] !== fallback) {
            resetPatch[field] = fallback;
          }
        }
        if (Object.keys(resetPatch).length > 0) {
          state.setState(resetPatch);
        }
      },
      { flush: "sync" },
    );

    // Fall back to config tab and close any grant dialog if the reader cannot manage grants on this agent.
    watch(
      [detailReady, canGrant],
      ([ready, allowed]) => {
        if (!ready || allowed) return;
        if (tabModel.value === "grants") {
          tabModel.value = "config";
        }
        if (values.value.grantDialog === true) {
          state.setState(GRANT_DIALOG_RESET);
        }
      },
      { immediate: true },
    );

    // Route back to the sibling catalog entry so the platform's unified unsaved-changes leave guard runs.
    function goBack() {
      void navigate(catalogPath.value).catch(() => undefined);
    }

    function retry() {
      instance.refreshObjects();
    }

    function viewType() {
      void navigate(panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: AGENT })).catch(() => undefined);
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("detail.saved") });
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      if (selectedKey.value) state.set("selected", null);
      await nextTick();
      void navigate(catalogPath.value).catch(() => undefined);
    }

    function openGrantDialog() {
      if (!grantEntryAllowed.value) return;
      state.setState({
        grantPrincipalKind: "principal",
        grantUser: null,
        grantRole: null,
        grantPrincipalId: null,
        grantVerb: "use",
        grantDialog: true,
      });
    }

    function onGrantAdded(outcome) {
      if (outcome?.kind !== "success") return;
      state.setState(GRANT_DIALOG_RESET);
      notify({ kind: "success", text: t("grants.updated") });
      instance.refreshObjects();
    }

    function onShareDone(outcome) {
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("grants.updated") });
      instance.refreshObjects();
    }

    return {
      t,
      selectedKey,
      isOntologyEntry,
      tabModel,
      agentCategory,
      canEdit,
      canGrant,
      domainShared,
      recordStatus,
      detailReady,
      recordErrorText,
      detailDraft,
      grantEntryAllowed,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantKindOptions,
      grantVerbOptions,
      grantVerbDescription,
      canSubmitGrant,
      goBack,
      retry,
      viewType,
      onSaved,
      onRemoveDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
    };
  },
});
