import { computed, nextTick, reactive, ref, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/** List-detail toggle template for the Applications catalogue. */

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

function inputsText(inputs) {
  const pairs = Object.entries(inputs ?? {});
  if (!pairs.length) return "—";
  return pairs
    .map(([key, value]) => {
      if (!value || typeof value !== "object") return `${key}=—`;
      return `${key}=` + ("literal" in value ? JSON.stringify(value.literal) : `$${value.frameState}`);
    })
    .join(", ");
}

function themeText(theme) {
  const parts = [];
  for (const mode of ["light", "dark"]) {
    const count = Object.keys(theme?.[mode] ?? {}).length;
    if (count) parts.push(`${mode}: ${count}`);
  }
  return parts.join(" · ") || "—";
}

const ApplicationsPanel = {
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
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

    const scopeOptions = computed(() => [
      { value: "visible", label: t("scope.visible") },
      { value: "maintainable", label: t("scope.maintainable") },
    ]);

    const record = usePanelData("record", "record");
    const entries = usePanelData("entriesRead", "entries");
    const grants = usePanelData("grantsRead", "grants");
    const panelInfo = usePanelData("panelInfo", "panel");

    const app = computed(() => (record.value.status === "ready" ? record.value.value : null));
    const entryData = computed(() => (entries.value.status === "ready" ? entries.value.value : null));
    const entryRows = computed(() => entryData.value?.panelUses ?? []);
    const appPath = computed(() => app.value?.fields?.path ?? "");

    const detailBodyRef = ref(null);
    const addEntryRef = ref(null);
    const busy = ref(false);
    const entriesBulkMode = ref(false);

    function closeDetail() {
      creating.value = false;
      instance.state.set("selected", null);
      instance.state.set("tab", "identity");
      instance.state.set("inspectedPanel", null);
      expandedEntryId.value = null;
      addingEntry.value = false;
      entriesBulkMode.value = false;
    }

    // Unified Esc / Browser Back / Back button handling with host unsaved-changes guard.
    const { back } = usePanelBack(() => mode.value !== "list", closeDetail);

    // Scroll detail pane back to top when switching record, create mode, or tab.
    watch(
      () => [mode.value, selected.value?.primaryKey ?? null, tabModel.value],
      () => {
        nextTick(() => {
          if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0;
        });
      },
    );

    // Reset transient sub-view state when switching selected application.
    watch(
      () => selected.value?.primaryKey ?? null,
      () => {
        expandedEntryId.value = null;
        addingEntry.value = false;
        entriesBulkMode.value = false;
        entryError.value = "";
        instance.state.set("inspectedPanel", null);
      },
    );

    // Register object name for breadcrumbs and confirmations, and leave grants tab if not permitted.
    watch(app, (item) => {
      if (!item) return;
      instance.nameObjects(APPLICATION, [{ primaryKey: item.primaryKey, label: item.label }]);
      if (!item.fields?.canGrant && tabModel.value === "grants") {
        tabModel.value = "identity";
      }
    });

    // Follow drafts opened by the page assistant.
    watch(
      instance.draft,
      (draft) => {
        if (!draft) return;
        const id = draft.target?.id;
        if (!id) {
          creating.value = true;
          instance.state.set("selected", null);
          return;
        }
        creating.value = false;
        instance.state.set("selected", { className: APPLICATION, primaryKey: id });
        if (draft.slot === "entriesForm") {
          tabModel.value = "entries";
          entriesBulkMode.value = true;
        } else {
          tabModel.value = "identity";
        }
      },
      { immediate: true },
    );

    function onCreated(saved) {
      creating.value = false;
      if (saved?.primaryKey) {
        instance.state.set("selected", { className: APPLICATION, primaryKey: saved.primaryKey });
        tabModel.value = "identity";
      }
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.created") });
    }

    function onCancelCreate() {
      creating.value = false;
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function onEntriesFormSaved() {
      entriesBulkMode.value = false;
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    function onHeaderDone(operationName, outcome) {
      if (operationName === "delete" && outcome?.kind === "success") {
        instance.refreshObjects();
        closeDetail();
        notify({ kind: "success", text: t("notify.deleted") });
      }
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

    function onNavigateReference(reference) {
      if (!reference) return;
      if (reference.className === PANEL) {
        openPanelCatalogue(reference.primaryKey);
      } else if (reference.className === PROJECTION) {
        openMemberCatalogue(reference);
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
      void openCatalogueRecord("/ontology/panels", PANEL, panelId);
    }

    function openMemberCatalogue(member) {
      if (member.className === PROJECTION) {
        void openCatalogueRecord("/ontology/projections", PROJECTION, member.primaryKey);
      } else if (member.className === PANEL) {
        openPanelCatalogue(member.primaryKey);
      }
    }

    // --- Entries inline row expand & edit ---
    const expandedEntryId = ref(null);
    const expandedEntryKeys = computed(() => (expandedEntryId.value ? [expandedEntryId.value] : []));
    const addingEntry = ref(false);
    const entryError = ref("");
    const entryDraft = reactive({
      id: "",
      pageKey: "",
      panelId: "",
      path: "",
      nameZh: "",
      nameEn: "",
      groupKey: "",
      accessKind: "domain-member",
      permissionCode: "",
      agentKind: "none",
      agentValue: "",
      inputsText: "",
    });

    const groupChoices = computed(() =>
      (entryData.value?.groups ?? []).map((group) => ({
        key: group.key,
        label: localizedText(group.names) || group.key,
      })),
    );

    function groupText(groupKey) {
      if (!groupKey) return "—";
      const found = (entryData.value?.groups ?? []).find((group) => group.key === groupKey);
      return found ? localizedText(found.names) || groupKey : groupKey;
    }

    function loadEntryDraft(row) {
      entryError.value = "";
      entryDraft.id = row?.id ?? "";
      entryDraft.pageKey = row?.pageKey ?? "";
      entryDraft.panelId = row?.panelId ?? "";
      entryDraft.path = row?.path ?? "";
      entryDraft.nameZh = row?.names?.["zh-CN"] ?? "";
      entryDraft.nameEn = row?.names?.en ?? "";
      entryDraft.groupKey = row?.groupKey ?? "";
      entryDraft.accessKind = row?.access?.permissionCode ? "permissionCode" : "domain-member";
      entryDraft.permissionCode = row?.access?.permissionCode ?? "";
      entryDraft.agentKind = row?.defaultAgent?.kind ?? "none";
      entryDraft.agentValue = row?.defaultAgent?.id ?? row?.defaultAgent?.agentKind ?? "";
      entryDraft.inputsText = row?.inputs && Object.keys(row.inputs).length ? JSON.stringify(row.inputs, null, 2) : "";
    }

    function scrollExpandedRowIntoView(rowId) {
      nextTick(() => {
        const el = detailBodyRef.value?.querySelector(`[data-entry-row="${CSS.escape(rowId)}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }

    function toggleEntryRow(row) {
      addingEntry.value = false;
      if (expandedEntryId.value === row.id) {
        expandedEntryId.value = null;
        return;
      }
      loadEntryDraft(row);
      expandedEntryId.value = row.id;
      scrollExpandedRowIntoView(row.id);
    }

    function onEntryExpandChange(row, expandedRows) {
      const isOpen = Array.isArray(expandedRows) && expandedRows.some((item) => item.id === row.id);
      if (isOpen) {
        addingEntry.value = false;
        loadEntryDraft(row);
        expandedEntryId.value = row.id;
        scrollExpandedRowIntoView(row.id);
      } else if (expandedEntryId.value === row.id) {
        expandedEntryId.value = null;
      }
    }

    function collapseEntry() {
      expandedEntryId.value = null;
      entryError.value = "";
    }

    function startAddEntry() {
      expandedEntryId.value = null;
      loadEntryDraft(null);
      const appId = selected.value?.primaryKey ?? "app";
      entryDraft.path = `/applications/${appId}/`;
      addingEntry.value = true;
      nextTick(() => addEntryRef.value?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }

    function cancelEntryEdit() {
      addingEntry.value = false;
      entryError.value = "";
    }

    const appTarget = computed(() =>
      selected.value ? { kind: "object", objectType: APPLICATION, primaryKey: selected.value.primaryKey } : null,
    );

    async function runWrite(member, operation, input) {
      if (!appTarget.value) return null;
      busy.value = true;
      try {
        const answer = await instance.writeOperation(`${member}.${operation}`, {
          call: { target: appTarget.value, input },
        });
        if (answer.decision === "cancel") return null;
        const { response } = answer;
        if (response.kind === "not-dispatched") throw new Error(response.message);
        const outcome = response.outcome;
        if (!outcome) return null;
        if (outcome.kind === "success") {
          instance.refreshObjects();
          return outcome;
        }
        if (outcome.kind === "batch") throw new Error("Expected single-object outcome.");
        throw new Error(outcome.message || "Operation did not return an outcome.");
      } finally {
        busy.value = false;
      }
    }

    async function submitEntry(isEdit) {
      entryError.value = "";
      const id = entryDraft.id.trim();
      const pageKey = entryDraft.pageKey.trim();
      const panelId = entryDraft.panelId.trim();
      const path = entryDraft.path.trim();
      if (!id || !pageKey || !panelId || !path) {
        entryError.value = "请填写入口 ID、页面键、面板 ID 和地址。";
        return;
      }
      let inputs;
      if (entryDraft.inputsText.trim()) {
        try {
          const parsed = JSON.parse(entryDraft.inputsText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("传入参数必须是 JSON 对象。");
          }
          inputs = parsed;
        } catch (reason) {
          entryError.value = reason instanceof Error ? reason.message : String(reason);
          return;
        }
      }
      const names = {};
      if (entryDraft.nameZh.trim()) names["zh-CN"] = entryDraft.nameZh.trim();
      if (entryDraft.nameEn.trim()) names.en = entryDraft.nameEn.trim();

      const access =
        entryDraft.accessKind === "permissionCode"
          ? { permissionCode: entryDraft.permissionCode.trim() }
          : { kind: "domain-member" };

      const built = {
        id,
        pageKey,
        panelId,
        path,
        access,
        ...(Object.keys(names).length ? { names } : {}),
        ...(entryDraft.groupKey ? { groupKey: entryDraft.groupKey } : {}),
        ...(entryDraft.agentKind === "id" && entryDraft.agentValue.trim()
          ? { defaultAgent: { kind: "id", id: entryDraft.agentValue.trim() } }
          : entryDraft.agentKind === "preset" && entryDraft.agentValue.trim()
            ? { defaultAgent: { kind: "preset", agentKind: entryDraft.agentValue.trim() } }
            : {}),
        ...(inputs ? { inputs } : {}),
      };

      try {
        const outcome = isEdit
          ? await runWrite("updateEntry", "updateEntry", { entryId: id, entry: built })
          : await runWrite("addEntry", "addEntry", { entry: built });
        if (outcome) {
          expandedEntryId.value = null;
          addingEntry.value = false;
          notify({ kind: "success", text: t(isEdit ? "entries.saved" : "entries.added") });
        }
      } catch (reason) {
        entryError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    async function removeEntry(row) {
      try {
        const outcome = await runWrite("deleteEntry", "deleteEntry", { entryId: row.id });
        if (outcome) {
          if (expandedEntryId.value === row.id) expandedEntryId.value = null;
          notify({ kind: "success", text: t("entries.deleted") });
        }
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    // --- Panels & Projections tab ---
    const usedPanels = computed(() => [...new Set(entryRows.value.map((row) => row.panelId).filter(Boolean))]);
    const inspectedPanelId = computed(() => values.value.inspectedPanel?.primaryKey ?? "");
    const inspectedMembers = computed(() => {
      if (panelInfo.value.status !== "ready") return [];
      const members = panelInfo.value.value?.fields?.members ?? panelInfo.value.value?.members ?? [];
      if (Array.isArray(members)) return members;
      return Object.values(members)
        .map((item) => item?.target?.projectionId)
        .filter(Boolean)
        .map((primaryKey) => ({ className: PROJECTION, primaryKey }));
    });

    function inspectPanel(panelId) {
      instance.state.set("inspectedPanel", { className: PANEL, primaryKey: panelId });
    }

    function inspectPanelAndOpenTab(panelId) {
      inspectPanel(panelId);
      tabModel.value = "assets";
    }

    // --- Grants & Domain sharing tab ---
    const grantOpen = ref(false);
    const grantError = ref("");
    const grantDraft = reactive({
      principalKind: "principal",
      principalId: "",
      verb: "use",
    });

    function openGrantDialog() {
      grantError.value = "";
      grantDraft.principalId = "";
      grantOpen.value = true;
    }

    async function submitGrant() {
      grantError.value = "";
      if (!grantDraft.principalId.trim()) {
        grantError.value = t("grants.recipientPlaceholder");
        return;
      }
      try {
        const outcome = await runWrite("grant", "grant", {
          principalKind: grantDraft.principalKind,
          principalId: grantDraft.principalId.trim(),
          verb: grantDraft.verb,
          remove: false,
        });
        if (outcome) {
          grantOpen.value = false;
          notify({ kind: "success", text: t("grants.granted") });
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

    async function shareApplication(shared) {
      try {
        const outcome = await runWrite("share", "share", { shared });
        if (outcome) notify({ kind: "success", text: t(shared ? "grants.shared" : "grants.private") });
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    return {
      t,
      mode,
      selected,
      scopeModel,
      scopeOptions,
      sortModel,
      tabModel,
      detailBodyRef,
      addEntryRef,
      app,
      appPath,
      entries,
      entryData,
      entryRows,
      grants,
      panelInfo,
      busy,
      entriesBulkMode,
      back,
      onCreated,
      onCancelCreate,
      onSaved,
      onEntriesFormSaved,
      onHeaderDone,
      openApplication,
      onNavigateReference,
      openPanelCatalogue,
      openMemberCatalogue,
      localizedText,
      accessText,
      agentText,
      inputsText,
      themeText,
      groupText,
      groupChoices,
      expandedEntryId,
      expandedEntryKeys,
      addingEntry,
      entryError,
      entryDraft,
      toggleEntryRow,
      onEntryExpandChange,
      collapseEntry,
      startAddEntry,
      cancelEntryEdit,
      submitEntry,
      removeEntry,
      usedPanels,
      inspectedPanelId,
      inspectedMembers,
      inspectPanel,
      inspectPanelAndOpenTab,
      grantOpen,
      grantError,
      grantDraft,
      openGrantDialog,
      submitGrant,
      revokeExistingGrant,
      shareApplication,
    };
  },
};

await mountPanel(ApplicationsPanel);
