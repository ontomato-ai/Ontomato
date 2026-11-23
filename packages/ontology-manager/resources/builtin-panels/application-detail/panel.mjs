import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  draftTarget,
  mountPanel,
  usePanelContext,
  usePanelData,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

const APPLICATION = "platform:Application";
const PANEL = "platform:ProductPanel";
const PROJECTION = "platform:ProductProjection";
const CATALOG_PATH = "/ontology/applications";

function localizedText(map) {
  if (!map || typeof map !== "object") return "";
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  if (lang && map[lang]) return map[lang];
  if (map["zh-CN"]) return map["zh-CN"];
  if (map.en) return map.en;
  return Object.values(map).find((value) => typeof value === "string" && value.trim()) ?? "";
}

function looksLikeColor(value) {
  if (typeof value !== "string") return false;
  return /^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(value.trim());
}

const ApplicationDetailPanel = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const tabModel = computed({
      get: () => values.value.tab || "identity",
      set: (next) => instance.state.set("tab", next || "identity"),
    });
    const entriesViewModel = computed({
      get: () => (values.value.entriesView === "bulk" ? "bulk" : "list"),
      set: (next) => instance.state.set("entriesView", next === "bulk" ? "bulk" : "list"),
    });
    const entriesBulkMode = computed(() => entriesViewModel.value === "bulk");
    const editingEntryId = computed({
      get: () => values.value.editingEntryId ?? "",
      set: (next) => instance.state.set("editingEntryId", next ? next : null),
    });
    const entryDialogOpen = computed({
      get: () => Boolean(editingEntryId.value),
      set: (open) => {
        if (!open) editingEntryId.value = "";
      },
    });
    const grantDialogOpen = computed({
      get: () => values.value.grantDialog === true,
      set: (open) => instance.state.set("grantDialog", open ? true : null),
    });
    const grantPrincipalKindModel = computed({
      get: () => (values.value.grantPrincipalKind === "role" ? "role" : "principal"),
      set: (next) => instance.state.set("grantPrincipalKind", next === "role" ? "role" : "principal"),
    });

    const record = usePanelData("record", "record");
    const entries = usePanelData("entriesRead", "entries");
    const grants = usePanelData("grantsRead", "grants");
    const panelCatalogue = usePanelData("panelCatalogue", "rows");
    const panelInfo = usePanelData("panelInfo", "panel");
    const panelMembers = usePanelData("panelInfo", "members");
    const userOptions = usePanelData("userOptions", "options");
    const roleOptions = usePanelData("roleOptions", "options");

    const app = computed(() => (record.value.status === "ready" ? record.value.value : null));
    const canMaintain = computed(() => Boolean(app.value?.fields?.canMaintain));
    const canEditEntries = computed(() => Boolean(app.value?.fields?.canEditEntries));
    const canGrant = computed(() => Boolean(app.value?.fields?.canGrant));
    const appPath = computed(() => app.value?.fields?.home || app.value?.fields?.path || "");

    const entryData = computed(() => (entries.value.status === "ready" ? entries.value.value : null));
    const entryRows = computed(() => entryData.value?.panelUses ?? []);
    const grantRows = computed(() => (grants.value.status === "ready" ? grants.value.value?.grants ?? [] : []));
    const isDomainShared = computed(() => (grants.value.status === "ready" ? Boolean(grants.value.value?.shared) : false));

    const recordErrorText = computed(() => {
      if (record.value.status === "failed") {
        const message = record.value.error?.message;
        if (message && message !== "Application not found") return message;
      }
      return t("detail.notFound");
    });

    const busy = ref(false);

    const identityDraft = usePanelFormDraft("save", {
      when: () =>
        Boolean(selectedKey.value)
        && record.value.status === "ready"
        && canMaintain.value
        && tabModel.value === "identity",
    });

    // Navigate back to the catalog entry so the platform's unified unsaved-changes guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    watch(selectedKey, (next, prev) => {
      if (prev && next !== prev) {
        instance.state.setState({
          entriesView: "list",
          editingEntryId: null,
          inspectedPanel: null,
          grantDialog: null,
        });
      }
    });

    watch(
      app,
      (item) => {
        if (!item) return;
        instance.nameObjects(APPLICATION, [{ primaryKey: item.primaryKey, label: item.label }]);
        if (!item.fields?.canGrant && tabModel.value === "grants") {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

    // Route incoming assistant drafts cleanly to the matching form/tab, or redirect create drafts to the catalogue.
    watch(
      instance.draft,
      (draft) => {
        if (!draft) return;
        const target = draftTarget(draft);
        if (target.kind === "create") {
          const query = new globalThis.URLSearchParams({ state: JSON.stringify({ creating: true }) });
          void navigate(`${CATALOG_PATH}?${query}`).catch(() => undefined);
          return;
        }
        if (target.id && target.id !== selectedKey.value) {
          instance.state.set("selected", { className: APPLICATION, primaryKey: target.id });
        }
        if (draft.slot === "entriesForm") {
          instance.state.setState({ tab: "entries", entriesView: "bulk" });
        } else if (draft.slot === "entryForm") {
          const draftEntryId = draft.form?.id;
          instance.state.setState({
            tab: "entries",
            entriesView: "list",
            editingEntryId: typeof draftEntryId === "string" && draftEntryId ? draftEntryId : "__new__",
          });
        } else {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function onEntriesFormSaved() {
      entriesViewModel.value = "list";
      instance.refreshObjects();
      notify({ kind: "success", text: t("entries.saved") });
    }

    function onEntryFormSaved() {
      editingEntryId.value = "";
      instance.refreshObjects();
      notify({ kind: "success", text: t("entries.saved") });
    }

    function closeEntryDialog() {
      editingEntryId.value = "";
    }

    function toggleEntriesView() {
      entriesViewModel.value = entriesBulkMode.value ? "list" : "bulk";
    }

    async function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("notify.deleted") });
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    function retryRecord() {
      instance.refreshObjects();
    }

    async function openApplication() {
      if (!appPath.value) return;
      try {
        await navigate(appPath.value);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    async function openCatalogueRecord(path, className, primaryKey) {
      try {
        const state = JSON.stringify({ selected: { className, primaryKey } });
        await navigate(`${path}?${new globalThis.URLSearchParams({ state })}`);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function openPanelCatalogue(panelId) {
      if (!panelId) return;
      void openCatalogueRecord("/ontology/panels", PANEL, panelId);
    }

    function openMemberCatalogue(member) {
      if (!member?.primaryKey) return;
      if (member.className === PROJECTION) {
        void openCatalogueRecord("/ontology/projections", PROJECTION, member.primaryKey);
      } else {
        openPanelCatalogue(member.primaryKey);
      }
    }

    function onNavigateReference(reference) {
      if (!reference) return;
      if (reference.className === PANEL) openPanelCatalogue(reference.primaryKey);
      else if (reference.className === PROJECTION) openMemberCatalogue(reference);
    }

    // --- Panel display name lookup & Panels/Projections tab ---
    const panelNameMap = computed(() => {
      if (panelCatalogue.value.status !== "ready") return {};
      const list = panelCatalogue.value.value?.rows ?? [];
      return Object.fromEntries(list.map((row) => [row.primaryKey, row.label || row.primaryKey]));
    });

    function panelDisplayName(panelId) {
      if (!panelId) return "—";
      return panelNameMap.value[panelId] || panelId;
    }

    const usedPanels = computed(() => [...new Set(entryRows.value.map((row) => row.panelId).filter(Boolean))]);
    const inspectedPanelId = computed(() => values.value.inspectedPanel?.primaryKey ?? "");

    function inspectPanel(panelId) {
      if (!panelId) return;
      instance.state.set("inspectedPanel", { className: PANEL, primaryKey: panelId });
    }

    function inspectPanelAndOpenTab(panelId) {
      instance.state.setState({
        inspectedPanel: { className: PANEL, primaryKey: panelId },
        tab: "assets",
      });
    }

    watch(
      [tabModel, usedPanels],
      ([tab, panels]) => {
        if (tab !== "assets" || panels.length === 0) return;
        if (!inspectedPanelId.value || !panels.includes(inspectedPanelId.value)) {
          inspectPanel(panels[0]);
        }
      },
      { immediate: true },
    );

    const inspectedMembers = computed(() => {
      if (panelMembers.value.status === "ready") {
        const value = panelMembers.value.value;
        const list = Array.isArray(value) ? value : value?.members ?? value?.rows ?? [];
        if (list.length) {
          return list
            .map((item) => ({
              className: item.className || (item.kind === "panel" ? PANEL : PROJECTION),
              primaryKey: item.primaryKey || item.projectionId || item.panelId || item.id,
              label: item.label || item.name || item.primaryKey || item.projectionId || item.panelId,
            }))
            .filter((item) => Boolean(item.primaryKey));
        }
      }
      if (panelInfo.value.status !== "ready") return [];
      const members = panelInfo.value.value?.fields?.members ?? panelInfo.value.value?.members ?? [];
      if (Array.isArray(members)) return members;
      return Object.values(members)
        .map((item) => item?.target?.projectionId)
        .filter(Boolean)
        .map((primaryKey) => ({ className: PROJECTION, primaryKey, label: primaryKey }));
    });

    // --- Entries helpers & theme breakdown ---
    function groupLabel(groupKey) {
      if (!groupKey) return "—";
      const found = (entryData.value?.groups ?? []).find((group) => group.key === groupKey);
      return found ? localizedText(found.names) || groupKey : groupKey;
    }

    function accessText(access) {
      if (!access) return "—";
      if (access.kind === "domain-member") return t("entries.accessDomainMember");
      if (access.permissionCode) return access.permissionCode;
      return "—";
    }

    function agentText(agent) {
      if (!agent) return t("entries.defaultAgent");
      if (agent.kind === "id") return agent.id;
      if (agent.kind === "preset") return agent.agentKind;
      return t("entries.defaultAgent");
    }

    const themeEntries = computed(() => {
      const theme = entryData.value?.theme ?? {};
      const toList = (bucket) =>
        Object.entries(bucket ?? {}).map(([key, value]) => ({ key, value: String(value ?? "") }));
      return { light: toList(theme.light), dark: toList(theme.dark) };
    });
    const hasThemeOverrides = computed(
      () => themeEntries.value.light.length > 0 || themeEntries.value.dark.length > 0,
    );

    function openAddEntry() {
      instance.state.setState({ entriesView: "list", editingEntryId: "__new__" });
    }

    function openEditEntry(row) {
      instance.state.setState({ entriesView: "list", editingEntryId: row.id });
    }

    const appTarget = computed(() =>
      selected.value ? { kind: "object", objectType: APPLICATION, primaryKey: selected.value.primaryKey } : null,
    );

    async function runWrite(member, operation, input) {
      if (!appTarget.value) return null;
      busy.value = true;
      try {
        const outcome = await instance.runOperation(member, operation, input, appTarget.value);
        if (outcome.kind === "cancelled") return null;
        if (outcome.kind === "failed") throw new Error(outcome.message || "Operation failed");
        instance.refreshObjects();
        return outcome;
      } finally {
        busy.value = false;
      }
    }

    const deleteEntryTarget = reactive({ open: false, id: "", name: "" });

    function confirmRemoveEntry(row) {
      deleteEntryTarget.id = row.id;
      deleteEntryTarget.name = localizedText(row.names) || row.id;
      deleteEntryTarget.open = true;
    }

    async function executeRemoveEntry() {
      const entryId = deleteEntryTarget.id;
      if (!entryId) return;
      try {
        const outcome = await runWrite("deleteEntry", "deleteEntry", { entryId });
        if (outcome) {
          deleteEntryTarget.open = false;
          notify({ kind: "success", text: t("entries.deleted") });
        }
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    // --- Grants & Domain Sharing ---
    const grantError = ref("");
    const grantDraft = reactive({ principalId: "", verb: "use" });

    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);

    watch(grantPrincipalKindModel, () => {
      grantDraft.principalId = "";
      grantError.value = "";
    });

    const activePrincipalOptions = computed(() => {
      const source = grantPrincipalKindModel.value === "role" ? roleOptions.value : userOptions.value;
      if (source.status !== "ready") return [];
      const list = source.value?.options ?? [];
      return list
        .filter((item) => typeof item.value === "string" && item.value.length > 0)
        .map((item) => ({ value: item.value, label: item.label || item.value }));
    });
    const principalOptionsLoading = computed(
      () => (grantPrincipalKindModel.value === "role" ? roleOptions.value.status : userOptions.value.status) === "loading",
    );

    function onPrincipalSearch(query) {
      const term = typeof query === "string" ? query.trim() : "";
      if (grantPrincipalKindModel.value === "role") {
        instance.state.set("roleKeyword", term || null);
      } else {
        instance.state.set("userKeyword", term || null);
      }
    }

    function grantKindLabel(kind) {
      if (kind === "role") return t("grants.role");
      if (kind === "domain") return t("grants.domain");
      return t("grants.principal");
    }

    function openGrantDialog() {
      grantError.value = "";
      grantDraft.principalId = "";
      grantDraft.verb = "use";
      instance.state.setState({
        grantPrincipalKind: "principal",
        userKeyword: null,
        roleKeyword: null,
        grantDialog: true,
      });
    }

    async function submitGrant() {
      grantError.value = "";
      const principalId = String(grantDraft.principalId ?? "").trim();
      if (!principalId) {
        grantError.value = t("grants.needPrincipal");
        return;
      }
      try {
        const outcome = await runWrite("grant", "grant", {
          principalKind: grantPrincipalKindModel.value,
          principalId,
          verb: grantDraft.verb,
          remove: false,
        });
        if (outcome) {
          grantDialogOpen.value = false;
          notify({ kind: "success", text: t("grants.added") });
        }
      } catch (reason) {
        grantError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    async function revokeExistingGrant(row) {
      try {
        const outcome = await runWrite("grant", "grant", {
          principalKind: row.principalKind,
          principalId: row.principalId,
          verb: row.verb,
          remove: true,
        });
        if (outcome) notify({ kind: "success", text: t("grants.revoked") });
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    async function toggleDomainShare(shared) {
      try {
        const outcome = await runWrite("share", "share", { shared: Boolean(shared) });
        if (outcome) notify({ kind: "success", text: t("grants.shareUpdated") });
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    return {
      t,
      selectedKey,
      tabModel,
      entriesBulkMode,
      editingEntryId,
      entryDialogOpen,
      grantDialogOpen,
      grantPrincipalKindModel,
      record,
      recordErrorText,
      app,
      canMaintain,
      canEditEntries,
      canGrant,
      appPath,
      entries,
      entryData,
      entryRows,
      grants,
      grantRows,
      isDomainShared,
      panelInfo,
      panelMembers,
      busy,
      identityDraft,
      goBack,
      onSaved,
      onEntriesFormSaved,
      onEntryFormSaved,
      closeEntryDialog,
      toggleEntriesView,
      onDeleteDone,
      retryRecord,
      openApplication,
      openPanelCatalogue,
      openMemberCatalogue,
      onNavigateReference,
      panelDisplayName,
      usedPanels,
      inspectedPanelId,
      inspectedMembers,
      inspectPanel,
      inspectPanelAndOpenTab,
      groupLabel,
      themeEntries,
      hasThemeOverrides,
      looksLikeColor,
      localizedText,
      accessText,
      agentText,
      openAddEntry,
      openEditEntry,
      deleteEntryTarget,
      confirmRemoveEntry,
      executeRemoveEntry,
      grantError,
      grantDraft,
      grantKindOptions,
      activePrincipalOptions,
      principalOptionsLoading,
      onPrincipalSearch,
      grantKindLabel,
      openGrantDialog,
      submitGrant,
      revokeExistingGrant,
      toggleDomainShare,
    };
  },
};

await mountPanel(ApplicationDetailPanel);
