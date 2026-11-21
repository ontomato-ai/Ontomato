import { computed, reactive, ref, watch } from "vue";
import { appIcon, mountPanel, usePanelContext, usePanelData } from "@ontomato/sdk/panel";

/** The application catalogue uses the owner's declared reads, forms and operations. */

const APPLICATION = "platform:Application";
const PANEL = "platform:ProductPanel";

function localeRows(map) {
  const locales = [...new Set([document.documentElement.lang, "en", ...Object.keys(map ?? {})])];
  return locales.filter(key => map?.[key]).map(key => ({ key, value: map[key] }));
}

function localizedText(text) {
  return localeRows(text)[0]?.value ?? "";
}

function secondaryName(names) {
  return localeRows(names).find((item, index, rows) => index > 0 && item.value !== rows[0].value)?.value ?? "";
}

function accessText(access) {
  if (!access) return "—";
  if (access.kind === "domain-member") return "本域成员";
  if (access.permissionCode) return `权限码 ${access.permissionCode}`;
  return "—";
}

function agentText(agent) {
  if (!agent) return "通用助手";
  if (agent.kind === "id") return `智能体 ${agent.id}`;
  if (agent.kind === "preset") return `预置 ${agent.agentKind}`;
  return "通用助手";
}

function inputsText(inputs) {
  const entries = Object.entries(inputs ?? {});
  if (!entries.length) return "—";
  return entries.map(([key, value]) => {
    if (!value || typeof value !== "object") return `${key}=—`;
    return `${key}=` + ("literal" in value ? JSON.stringify(value.literal) : `状态 ${value.frameState}`);
  }).join("; ");
}

function themeText(theme) {
  const parts = [];
  for (const mode of ["light", "dark"]) {
    const values = theme?.[mode] ?? {};
    const keys = Object.keys(values);
    if (keys.length) parts.push(`${mode}: ${keys.length} 项`);
  }
  return parts.join(" · ") || "—";
}

