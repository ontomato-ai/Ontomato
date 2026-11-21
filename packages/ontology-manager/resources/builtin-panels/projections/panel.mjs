import { computed, reactive, ref, watch } from "vue";
import { mountPanel, usePanelData, usePanelContext, usePanelOperation } from "@ontomato/sdk/panel";

/** The projection catalogue displays the owner's reads and dispatches the owner's operations. */

const TYPE = "platform:ProductProjection";
const CHART_COMPONENT = "@ontomato/sdk:MetricChart";
const CLASSES_PAGE = "/ontology/classes";
const PANELS_PAGE = "/ontology/panels";

const COMPONENT_LABELS = {
  ObjectSummary: "对象摘要",
  ObjectList: "对象列表",
  ObjectForm: "对象表单",
  ObjectGraph: "对象图谱",
  MetricChart: "指标图",
  MetricViewData: "指标数据",
  PanelData: "自定义数据",
  EChart: "图表",
  MarkdownView: "Markdown 文本",
  TablePreview: "表格预览",
  HtmlPreview: "HTML 预览",
  CodeEditor: "代码查看",
  SegmentedControl: "选项切换",
  TwoPaneLayout: "双栏版式",
  SectionGroup: "分组版式",
  ReferencePicker: "引用选择",
  FileUploadControl: "文件上传",
  ConversationEntry: "对话入口",
  AgentChatPanel: "对话面板",
  AgentShell: "对话外壳",
  GraphCanvas: "图谱画布",
  G6GraphCanvas: "交互图谱",
  OntologyGraph: "本体图谱",
  ObjectRelations: "关系列表",
  PathTree: "路径树",
  ObjectTree: "对象树",
  ObjectTextReader: "文本读取",
  SegmentedTextReader: "文本分段读取",
  ToolStep: "工具步骤",
  ProductAsset: "产品资产",
};

const reasonText = (reason) => (reason && typeof reason === "object" && "message" in reason ? reason.message : String(reason));

const componentName = (componentId) => String(componentId ?? "").split(":").pop() ?? "";

const componentLabel = (componentId) => {
  const name = componentName(componentId);
  return COMPONENT_LABELS[name] ? `${COMPONENT_LABELS[name]} · ${name}` : name || "—";
};

const scopeLabel = (visibility) => ({ platform: "平台自带", domain: "域内共享", private: "私有" })[visibility];

const portText = (port) => {
  if (!port) return "—";
  switch (port.kind) {
    case "object":
      return `对象 · ${port.objectType}`;
    case "object-union":
      return "对象 · 多种类";
    case "child-object":
      return `子对象 · ${port.parentType}/${port.collection}`;
    case "list":
      return `列表 · ${portText(port.items)}`;
    case "scalar":
      return `值 · ${port.type}`;
    case "placement":
      return "放置 · 面板";
    case "json":
      return "JSON";
    default:
      return port.kind;
  }
};

const sourceText = (source) => {
  if (!source) return "—";
  if (source.type) return `${source.type.kind === "PlatformObjectType" ? "平台类" : "本体类"} · ${source.type.id}`;
  const object = source.object ?? {};
  if (object.literal) return `对象 · ${object.literal.className} / ${object.literal.primaryKey}`;
  if (object.input) return `输入「${object.input}」的对象`;
  return "—";
};

const paramsText = (params) => {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return "无";
  return entries
    .map(([name, value]) => {
      if (value && "literal" in value) return `${name} ← 固定 ${JSON.stringify(value.literal)}`;
      if (value && "input" in value) return `${name} ← 输入「${value.input}」`;
      return name;
    })
    .join("；");
};

const operationTargetText = (target) => {
  if (!target) return "无目标";
  if (target.input) return `输入「${target.input}」`;
  if (target.literal) return `对象 ${target.literal.className} / ${target.literal.primaryKey}`;
  return "—";
};

const formatTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

const jsonText = (value) => JSON.stringify(value ?? {}, null, 2);

const outcomeOf = (result) => {
  const response = result?.response ?? result;
  if (!response) return { ok: true };
  if (response.kind === "not-dispatched") return { ok: false, message: response.message };
  const outcome = response.outcome;
  if (!outcome) return { ok: true };
  if (outcome.kind === "success") return { ok: true, message: outcome.message };
  const users = Array.isArray(outcome.details?.panels) ? outcome.details.panels.map((panel) => panel.name).filter(Boolean) : [];
  const suffix = users.length ? `：${users.join("、")}` : "";
  return { ok: false, message: `${outcome.message ?? outcome.code ?? "属主拒绝了这次操作"}${suffix}` };
};

