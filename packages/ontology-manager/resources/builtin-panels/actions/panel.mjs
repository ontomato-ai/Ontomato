import { computed, nextTick, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData, usePanelOperation } from "@ontomato/sdk/panel";

/*
 * The actions page: the catalog, an action's three detail parts (definition, derived definition, code explanation), the
 * batch status change and delete, all through this panel's declared state and the owner's declared reads and writes.
 *
 * This code keeps only the page's own concerns: the filter keyword, the selected action, the checked ones, the open tab,
 * the highlighted code segment, and putting the owner's results into words.
 * The list, record, form, definition and explanation reads, the status change and delete are the owner's, behind the
 * projections; nothing here requests an interface itself.
 *
 * There is no blank manual creation: the one ConversationEntry button opens this page's agent input; the agent writes
 * and trial-runs the code by the page skill, and once the owner adopts it drafts the result into the ObjectForm here for
 * the reader to check and save.
 */

const ACTION_TYPE = "platform:Action";

/** The derived effects grouped by kind as the original page did: create, update, delete, relations, vectors, other. */
const EFFECT_GROUPS = [
  { key: "create", label: "groupCreate", kinds: ["CREATE_OBJECT"] },
  { key: "update", label: "groupUpdate", kinds: ["UPDATE_OBJECT"] },
  { key: "delete", label: "groupDelete", kinds: ["DELETE_OBJECT"] },
  { key: "link", label: "groupLink", kinds: ["CREATE_EDGE", "DELETE_EDGE"] },
  { key: "vector", label: "groupVector", kinds: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"] },
  { key: "other", label: "groupOther", kinds: ["EXTERNAL_CALL"] },
];
const GROUP_OF_KIND = new Map(EFFECT_GROUPS.flatMap(group => group.kinds.map(kind => [kind, group.key])));

/** The colour each segment kind is drawn in, as the original page's explanation legend had them. */
const KIND_COLORS = {
  QUERY: "#1d4ed8", CREATE_OBJECT: "#047857", UPDATE_OBJECT: "#065f46", DELETE_OBJECT: "#b91c1c",
  CREATE_EDGE: "#4d7c0f", DELETE_EDGE: "#c2410c", APPEND_VECTOR: "#0e7490", UPDATE_VECTOR: "#155e75",
  DELETE_VECTOR: "#be123c", COMPUTE: "#6d28d9", EXTERNAL_CALL: "#b45309", BRANCH: "#a16207",
  LOOP: "#a16207", TRY_CATCH: "#7e22ce", ERROR_HANDLING: "#991b1b", CUSTOM: "#4b5563",
};

/** Nested code segments flattened with their depth; a branch's or a try's children follow their parent. */
function flattenSegments(list, depth, out) {
  for (const segment of Array.isArray(list) ? list : []) {
    if (!segment || !segment.codeRange) continue;
    out.push({ ...segment, depth, note: segment.narrative ?? "" });
    flattenSegments(segment.segs, depth + 1, out);
    flattenSegments(segment.trySegs, depth + 1, out);
    for (const arm of segment.branchArms ?? []) flattenSegments(arm.segs, depth + 1, out);
    for (const arm of segment.catchs ?? []) flattenSegments(arm.segs, depth + 1, out);
  }
  return out;
}

function json(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const ActionsCatalog = {
  setup() {
    const { instance, t: text } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? null);
    const checked = computed(() => (Array.isArray(values.value.checked) ? values.value.checked : []));

    /** The filter keyword lives in panel state, so the address carries it and the agent reads it. */
    const keywordModel = computed({
      get: () => values.value.keyword ?? "",
      set: (value) => instance.state.set("keyword", typeof value === "string" ? value : ""),
    });

    const rowsRead = usePanelData("catalog", "rows");
    const recordRead = usePanelData("record", "record");
    const definitionRead = usePanelData("definition", "definition");
    const explanationRead = usePanelData("explanation", "explanation");
    const optionsRead = usePanelData("statusOptions", "form");

    const rows = computed(() => (rowsRead.value.status === "ready" ? rowsRead.value.value ?? [] : []));
    const visibleRows = computed(() => {
      const keyword = (values.value.keyword ?? "").trim().toLowerCase();
      if (!keyword) return rows.value;
      return rows.value.filter((row) =>
        `${row.label ?? ""} ${row.subtitle ?? ""}`.toLowerCase().includes(keyword));
    });

    /** The three statuses of the owner's own form: their values and names come from the owner, not from this page. */
    const statusOptions = computed(() => {
      if (optionsRead.value.status !== "ready") return [];
      const field = (optionsRead.value.value?.fields ?? []).find((item) => item.path === "/status");
      return field && field.control && field.control.kind === "select" ? field.control.options ?? [] : [];
    });
    const statusValueOfLabel = computed(() => new Map(statusOptions.value.map((option) => [option.label, option.value])));

    function statusTagType(row) {
      const value = statusValueOfLabel.value.get(row?.fields?.status);
      if (value === "PUBLISHED") return "success";
      if (value === "PENDING_REVIEW") return "warning";
      if (value === "UNUSED") return "info";
      return undefined;
    }

    function columnLabel(name) {
      const row = rows.value[0];
      return row?.fieldLabels?.[name] || text(name);
    }

    function formatTime(value) {
      if (!value) return "";
      const time = new Date(value);
      if (Number.isNaN(time.getTime())) return value;
      const pad = (part) => String(part).padStart(2, "0");
      return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
    }

    function isChecked(row) {
      return checked.value.some((ref) => ref.primaryKey === row.primaryKey);
    }
    function setChecked(list) {
      instance.state.set("checked", list.map((primaryKey) => ({ className: ACTION_TYPE, primaryKey })));
    }
    function toggleChecked(row) {
      const keys = new Set(checked.value.map((ref) => ref.primaryKey));
      if (keys.has(row.primaryKey)) keys.delete(row.primaryKey);
      else keys.add(row.primaryKey);
      setChecked([...keys]);
    }
    const allChecked = computed(() => visibleRows.value.length > 0 && visibleRows.value.every(isChecked));
    function toggleAll() {
      if (allChecked.value) {
        const visible = new Set(visibleRows.value.map((row) => row.primaryKey));
        setChecked(checked.value.map((ref) => ref.primaryKey).filter((key) => !visible.has(key)));
        return;
      }
      const keys = new Set(checked.value.map((ref) => ref.primaryKey));
      for (const row of visibleRows.value) keys.add(row.primaryKey);
      setChecked([...keys]);
    }
    function clearChecked() {
      instance.state.set("checked", []);
    }

    // ---- Details ----

    const tabs = [
      { key: "definition", label: "definition" },
      { key: "derived", label: "derived" },
      { key: "code", label: "code" },
    ];
    const activeTab = ref("definition");
    /** An agent's draft opens the definition form as it arrives, a new action's draft too (nothing is selected then). */
    const draftVisible = computed(() => instance.draft.value !== null);
    watch(instance.draft, (draft) => {
      if (draft) activeTab.value = "definition";
    }, { immediate: true });
    const detailVisible = computed(() => selected.value !== null || draftVisible.value);

    function selectRow(row) {
      instance.state.set("selected", { className: ACTION_TYPE, primaryKey: row.primaryKey });
      activeTab.value = "definition";
    }
    function back() {
      instance.state.set("selected", null);
      activeTab.value = "definition";
    }
    /*
     * A selected action the catalog no longer lists is gone (deleted here or elsewhere), so the page goes back to the
     * catalog as the original page did after a delete. Only a fresh catalog read decides it, never a change of selection:
     * a save that selects a new action brings the catalog read that lists it.
     */
    watch(() => rowsRead.value, (read) => {
      if (read.status !== "ready" && read.status !== "empty") return;
      const key = selectedKey.value;
      // The list read may be handed as rows, or as a page of them; a page that left some out cannot say the action is gone.
      const listed = read.status === "empty" ? [] : Array.isArray(read.value) ? read.value : read.value?.rows;
      if (!key || !Array.isArray(listed) || (read.value?.truncation && read.value.truncation.omitted > 0)) return;
      if (!listed.some((row) => row.primaryKey === key)) back();
    }, { immediate: true });

    const record = computed(() => (recordRead.value.status === "ready" ? recordRead.value.value : null));
    /** The selected catalog row: the owner's name, status and origin, shown until the record arrives instead of an id. */
    const selectedRow = computed(() => rows.value.find((row) => row.primaryKey === selectedKey.value) ?? null);
    const recordLabel = computed(() => record.value?.label || selectedRow.value?.label || selectedKey.value || "");
    const recordStatus = computed(() => record.value?.fields?.status || selectedRow.value?.fields?.status || "");
    const recordOrigin = computed(() => record.value?.fields?.origin || selectedRow.value?.fields?.origin || "");

    /**
     * The form's current values, only looked at: whether this is a system action (which has no delete) and whether its
     * code changed. The ObjectForm draws and saves the form itself; this code never writes it.
     */
    const formValues = computed(() => instance.forms.handle("form")?.values.value ?? null);
    const formCode = computed(() => {
      const fn = formValues.value?.function;
      return fn && typeof fn.code === "string" ? fn.code : undefined;
    });
    const systemAction = computed(() => formValues.value?.origin === "SYSTEM");

    // ---- Derived definition ----

    const definition = computed(() => (definitionRead.value.status === "ready" ? definitionRead.value.value : null));
    const declaredTarget = computed(() => definition.value?.declaredTarget ?? null);
    const affects = computed(() => definition.value?.affects ?? []);
    const parameters = computed(() => definition.value?.parameters ?? []);
    const conditions = computed(() => definition.value?.submissionCriteria?.conditions ?? []);
    /** How the owner joins its submission conditions; the page says it between the rows as the original page did. */
    const conditionJoin = computed(() => String(definition.value?.submissionCriteria?.operator ?? "").toUpperCase() === "OR"
      ? text("or") : text("and"));
    /** Checks the owner could not express as a condition, each with the reason it gave. */
    const customChecks = computed(() => (definition.value?.submissionCriteria?.unrepresentable ?? [])
      .filter((item) => item && (item.description || item.reason)));

    /**
     * A text split where parameter names occur, so a reader can click one and be taken to the parameter table: the
     * derived assignments and conditions name parameters by name alone. Longest name first, so a name never splits
     * inside a longer one.
     */
    const parameterPattern = computed(() => {
      const names = parameters.value.map((parameter) => parameter.name).filter(Boolean)
        .sort((left, right) => right.length - left.length)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return names.length ? new RegExp(`\\b(${names.join("|")})\\b`, "g") : null;
    });
    function textParts(value) {
      const whole = typeof value === "string" ? value : json(value);
      const pattern = parameterPattern.value;
      if (!pattern || !whole) return [{ text: whole, parameter: null }];
      const parts = [];
      let last = 0;
      pattern.lastIndex = 0;
      for (const match of whole.matchAll(pattern)) {
        if (match.index > last) parts.push({ text: whole.slice(last, match.index), parameter: null });
        parts.push({ text: match[0], parameter: match[0] });
        last = match.index + match[0].length;
      }
      if (last < whole.length) parts.push({ text: whole.slice(last), parameter: null });
      return parts;
    }
    /** Takes the reader to the parameter's row and marks it for a moment, as the original page did. */
    function locateParameter(name) {
      const row = typeof document === "undefined" ? null : document.querySelector(`[data-parameter-row="${name}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("is-hit");
      window.setTimeout(() => row.classList.remove("is-hit"), 1400);
    }
    const effectGroups = computed(() => {
      const buckets = new Map();
      for (const effect of definition.value?.effects ?? []) {
        const key = GROUP_OF_KIND.get(effect.kind) ?? "other";
        const bucket = buckets.get(key) ?? [];
        bucket.push(effect);
        buckets.set(key, bucket);
      }
      return EFFECT_GROUPS.filter((group) => (buckets.get(group.key) ?? []).length > 0)
        .map((group) => ({ ...group, items: buckets.get(group.key) }));
    });

    function effectLine(effect) {
      const parts = [];
      if (effect.sourceClass || effect.targetClass) parts.push(`${effect.sourceClass ?? "?"} → ${effect.targetClass ?? "?"}`);
      if (effect.objectIdFrom) parts.push(`${text("object")} ← ${effect.objectIdFrom}`);
      if (effect.sourceObjectIdFrom) parts.push(`← ${effect.sourceObjectIdFrom}`);
      if (effect.targetObjectIdFrom) parts.push(`→ ${effect.targetObjectIdFrom}`);
      if (effect.attrName) parts.push(effect.attrName);
      if (effect.textFrom) parts.push(`text ← ${effect.textFrom}`);
      if (effect.fileIdFrom) parts.push(`file ← ${effect.fileIdFrom}`);
      return parts.join(" · ");
    }
    const effectFields = (effect) => json(effect.assignments);
    const effectChecks = (effect) => json(effect.guards);
    function conditionText(condition) {
      const subject = [condition.className, condition.field].filter(Boolean).join(".");
      return [condition.objectParameter, subject, condition.operator, json(condition.value)].filter(Boolean).join(" ");
    }

    // ---- Code explanation ----

    const explanation = computed(() => (explanationRead.value.status === "ready" ? explanationRead.value.value : null));
    const segments = computed(() => flattenSegments(explanation.value?.codeSegments, 0, []));
    const codeLines = computed(() => {
      const code = explanation.value?.code ?? "";
      return code.split(/\r?\n/).map((line, index) => ({ number: index + 1, text: line }));
    });
    const hasExplanation = computed(() => codeLines.value.length > 0 || segments.value.length > 0);
    const meaning = computed(() => explanation.value?.businessMeaning ?? null);

    /** The form's code differs from the code the explanation was written for: the explanation is stale. */
    const explanationStale = computed(() =>
      formCode.value !== undefined && typeof explanation.value?.code === "string" && explanation.value.code !== formCode.value);

    /** The kinds this explanation uses, each once, in the order they first appear. */
    const presentKinds = computed(() => {
      const seen = new Map();
      for (const segment of segments.value) if (!seen.has(segment.kind)) seen.set(segment.kind, segment.kindLabel);
      return [...seen].map(([kind, label]) => ({ kind, label, color: KIND_COLORS[kind] ?? KIND_COLORS.CUSTOM }));
    });
    function kindColor(kind) {
      return KIND_COLORS[kind] ?? KIND_COLORS.CUSTOM;
    }

    /** Which segments the reader opened; a segment's detail is drawn only then. */
    const openSegments = ref({});
    function segmentOpen(segment) {
      return openSegments.value[segment.id] === true;
    }
    function toggleSegment(segment) {
      openSegments.value = { ...openSegments.value, [segment.id]: !segmentOpen(segment) };
    }

    /**
     * The structured content of one explained part, as the original page's segment details showed it: what it reads or
     * writes, its assignments and conditions, and where its object ids come from. Only what the segment carries.
     */
    function segmentDetails(segment) {
      const rows = [];
      const add = (label, value) => {
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return;
        rows.push({ label, text: typeof value === "string" ? value : json(value) });
      };
      add("segClass", segment.class);
      add("segSourceClass", segment.sourceClass);
      add("segTargetClass", segment.targetClass);
      add("relation", segment.relation);
      add("fields", (segment.assignments ?? []).map((item) => `${item.field} ← ${item.valueFrom}`).join(" · "));
      add("checks", segment.conditions);
      add("segObjectFrom", segment.objectIdFrom);
      add("segSourceFrom", segment.sourceObjectIdFrom);
      add("segTargetFrom", segment.targetObjectIdFrom);
      add("segTextFrom", segment.textFrom);
      add("segFileFrom", segment.fileIdFrom);
      const filters = segment.filters ?? null;
      const objects = Array.isArray(filters?.objects) ? filters.objects : [];
      if (objects.length) {
        add("segObjects", objects.map((object) => [object.alias, object.class].filter(Boolean).join(" · ")).join(" | "));
        for (const object of objects) {
          if (object.conditions) add("checks", [object.alias, json(object.conditions)].filter(Boolean).join(": "));
        }
      }
      const relations = Array.isArray(filters?.relationship) ? filters.relationship : [];
      if (relations.length) {
        add("relation", relations.map((item) => `${item.from} —${item.type}→ ${item.to}`).join(" | "));
      }
      const output = segment.output ?? null;
      if (output && Array.isArray(output.fields) && output.fields.length) {
        add("segOutputFields", output.fields.map((item) => (typeof item === "string" ? item : json(item))).join(" · "));
      }
      add("segGroupBy", output?.group_by);
      add("segSortBy", output?.sort);
      add("segLimit", output?.limit);
      return rows;
    }

    const activeSegmentId = ref(null);
    const activeSegment = computed(() => segments.value.find((segment) => segment.id === activeSegmentId.value) ?? null);
    const activeRange = computed(() => activeSegment.value?.codeRange ?? null);
    const codeBox = ref(null);

    /** A clicked code line selects the innermost explanation segment covering it. */
    function pickLine(number) {
      let best = null;
      for (const segment of segments.value) {
        const { start, end } = segment.codeRange;
        if (number < start || number > end) continue;
        if (!best || end - start < best.codeRange.end - best.codeRange.start) best = segment;
      }
      activeSegmentId.value = best?.id ?? null;
    }
    /** A clicked explanation segment scrolls its code into view. */
    function pickSegment(segment) {
      activeSegmentId.value = segment.id;
      void nextTick(() => {
        const box = codeBox.value;
        const line = box?.querySelector?.(`[data-line="${segment.codeRange.start}"]`);
        if (!box || !line) return;
        const boxRect = box.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        box.scrollTop += lineRect.top - boxRect.top - box.clientHeight / 3;
      });
    }

    // ---- Batch status change ----

    const statusHandle = usePanelOperation("status", "setStatus");
    const statusToSet = ref("");
    const statusRunning = ref(false);
    const statusResults = ref([]);
    const statusAdmitted = computed(() => statusHandle.operation.value !== null);
    const statusLabel = computed(() => statusHandle.operation.value?.label ?? text("applyStatus"));

    /** The owner answers each action on its own: success, refusal or failure, and the page says which for each. */
    function showStatus(answer) {
      if (!answer || answer.decision !== "confirm") return;
      const response = answer.response;
      if (response.kind === "not-dispatched") {
        statusResults.value = [{ key: "not-dispatched", name: "", ok: false, message: response.message }];
        return;
      }
      const outcome = response.outcome;
      if (!outcome) {
        statusResults.value = [{ key: "unknown", name: "", ok: false, message: text("unknownResult") }];
        return;
      }
      const items = outcome.kind === "batch" ? outcome.items : [];
      const nameOf = (primaryKey) => rows.value.find((row) => row.primaryKey === primaryKey)?.label ?? primaryKey;
      statusResults.value = items.map((item) => ({
        key: item.target.primaryKey,
        name: nameOf(item.target.primaryKey),
        ok: item.outcome.kind === "success",
        message: item.outcome.kind === "success" ? (item.outcome.message ?? text("runDone")) : item.outcome.message,
      }));
      // The ones the owner changed are unchecked; the rest stay checked so the reader can try them again.
      const changed = new Set(items.filter((item) => item.outcome.kind === "success").map((item) => item.target.primaryKey));
      instance.state.set("checked", checked.value.filter((ref) => !changed.has(ref.primaryKey)));
    }

    async function applyStatus() {
      if (!statusToSet.value) return;
      statusRunning.value = true;
      statusResults.value = [];
      try {
        showStatus(await statusHandle.run({ status: statusToSet.value }));
      } catch (reason) {
        statusResults.value = [{
          key: "error",
          name: "",
          ok: false,
          message: reason instanceof Error ? reason.message : String(reason),
        }];
      } finally {
        statusRunning.value = false;
      }
    }

    return {
      tabs, activeTab, detailVisible, selected, selectedKey,
      keywordModel, rowsRead, visibleRows,
      checked, allChecked, isChecked, toggleChecked, toggleAll, clearChecked,
      statusOptions, statusToSet, statusRunning, statusResults, statusAdmitted, statusLabel, applyStatus,
      selectRow, back, statusTagType, columnLabel, formatTime,
      record, recordLabel, recordStatus, recordOrigin, systemAction,
      definitionRead, declaredTarget, affects, parameters, conditions, effectGroups,
      effectLine, effectFields, effectChecks, conditionText,
      conditionJoin, customChecks, textParts, locateParameter,
      explanationRead, explanationStale, hasExplanation, codeLines, segments, activeSegmentId, activeRange,
      pickLine, pickSegment, meaning, codeBox,
      presentKinds, kindColor, segmentOpen, toggleSegment, segmentDetails,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ActionsCatalog);
