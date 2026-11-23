import { computed, reactive, ref, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelBack,
  usePanelContext,
  usePanelData,
  usePanelFormDraft,
} from "@ontomato/sdk/panel";

const APPLICATION = "platform:Application";
const PANEL = "platform:ProductPanel";
const PROJECTION = "platform:ProductProjection";

function localizedText(map) {
  if (!map || typeof map !== "object") return "";
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  if (lang && map[lang]) return map[lang];
  if (map["zh-CN"]) return map["zh-CN"];
  if (map.en) return map.en;
  return Object.values(map).find((value) => typeof value === "string" && value.trim()) ?? "";
}

function formatDateTime(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const locale = typeof document !== "undefined" && document.documentElement.lang ? document.documentElement.lang : undefined;
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function accessText(access) {
  if (!access) return "—";
  if (access.kind === "domain-member") return "本域成员";
  if (access.permissionCode) return access.permissionCode;
  return "—";
}

function agentText(agent) {
  if (!agent) return "通用助手";
  if (agent.kind === "id") return agent.id;
  if (agent.kind === "preset") return agent.agentKind;
  return "通用助手";
}

function looksLikeColor(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(trimmed);
}

const ApplicationsPanel = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const creating = computed({
      get: () => values.value.creating === true,
      set: (active) => instance.state.set("creating", active ? true : null),
    });
    const mode = computed(() => (creating.value ? "create" : selected.value ? "detail" : "list"));

    const scopeModel = computed({
      get: () => values.value.scope || "visible",
      set: (next) => instance.state.set("scope", next || "visible"),
    });
    const sortModel = computed({
      get: () => values.value.sort || "id",
      set: (next) => instance.state.set("sort", next || "id"),
    });
    const tabModel = computed({
      get: () => values.value.tab || "identity",
      set: (next) => instance.state.set("tab", next || "identity"),
    });
    const editingEntryId = computed({
      get: () => values.value.editingEntryId ?? "",
      set: (next) => instance.state.set("editingEntryId", next ? next : null),
    });

    const scopeOptions = computed(() => [
      { value: "visible", label: t("scope.visible") },
      { value: "maintainable", label: t("scope.maintainable") },
    ]);

    const record = usePanelData("record", "record");
    const entries = usePanelData("entriesRead", "entries");
    const grants = usePanelData("grantsRead", "grants");
    const panelCatalogue = usePanelData("panelCatalogue", "rows");
    const panelInfo = usePanelData("panelInfo", "panel");
    const panelMembers = usePanelData("panelInfo", "members");
    const userOptions = usePanelData("userOptions", "options");
    const roleOptions = usePanelData("roleOptions", "options");

    const app = computed(() => (record.value.status === "ready" ? record.value.value : null));
    const entryData = computed(() => (entries.value.status === "ready" ? entries.value.value : null));
    const entryRows = computed(() => entryData.value?.panelUses ?? []);
    const appPath = computed(() => app.value?.fields?.path ?? "");
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
    const entriesBulkMode = ref(false);
    const entryDialogOpen = computed({
      get: () => Boolean(editingEntryId.value),
      set: (open) => {
        if (!open) editingEntryId.value = "";
      },
    });

    // Save form handle for unified detail/create header actions
    const saveHandle = computed(() => instance.forms.handle("save"));
    const savingForm = computed(() => Boolean(saveHandle.value?.busy.value));
    const saveDirty = computed(() => Boolean(saveHandle.value && instance.forms.dirty()));
    const showIdentitySave = computed(
      () => mode.value === "detail" && tabModel.value === "identity" && Boolean(app.value?.fields?.canMaintain),
    );

    async function submitSaveForm() {
      if (!saveHandle.value || savingForm.value) return;
      try {
        await instance.forms.submit("save");
      } catch {
        // ObjectForm displays field-level or form-level owner refusals inline.
      }
    }

    function discardSaveForm() {
      instance.forms.discardAll();
    }

    function closeDetail() {
      instance.state.setState({
        creating: null,
        selected: null,
        tab: "identity",
        inspectedPanel: null,
        editingEntryId: null,
      });
      entriesBulkMode.value = false;
    }

    const back = usePanelBack(() => mode.value !== "list", closeDetail, { pushHistory: true });
    function handleBack() {
      void back.back();
    }

    const detailTitle = computed(() => {
      if (mode.value === "create") return t("action.create");
      return app.value?.label || selectedKey.value;
    });
    const identityDraft = usePanelFormDraft("save", {
      when: () => mode.value === "detail" && showIdentitySave.value,
    });
    function openCreate() {
      instance.state.setState({ creating: true, selected: null });
    }

    watch(selectedKey, () => {
      entriesBulkMode.value = false;
      editingEntryId.value = "";
      instance.state.set("inspectedPanel", null);
    });

    watch(app, (item) => {
      if (!item) return;
      instance.nameObjects(APPLICATION, [{ primaryKey: item.primaryKey, label: item.label }]);
      if (!item.fields?.canGrant && tabModel.value === "grants") {
        tabModel.value = "identity";
      }
    }, { immediate: true });

    // Route agent drafts cleanly to the matching form/tab
    watch(
      instance.draft,
      (draft) => {
        if (!draft) return;
        const id = draft.target?.id;
        if (!id) {
          instance.state.setState({ creating: true, selected: null });
          return;
        }
        instance.state.setState({
          creating: null,
          selected: { className: APPLICATION, primaryKey: id },
        });
        if (draft.slot === "entriesForm") {
          tabModel.value = "entries";
          entriesBulkMode.value = true;
        } else if (draft.slot === "entryForm") {
          tabModel.value = "entries";
          entriesBulkMode.value = false;
          const draftEntryId = draft.form?.id;
          editingEntryId.value = typeof draftEntryId === "string" && draftEntryId ? draftEntryId : "__new__";
        } else {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

    function onCreated(saved) {
      instance.state.setState({
        creating: null,
        selected: saved?.primaryKey ? { className: APPLICATION, primaryKey: saved.primaryKey } : null,
        tab: "identity",
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
    }

    function cancelCreate() {
      void back.back();
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function onEntriesFormSaved() {
      entriesBulkMode.value = false;
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

    function onDeleteDone(outcome) {
      if (outcome?.kind === "success") {
        instance.refreshObjects();
        closeDetail();
        notify({ kind: "success", text: t("notify.deleted") });
      }
    }

    function retryRecord() {
      instance.refreshObjects();
    }

    async function openApplication() {
      const targetPath = app.value?.fields?.home || appPath.value;
      if (!targetPath) return;
      try {
        await navigate(targetPath);
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

    // --- Panel display name lookup & Panels/Projections tab (fixes A-30) ---
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
      inspectPanel(panelId);
      tabModel.value = "assets";
    }

    // Auto-select the first used panel when opening the Panels & Projections tab (fixes A-30)
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
          return list.map((item) => ({
            className: item.className || (item.kind === "panel" ? PANEL : PROJECTION),
            primaryKey: item.primaryKey || item.projectionId || item.panelId || item.id,
            label: item.label || item.name || item.primaryKey || item.projectionId || item.panelId,
          })).filter((item) => Boolean(item.primaryKey));
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

    // --- Entries helpers & theme breakdown (fixes A-29, A-32) ---
    function groupLabel(groupKey) {
      if (!groupKey) return "—";
      const found = (entryData.value?.groups ?? []).find((group) => group.key === groupKey);
      return found ? localizedText(found.names) || groupKey : groupKey;
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
      entriesBulkMode.value = false;
      editingEntryId.value = "__new__";
    }

    function openEditEntry(row) {
      entriesBulkMode.value = false;
      editingEntryId.value = row.id;
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

    // --- Grants & Domain Sharing (fixes A-24, A-28) ---
    const grantOpen = ref(false);
    const grantError = ref("");
    const grantDraft = reactive({ principalKind: "principal", principalId: "", verb: "use" });

    const grantKindOptions = computed(() => [
      { value: "principal", label: t("grants.principal") },
      { value: "role", label: t("grants.role") },
    ]);

    watch(() => grantDraft.principalKind, () => {
      grantDraft.principalId = "";
      grantError.value = "";
    });

    const activePrincipalOptions = computed(() => {
      const source = grantDraft.principalKind === "role" ? roleOptions.value : userOptions.value;
      if (source.status !== "ready") return [];
      const list = source.value?.options ?? [];
      return list
        .filter((item) => typeof item.value === "string" && item.value.length > 0)
        .map((item) => ({ value: item.value, label: item.label || item.value }));
    });
    const principalOptionsLoading = computed(() =>
      (grantDraft.principalKind === "role" ? roleOptions.value.status : userOptions.value.status) === "loading",
    );

    function onPrincipalSearch(query) {
      const term = typeof query === "string" ? query.trim() : "";
      if (grantDraft.principalKind === "role") {
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
      grantDraft.principalKind = "principal";
      grantDraft.principalId = "";
      grantDraft.verb = "use";
      instance.state.setState({ userKeyword: null, roleKeyword: null });
      grantOpen.value = true;
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
          principalKind: grantDraft.principalKind,
          principalId,
          verb: grantDraft.verb,
          remove: false,
        });
        if (outcome) {
          grantOpen.value = false;
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
      appIcon,
      mode,
      identityDraft,
      openCreate,
      refresh: () => instance.refreshObjects(),
      detailTitle,
      scopeModel,
      scopeOptions,
      sortModel,
      tabModel,
      editingEntryId,
      entryDialogOpen,
      record,
      recordErrorText,
      app,
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
      entriesBulkMode,
      savingForm,
      saveDirty,
      showIdentitySave,
      handleBack,
      submitSaveForm,
      discardSaveForm,
      cancelCreate,
      onCreated,
      onSaved,
      onEntriesFormSaved,
      onEntryFormSaved,
      closeEntryDialog,
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
      formatDateTime,
      accessText,
      agentText,
      openAddEntry,
      openEditEntry,
      deleteEntryTarget,
      confirmRemoveEntry,
      executeRemoveEntry,
      grantOpen,
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

await mountPanel(ApplicationsPanel);