const Applications = {
  setup() {
    const { instance, navigate } = usePanelContext();
    const values = instance.state.values;
    const selected = computed(() => values.value.selected ?? null);
    const catalogue = usePanelData("catalogue", "rows");
    const record = usePanelData("record", "record");
    const panelInfo = usePanelData("panelInfo", "panel");

    const creating = computed({
      get: () => values.value.creating === true,
      set(active) {
        instance.state.set("creating", active ? true : null);
      },
    });
    const mode = computed(() => (creating.value ? "create" : selected.value ? "detail" : "list"));
    const busy = ref(false);
    const listError = ref("");
    const actionError = ref("");
    const actionNote = ref("");
    const classLinkNote = ref("");

    const rows = computed(() => (catalogue.value.status === "ready" ? catalogue.value.value.rows ?? [] : []));
    const nextCursor = computed(() => (catalogue.value.status === "ready" ? catalogue.value.value.nextCursor ?? null : null));
    const app = computed(() => (record.value.status === "ready" ? record.value.value : null));

    const searchText = ref(values.value.search ?? "");
    const scope = computed(() => values.value.scope ?? "visible");
    const pageSize = computed(() => values.value.size ?? 20);
    const cursors = ref([]);
    const pageIndex = computed(() => cursors.value.length + 1);
    const isFirstPage = computed(() => cursors.value.length === 0);

    watch(rows, (list) => {
      instance.nameObjects(APPLICATION, list.map((row) => ({ primaryKey: row.id, label: localizedText(row.names) || row.id })));
    }, { immediate: true });

    watch(() => values.value.search, (value) => {
      if ((value ?? "") !== searchText.value) searchText.value = value ?? "";
    });

    let searchTimer;
    function scheduleSearch() {
      globalThis.clearTimeout(searchTimer);
      searchTimer = globalThis.setTimeout(() => {
        instance.state.set("search", searchText.value.trim() || null);
        instance.state.set("cursor", null);
        cursors.value = [];
      }, 250);
    }

    function setScope(value) {
      instance.state.set("scope", value);
      instance.state.set("cursor", null);
      cursors.value = [];
    }

    function setSize(value) {
      instance.state.set("size", value);
      instance.state.set("cursor", null);
      cursors.value = [];
    }

    function nextPage() {
      if (!nextCursor.value) return;
      cursors.value = [...cursors.value, values.value.cursor ?? null];
      instance.state.set("cursor", nextCursor.value);
    }

    function firstPage() {
      cursors.value = [];
      instance.state.set("cursor", null);
    }

    function openRow(row) {
      closeForm();
      actionError.value = "";
      actionNote.value = "";
      classLinkNote.value = "";
      creating.value = false;
      instance.state.set("selected", { className: APPLICATION, primaryKey: row.id });
    }

    function backToList() {
      closeForm();
      actionError.value = "";
      actionNote.value = "";
      classLinkNote.value = "";
      creating.value = false;
      instance.state.set("selected", null);
    }

    function createdApplication(saved) {
      actionNote.value = "应用已新建。";
      creating.value = false;
      if (saved?.primaryKey) instance.state.set("selected", { className: APPLICATION, primaryKey: saved.primaryKey });
      instance.refreshObjects();
    }

    async function write(member, operation, input, target) {
      busy.value = true;
      actionError.value = "";
      actionNote.value = "";
      try {
        const answer = await instance.writeOperation(`${member}.${operation}`, { call: { target, input } });
        if (answer.decision === "cancel") return null;
        const { response } = answer;
        if (response.kind === "not-dispatched") throw new Error(response.message);
        const outcome = response.outcome;
        if (!outcome) return null;
        if (outcome.kind === "success") {
          instance.refreshObjects();
          return outcome;
        }
        if (outcome.kind === "batch") throw new Error("属主按批量答的，这一页只会一次改一张应用。");
        throw new Error(outcome.message || "属主没有给出结果");
      } finally {
        busy.value = false;
      }
    }

    const target = computed(() => (app.value ? { kind: "object", objectType: APPLICATION, primaryKey: app.value.id } : null));


    async function openApplication() {
      if (!app.value) return;
      actionError.value = "";
      try {
        await navigate(app.value.entry.path);
      } catch (reason) {
        actionError.value = `打不开这个应用：${reason instanceof Error ? reason.message : String(reason)}`;
      }
    }

    async function openClassCatalogue() {
      classLinkNote.value = "";
      try {
        await navigate(`/ontology/classes/${encodeURIComponent(APPLICATION)}`);
      } catch (reason) {
        classLinkNote.value = `平台没有打开类目录：${reason instanceof Error ? reason.message : String(reason)}`;
      }
    }

    async function openPanelCatalogue(panelId) {
      classLinkNote.value = "";
      try {
        const state = JSON.stringify({ selected: { className: PANEL, primaryKey: panelId } });
        await navigate(`/ontology/panels?${new globalThis.URLSearchParams({ state })}`);
      } catch (reason) {
        classLinkNote.value = `平台没有打开面板目录：${reason instanceof Error ? reason.message : String(reason)}`;
      }
    }


    const usedPanels = computed(() => {
      const ids = (app.value?.panelUses ?? []).map((use) => use.panelId);
      return [...new Set(ids)];
    });
    const inspectedPanelId = computed(() => values.value.inspectedPanel?.primaryKey ?? "");
    const inspectedProjections = computed(() => {
      if (panelInfo.value.status !== "ready") return [];
      const members = Object.values(panelInfo.value.value?.manifest?.members ?? {});
      const ids = [];
      for (const member of members) {
        if (member?.target?.projectionId) ids.push(member.target.projectionId);
        if (member?.target?.panelId) ids.push(`panel ${member.target.panelId}`);
        for (const candidate of member?.target?.candidates?.panelIds ?? []) ids.push(`panel ${candidate}`);
      }
      return [...new Set(ids)];
    });

    function inspectPanel(panelId) {
      if (!panelId) return;
      instance.state.set("inspectedPanel", { className: PANEL, primaryKey: panelId });
    }

    function groupText(groupKey) {
      if (!groupKey) return "—";
      const group = (app.value?.groups ?? []).find((item) => item.key === groupKey);
      return group ? `${localizedText(group.names) || group.key} · ${group.sort}` : groupKey;
    }

    function permissionSummary(current) {
      if (!current) return "—";
      const parts = [];
      if (current.canMaintain) parts.push("改身份、删除");
      if (current.canEditEntries) parts.push("改入口");
      if (current.canGrant) parts.push("授权");
      return parts.length ? parts.join("、") : "只能看";
    }

    const formSection = ref(null);

    function closeForm() {
      formSection.value = null;
    }

    function discardForm() {
      if (creating.value) backToList();
      else closeForm();
    }

    function finishForm(saved) {
      if (creating.value) {
        createdApplication(saved);
        return;
      }
      actionNote.value = formSection.value === "entries" ? "入口已保存。" : "身份已保存。";
      closeForm();
    }


    const entryOpen = ref(false);
    const entryEditing = ref(false);
    const entryError = ref("");
    const entry = reactive({
      id: "", pageKey: "", panelId: "", path: "", nameZh: "", nameEn: "", groupKey: "",
      accessKind: "domain-member", permissionCode: "", agentKind: "none", agentValue: "", inputsText: "",
    });

    const groupChoices = computed(() => (app.value?.groups ?? []).map((group) => ({
      key: group.key, label: `${localizedText(group.names) || group.key} · ${group.sort}`,
    })));

    function fillEntry(use) {
      entry.id = use?.id ?? "";
      entry.pageKey = use?.pageKey ?? "";
      entry.panelId = use?.panelId ?? "";
      entry.path = use?.path ?? "";
      entry.nameZh = use?.names?.["zh-CN"] ?? "";
      entry.nameEn = use?.names?.en ?? "";
      entry.groupKey = use?.groupKey ?? "";
      entry.accessKind = use?.access?.permissionCode ? "permissionCode" : "domain-member";
      entry.permissionCode = use?.access?.permissionCode ?? "";
      const agent = use?.defaultAgent;
      entry.agentKind = agent?.kind ?? "none";
      entry.agentValue = agent?.kind === "id" ? agent.id : agent?.kind === "preset" ? agent.agentKind : "";
      entry.inputsText = use?.inputs ? JSON.stringify(use.inputs, null, 2) : "";
    }

    function startAddEntry() {
      fillEntry(null);
      entry.pageKey = "";
      entry.path = app.value ? `${app.value.entry.path}/` : "";
      entryEditing.value = false;
      entryError.value = "";
      entryOpen.value = true;
    }

    function startEditEntry(use) {
      fillEntry(use);
      entryEditing.value = true;
      entryError.value = "";
      entryOpen.value = true;
    }

    function buildEntry() {
      const id = entry.id.trim();
      const panelId = entry.panelId.trim();
      const path = entry.path.trim();
      if (!id) throw new Error("入口 ID 不能为空。");
      if (!panelId) throw new Error("面板 ID 不能为空。");
      if (!path.startsWith("/") || path.startsWith("//") || /[?#\s]/u.test(path)) throw new Error("地址要写成 / 开头的规范地址，不带问号、井号和空白。");
      if (path !== "/" && path.slice(1).split("/").some((segment) => !segment)) throw new Error("地址的每一段都要有名字：不要留空段，也不要以 / 结尾。");
      const names = {};
      if (entry.nameZh.trim()) names["zh-CN"] = entry.nameZh.trim();
      if (entry.nameEn.trim()) names.en = entry.nameEn.trim();
      const built = { id, pageKey: entry.pageKey.trim() || id, panelId, path };
      if (Object.keys(names).length) built.names = names;
      if (entry.groupKey) built.groupKey = entry.groupKey;
      built.access = entry.accessKind === "permissionCode"
        ? { permissionCode: entry.permissionCode.trim() }
        : { kind: "domain-member" };
      if (entry.accessKind === "permissionCode" && !entry.permissionCode.trim()) throw new Error("选了权限码就要写一个。");
      if (entry.agentKind === "id" && entry.agentValue.trim()) built.defaultAgent = { kind: "id", id: entry.agentValue.trim() };
      if (entry.agentKind === "preset" && entry.agentValue.trim()) built.defaultAgent = { kind: "preset", agentKind: entry.agentValue.trim() };
      if (entry.inputsText.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(entry.inputsText);
        } catch {
          throw new Error("传入值要是一段 JSON。");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("传入值要是一个 JSON 对象。");
        built.inputs = parsed;
      }
      return built;
    }

    async function submitEntry() {
      entryError.value = "";
      try {
        const built = buildEntry();
        const outcome = entryEditing.value
          ? await write("updateEntry", "updateEntry", { entryId: entry.id, entry: built }, target.value)
          : await write("addEntry", "addEntry", { entry: built }, target.value);
        if (outcome) {
          entryOpen.value = false;
          actionNote.value = entryEditing.value ? "入口已保存。" : "入口已添加。";
        }
      } catch (reason) {
        entryError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    async function removeEntry(use) {
      try {
        const outcome = await write("deleteEntry", "deleteEntry", { entryId: use.id }, target.value);
        if (outcome) actionNote.value = "入口已删除。";
      } catch (reason) {
        actionError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }


    async function removeApplication() {
      if (!app.value) return;
      askConfirm(`删除应用「${localizedText(app.value.names) || app.value.id}」？删除后它的入口一起消失，不能撤回。`, doRemoveApplication);
    }

    async function doRemoveApplication() {
      try {
        const outcome = await write("deleteApp", "delete", {}, target.value);
        if (outcome) {
          creating.value = false;
          instance.state.set("selected", null);
          actionNote.value = "应用已删除。";
        }
      } catch (reason) {
        actionError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }


    const grantOpen = ref(false);
    const grantError = ref("");
    const grant = reactive({ principalKind: "principal", principalId: "", verb: "use" });

    function openGrant() {
      grantError.value = "";
      grantOpen.value = true;
    }

    async function submitGrant(remove) {
      grantError.value = "";
      if (!grant.principalId.trim()) {
        grantError.value = "要写授给谁的 ID。";
        return;
      }
      try {
        const outcome = await write("grant", "grant", {
          principalKind: grant.principalKind, principalId: grant.principalId.trim(), verb: grant.verb, remove: Boolean(remove),
        }, target.value);
        if (outcome) {
          grantOpen.value = false;
          actionNote.value = remove ? "授权已撤销。" : "授权已给出。";
        }
      } catch (reason) {
        grantError.value = reason instanceof Error ? reason.message : String(reason);
      }
    }

    const confirmState = reactive({ open: false, message: "", run: null });

    function askConfirm(message, run) {
      confirmState.message = message;
      confirmState.run = run;
      confirmState.open = true;
    }

    async function confirmRemove() {
      const run = confirmState.run;
      confirmState.open = false;
      confirmState.run = null;
      if (run) await run();
    }

    watch(creating, active => {
      if (!active) return;
      closeForm();
      actionError.value = "";
      actionNote.value = "";
    }, { immediate: true });
    watch(instance.draft, (draft) => {
      if (!draft) return;
      const id = draft.target.id;
      if (!id) {
        creating.value = true;
        instance.state.set("selected", null);
        return;
      }
      creating.value = false;
      instance.state.set("selected", { className: APPLICATION, primaryKey: id });
      formSection.value = draft.slot === "entriesForm" ? "entries" : "identity";
    }, { immediate: true });

    return {
      APPLICATION, catalogue, record, panelInfo, selected, rows, nextCursor, app, appIcon, mode, creating, busy,
      searchText, scope, pageSize, pageIndex, isFirstPage, listError, actionError, actionNote, classLinkNote,
      scheduleSearch, setScope, setSize, nextPage, firstPage, openRow, backToList, createdApplication,
      openApplication, openClassCatalogue, openPanelCatalogue, usedPanels, inspectedPanelId, inspectedProjections,
      inspectPanel, groupText, permissionSummary, localeRows, localizedText, secondaryName,
      accessText, agentText, inputsText, themeText,
      formSection, closeForm, discardForm, finishForm,
      entryOpen, entryEditing, entryError, entry, groupChoices, startAddEntry, startEditEntry, submitEntry, removeEntry,
      removeApplication, confirmState, confirmRemove, grantOpen, grantError, grant, openGrant, submitGrant,
    };
  },
};

await mountPanel(Applications);