const newId = () => `projection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

await mountPanel({
  setup() {
    const { instance, navigate } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? null);
    const search = computed(() => values.value.search ?? "");
    const scope = computed(() => values.value.scope ?? "all");
    const sort = computed(() => values.value.sort ?? "updated");

    const notice = ref(null);
    let noticeTimer;
    function say(tone, text) {
      notice.value = { tone, text };
      globalThis.clearTimeout(noticeTimer);
      noticeTimer = globalThis.setTimeout(() => { notice.value = null; }, 8000);
    }
    function report(reason) {
      say("error", reasonText(reason));
    }

    const searchDraft = ref(search.value);
    let searchTimer;
    watch(searchDraft, (next) => {
      globalThis.clearTimeout(searchTimer);
      searchTimer = globalThis.setTimeout(() => {
        if (search.value !== next) instance.state.set("search", next === "" ? null : next);
      }, 250);
    });
    watch(search, (next) => {
      if (searchDraft.value !== next) searchDraft.value = next;
    });

    const cursor = ref(null);
    const pageSize = ref(20);
    const pageNumber = ref(1);
    const cursorHistory = ref([null]);
    const listParams = ref({ cursor: null, size: 20 });
    watch([cursor, pageSize], () => {
      const next = { cursor: cursor.value ?? null, size: pageSize.value };
      if (listParams.value.cursor !== next.cursor || listParams.value.size !== next.size) listParams.value = next;
    });
    const list = usePanelData("list", "rows", () => listParams.value);
    const rows = computed(() => (list.value.status === "ready" ? list.value.value.items ?? [] : []));
    const nextCursor = computed(() => (list.value.status === "ready" ? list.value.value.nextCursor ?? null : null));

    watch([search, scope, sort, pageSize], () => {
      cursorHistory.value = [null];
      pageNumber.value = 1;
      cursor.value = null;
    });

    const listStatusText = computed(() => {
      const status = list.value.status;
      if (status === "loading") return "读取中…";
      if (status === "forbidden") return "没有读取投影的授权";
      if (status === "error") return reasonText(list.value.message);
      if (status === "awaiting") return "…";
      const more = nextCursor.value ? " · 还有下一页" : "";
      return `本页 ${rows.value.length} 条${more}`;
    });

    function nextPage() {
      if (!nextCursor.value) return;
      cursorHistory.value[pageNumber.value] = nextCursor.value;
      cursor.value = nextCursor.value;
      pageNumber.value += 1;
    }

    function previousPage() {
      if (pageNumber.value <= 1) return;
      pageNumber.value -= 1;
      cursor.value = cursorHistory.value[pageNumber.value - 1] ?? null;
    }

    const setScope = (value) => instance.state.set("scope", value ?? "all");
    const setSort = (value) => instance.state.set("sort", value ?? "updated");
    const setPageSize = (value) => { pageSize.value = Number(value) || 20; };

    const record = usePanelData("record", "record");
    const usedBy = usePanelData("usedBy", "usedBy");
    const usedPanels = computed(() => (usedBy.value.status === "ready" ? usedBy.value.value.panels ?? [] : []));
    const hiddenCount = computed(() => (usedBy.value.status === "ready" ? usedBy.value.value.hiddenCount ?? 0 : 0));
    const usedByCountText = computed(() => {
      const status = usedBy.value.status;
      if (status === "loading") return "读取中…";
      if (status === "forbidden") return "没有读到使用方";
      if (status === "error") return reasonText(usedBy.value.message);
      if (status === "ready" || status === "empty") {
        const hidden = hiddenCount.value > 0 ? `，另有 ${hiddenCount.value} 个不可见` : "";
        return `${usedPanels.value.length} 个面板${hidden}`;
      }
      return "";
    });

    const copy = usePanelOperation("copyOp", "copy");
    const remove = usePanelOperation("deleteOp", "delete");
    const grant = usePanelOperation("grantOp", "grant");
    const revoke = usePanelOperation("revokeOp", "revoke");
    const share = usePanelOperation("shareOp", "share");

    const mode = ref("view");
    watch(instance.draft, (draft) => {
      if (draft) mode.value = "edit";
    }, { immediate: true });

    const current = computed(() => (record.value.status === "ready" ? record.value.value : null));

    const dataRows = computed(() =>
      Object.entries(current.value?.data ?? {}).map(([name, datum]) => ({
        name,
        source: sourceText(datum.source),
        read: datum.read ?? "—",
        params: paramsText(datum.params),
      })));

    const operationRows = computed(() =>
      Object.entries(current.value?.operations ?? {}).map(([name, binding]) => ({
        name,
        operation: `${binding.operation?.kind ?? ""} · ${binding.operation?.id ?? ""}`,
        target: operationTargetText(binding.target),
      })));

    const inputRows = computed(() =>
      Object.entries(current.value?.inputs ?? {}).map(([name, port]) => ({ name, text: portText(port) })));

    const outputRows = computed(() =>
      Object.entries(current.value?.outputs ?? {}).map(([name, port]) => ({ name, text: portText(port) })));

    const isChart = (value) => Boolean(value) && value.componentId === CHART_COMPONENT;
    const canGrant = computed(() => Boolean(current.value?.editable));

    function choose(row) {
      if (!row) return;
      mode.value = "view";
      instance.state.set("selected", { className: TYPE, primaryKey: row.id });
    }

    function startCreate() {
      mode.value = "edit";
      instance.state.set("selected", null);
    }

    function startEdit() {
      if (!current.value?.editable) return;
      mode.value = "edit";
    }

    function onSaved(saved) {
      mode.value = "view";
      if (saved && saved.primaryKey)
        instance.state.set("selected", { className: saved.className ?? TYPE, primaryKey: saved.primaryKey });
      say("success", "已保存");
    }

    const onDiscarded = () => { mode.value = "view"; };

    const copyDialog = ref(false);
    const copyForm = reactive({ id: "", name: "" });

    function openCopy() {
      if (!current.value) return;
      copyForm.name = `${current.value.name} 副本`;
      copyForm.id = newId();
      copyDialog.value = true;
    }

    async function submitCopy() {
      try {
        const answer = outcomeOf(await copy.run({ id: copyForm.id, name: copyForm.name }));
        if (!answer.ok) { say("error", answer.message); return; }
        copyDialog.value = false;
        instance.state.set("selected", { className: TYPE, primaryKey: copyForm.id });
        say("success", "已复制成一条新的私有投影");
      } catch (reason) {
        report(reason);
      }
    }

    const deleteDialog = ref(false);

    function openDelete() {
      if (!current.value) return;
      deleteDialog.value = true;
    }

    async function submitDelete() {
      const projection = current.value;
      if (!projection) return;
      try {
        const answer = outcomeOf(await remove.run({ revision: projection.revision }));
        if (!answer.ok) {
          const users = usedPanels.value.map((panel) => panel.name).join("、");
          say("error", `${answer.message}${users ? `：${users}` : ""}`);
          return;
        }
        deleteDialog.value = false;
        mode.value = "view";
        instance.state.set("selected", null);
        say("success", "已删除");
      } catch (reason) {
        const users = usedPanels.value.map((panel) => panel.name).join("、");
        report(`${reasonText(reason)}${users ? `：${users}` : ""}`);
      }
    }

    const grantForm = reactive({ principalKind: "principal", principalId: "", verb: "use" });

    async function submitGrant(removeGrant) {
      if (!grantForm.principalId) return;
      const input = { principalKind: grantForm.principalKind, principalId: grantForm.principalId, verb: grantForm.verb };
      try {
        const answer = outcomeOf(await (removeGrant ? revoke : grant).run(input));
        if (!answer.ok) { say("error", answer.message); return; }
        say("success", removeGrant ? "已撤销授权" : "已授予授权");
      } catch (reason) {
        report(reason);
      }
    }

    async function submitShare(shared) {
      try {
        const answer = outcomeOf(await share.run({ shared }));
        if (!answer.ok) { say("error", answer.message); return; }
        say("success", shared ? "已开启域内共享" : "已关闭域内共享");
      } catch (reason) {
        report(reason);
      }
    }

    const openClass = () => {
      navigate(`${CLASSES_PAGE}?type=${encodeURIComponent(TYPE)}`).catch(report);
    };

    const openPanel = (panelId) => {
      const state = JSON.stringify({ selected: { className: "platform:ProductPanel", primaryKey: panelId } });
      navigate(`${PANELS_PAGE}?${new globalThis.URLSearchParams({ state })}`).catch(report);
    };

    const refreshAll = () => instance.refreshObjects();


    return {
      selected, selectedKey, searchDraft, scope, sort, pageNumber, pageSize, nextCursor,
      list, rows, listStatusText, record, usedBy, usedPanels, hiddenCount, usedByCountText, current,
      dataRows, operationRows, inputRows, outputRows,
      copy, remove, grant, revoke, share, canGrant,
      mode, choose, startCreate, startEdit, onSaved, onDiscarded, nextPage, previousPage,
      setScope, setSort, setPageSize, copyDialog, copyForm, openCopy, submitCopy,
      deleteDialog, openDelete, submitDelete, grantForm, submitGrant, submitShare,
      openClass, openPanel, refreshAll, notice,
      componentLabel, scopeLabel, formatTime, jsonText, isChart,
    };
  },
});
