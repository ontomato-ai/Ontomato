import { computed, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelData, usePanelOperation } from "@ontomato/sdk/panel";

/*
 * The panel directory. Every read and write is the panel owner's (`platform:ProductPanel`, `platform:User`,
 * `platform:ProductProjection`); this module only keeps the page's own view state — the keyword, the scope, the order,
 * the cursor of the page shown, which tab is open, and what the last write answered — and shapes what the declarations
 * already return.
 */

const PAGE_SIZE = 20;
const PANEL_TYPE = "platform:ProductPanel";

/** What one write answered, however the host wrapped it. */
function outcomeOf(result) {
  if (!result || typeof result !== "object") return { kind: "unknown" };
  if (result.decision === "cancel") return { kind: "cancel", message: "" };
  const response = result.response;
  if (!response) return { kind: "unknown" };
  if (response.kind === "not-dispatched") return { kind: "refused", message: response.message };
  const outcome = response.outcome;
  if (!outcome) return { kind: "dispatched" };
  if (outcome.kind === "success") return { kind: "success", data: outcome.data ?? {}, message: outcome.message ?? "" };
  if (outcome.kind === "batch") {
    const failed = (outcome.items ?? []).find(item => item.outcome.kind !== "success");
    return failed ? { kind: failed.outcome.kind, message: failed.outcome.message ?? "", data: {} } : { kind: "success", data: {}, message: "" };
  }
  return { kind: outcome.kind, message: outcome.message ?? "", data: {} };
}

function bindingText(bindings) {
  return Object.entries(bindings ?? {})
    .map(([name, value]) => {
      if (!value || typeof value !== "object") return `${name}: ${String(value)}`;
      if ("state" in value) return `${name}: state ${value.state}`;
      if ("literal" in value) return `${name}: ${JSON.stringify(value.literal)}`;
      if ("item" in value) return `${name}: row`;
      return name;
    })
    .join(" · ") || "—";
}

const PanelsDirectory = {
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const state = instance.state;

    const selected = computed(() => state.values.value.selected ?? null);
    const search = computed(() => (typeof state.values.value.search === "string" ? state.values.value.search : ""));
    const scope = computed(() => (typeof state.values.value.scope === "string" && state.values.value.scope ? state.values.value.scope : "all"));
    const sort = computed(() => (typeof state.values.value.sort === "string" && state.values.value.sort ? state.values.value.sort : "updated"));

    const mode = ref("view");
    const tab = ref("overview");
    const busy = ref(false);
    const failure = ref("");
    const message = ref("");
    const receipt = ref("");
    const templateFilter = ref("all");
    const searchText = ref(search.value);
    const deleteArmed = ref(false);

    // Paging: cursors the owner returned, one per page visited.
    const history = ref([null]);
    const cursorIndex = ref(0);
    const pageSize = ref(PAGE_SIZE);
    const page = computed(() => cursorIndex.value + 1);

    const rowsState = usePanelData("listRows", "rows", () => ({
      search: searchText.value,
      cursor: history.value[cursorIndex.value] ?? null,
      size: pageSize.value,
      ...(templateFilter.value === "template" ? { template: true }
        : templateFilter.value === "ordinary" ? { template: false } : {}),
    }));
    const rows = computed(() => (rowsState.value.status === "ready" ? rowsState.value.value.items ?? [] : []));
    const unavailableRows = computed(() => rowsState.value.status === "ready"
      ? rowsState.value.value.unavailableItems ?? [] : []);
    const ownerIdsExtra = ref([]);
    const ownerIds = computed(() => [...new Set([
      ...rows.value.map(row => row.ownerId),
      ...ownerIdsExtra.value,
    ].filter(Boolean))]);
    const ownersState = usePanelData("owners", "options", () => ({ values: ownerIds.value }));
    const recordState = usePanelData("detail", "record");
    const usedByState = usePanelData("detail", "usedBy");
    const membersState = usePanelData("detail", "members");
    const projectionState = usePanelData("projectionRecord", "record");
    const grantsState = usePanelData("grants", "grants");

    const copyOp = usePanelOperation("copyOp", "copy");
    const deleteOp = usePanelOperation("deleteOp", "delete");
    const grantOp = usePanelOperation("grantOp", "grant");
    const revokeOp = usePanelOperation("revokeOp", "revoke");
    const shareOp = usePanelOperation("shareOp", "share");

    const nextCursor = computed(() => (rowsState.value.status === "ready" ? rowsState.value.value.nextCursor ?? null : null));
    const loading = computed(() => rowsState.value.status === "loading");
    const rowsError = computed(() => (rowsState.value.status === "error" ? rowsState.value.message : ""));
    const visibleRows = computed(() => rows.value);

    const ownerLabels = computed(() => {
      const options = ownersState.value.status === "ready" ? ownersState.value.value.options ?? [] : [];
      return Object.fromEntries(options.map(option => [option.primaryKey, option.label]));
    });
    function ownerName(id) {
      return ownerLabels.value[id] ?? id ?? "—";
    }

    const record = computed(() => (recordState.value.status === "ready" ? recordState.value.value : null));
    watch(() => record.value?.ownerId, id => { if (id) ownerIdsExtra.value = [id]; });
    const usedBy = computed(() => (usedByState.value.status === "ready" ? usedByState.value.value : null));
    const members = computed(() => (membersState.value.status === "ready" ? membersState.value.value ?? {} : {}));
    const applicationEntries = computed(() => usedBy.value?.applicationEntries ?? []);
    const usingPanels = computed(() => usedBy.value?.panels ?? []);
    const classNames = computed(() => usedBy.value?.classNames ?? []);
    const hiddenCount = computed(() => usedBy.value?.hiddenCount ?? 0);

    const grantRows = computed(() => {
      const value = grantsState.value.status === "ready" ? grantsState.value.value : null;
      const recorded = Array.isArray(value) ? value : value?.grants ?? [];
      return recorded.map(grant => ({
        kind: grant.principalKind ?? "principal",
        principalId: grant.principalId ?? "",
        verb: grant.verb ?? "use",
        removable: (grant.principalKind ?? "") !== "domain",
      }));
    });
    const grantsShared = computed(() => {
      const value = grantsState.value.status === "ready" ? grantsState.value.value : null;
      if (value && typeof value === "object" && typeof value.shared === "boolean") return value.shared;
      return grantRows.value.some(grant => grant.kind === "domain");
    });
    const grantsError = computed(() => (grantsState.value.status === "error" ? grantsState.value.message : ""));
    function grantKindLabel(kind) {
      return kind === "role" ? t("grants.role") : kind === "domain" ? t("grants.domainMembers") : t("grants.principal");
    }
    function verbLabel(verb) {
      return verb === "edit" ? t("grants.edit") : t("grants.use");
    }

    const tabs = [
      { key: "overview", label: "tab.overview" },
      { key: "source", label: "tab.source" },
      { key: "members", label: "tab.members" },
      { key: "usage", label: "tab.usage" },
      { key: "grants", label: "tab.grants" },
      { key: "preview", label: "tab.preview" },
    ];

    function visibilityLabel(visibility) {
      return t(`visibility.${visibility}`);
    }
    function formatTime(value) {
      if (!value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }
    const messagesText = computed(() => {
      const messages = record.value?.content?.messages ?? {};
      return Object.keys(messages).length ? JSON.stringify(messages, null, 2) : t("source.none");
    });

    const memberRows = computed(() => Object.entries(members.value).map(([key, member]) => {
      const target = member?.target ?? {};
      const projectionId = "projectionId" in target ? target.projectionId : null;
      const panelId = "panelId" in target ? target.panelId : null;
      const candidates = "candidates" in target ? target.candidates : null;
      const label = projectionId ? "members.projection" : panelId ? "members.panel"
        : "fromState" in target ? "members.candidate" : "members.entry";
      const reference = projectionId ?? panelId
        ?? (candidates && "panelIds" in candidates ? candidates.panelIds.join(", ")
          : candidates && "rule" in candidates ? `${target.fromState}: ${candidates.rule}` : `${target.fromState ?? ""}`)
        ?? "—";
      return {
        key,
        targetLabel: label,
        projectionId,
        reference,
        inputs: bindingText(member?.inputs),
        outputs: bindingText(member?.outputs),
      };
    }));

    const projectionId = ref("");
    const projectionRecord = computed(() => (projectionState.value.status === "ready" ? projectionState.value.value : null));
    function inspectProjection(id) {
      projectionId.value = id;
      state.set("memberProjection", { className: "platform:ProductProjection", primaryKey: id });
    }

    function resetPaging() {
      history.value = [null];
      cursorIndex.value = 0;
    }
    function reload() {
      resetPaging();
      instance.refreshObjects();
    }
    function nextPage() {
      if (!nextCursor.value) return;
      const next = history.value.slice(0, cursorIndex.value + 1);
      next.push(nextCursor.value);
      history.value = next;
      cursorIndex.value = next.length - 1;
    }
    function previousPage() {
      if (cursorIndex.value > 0) cursorIndex.value -= 1;
    }

    let timer;
    function onSearchInput(event) {
      const text = event.target?.value ?? "";
      searchText.value = text;
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        state.set("search", text);
        resetPaging();
      }, 300);
    }
    function onScope(event) {
      state.set("scope", event.target?.value ?? "all");
      resetPaging();
    }
    function onSort(event) {
      state.set("sort", event.target?.value ?? "updated");
      resetPaging();
    }
    function onTemplateFilter(event) {
      templateFilter.value = event.target?.value ?? "all";
      resetPaging();
    }

    function clearNotices() {
      failure.value = "";
      message.value = "";
      receipt.value = "";
      deleteArmed.value = false;
    }
    function pick(row) {
      clearNotices();
      mode.value = "view";
      state.set("selected", { className: PANEL_TYPE, primaryKey: row.id });
    }
    function pickById(id) {
      clearNotices();
      mode.value = "view";
      state.set("selected", { className: PANEL_TYPE, primaryKey: id });
    }
    function startCreate() {
      clearNotices();
      state.set("selected", null);
      tab.value = "overview";
      mode.value = "create";
    }
    function startEdit() {
      clearNotices();
      mode.value = "edit";
    }
    function cancelMode() {
      mode.value = "view";
      clearNotices();
    }
    function startCopy() {
      clearNotices();
      draftId.value = record.value ? `${record.value.id}-copy` : "";
      draftName.value = record.value ? `${record.value.name} 副本` : "";
      mode.value = "copy";
    }
    function startSaveAsTemplate() {
      startCopy();
      mode.value = "saveAsTemplate";
    }
    const templateSource = computed(() => record.value);
    function startFromTemplate() {
      clearNotices();
      draftId.value = record.value ? `${record.value.id}-new` : "";
      draftName.value = record.value ? `${record.value.name} 派生` : "";
      mode.value = "fromTemplate";
    }

    const draftId = ref("");
    const draftName = ref("");

    async function copyPanel(asTemplate) {
      if (!record.value) return;
      busy.value = true;
      clearNotices();
      try {
        const outcome = outcomeOf(await copyOp.run({ id: draftId.value.trim(), name: draftName.value.trim() }));
        if (outcome.kind !== "success") {
          failure.value = outcome.message || String(outcome.kind);
          return;
        }
        const created = outcome.data.id ?? draftId.value.trim();
        if (asTemplate) {
          const marked = outcomeOf(await instance.writeOperation("form.save", {
            call: {
              target: { kind: "object", objectType: PANEL_TYPE, primaryKey: created },
              input: { values: { id: created, template: true }, revision: 1, submittedFields: ["/template"] },
            },
          }));
          if (marked.kind !== "success") failure.value = marked.message || String(marked.kind);
        }
        mode.value = "view";
        reload();
        pickById(created);
        message.value = `${t("grants.granted")} ${created}`;
      } catch (reason) {
        failure.value = reason instanceof Error ? reason.message : String(reason);
      } finally {
        busy.value = false;
      }
    }

    async function createFromTemplate() {
      const source = templateSource.value;
      if (!source) return;
      busy.value = true;
      clearNotices();
      try {
        const values = {
          id: draftId.value.trim(),
          name: draftName.value.trim(),
          description: source.description ?? "",
          visibility: "private",
          template: false,
          content: source.content,
          manifest: source.manifest,
          ...(source.theme ? { theme: source.theme } : {}),
        };
        const outcome = outcomeOf(await instance.writeOperation("form.save", {
          call: { target: { kind: "draft" }, input: { values } },
        }));
        if (outcome.kind !== "success") {
          failure.value = outcome.message || String(outcome.kind);
          return;
        }
        const created = outcome.data.id ?? values.id;
        mode.value = "view";
        reload();
        pickById(created);
        message.value = `${t("grants.granted")} ${created}`;
      } catch (reason) {
        failure.value = reason instanceof Error ? reason.message : String(reason);
      } finally {
        busy.value = false;
      }
    }

    function usageText() {
      const entries = applicationEntries.value.map(entry => entry.applicationName || entry.path);
      const panels = usingPanels.value.map(panel => panel.name);
      const classes = classNames.value;
      return [...entries, ...panels, ...classes].join(", ");
    }

    async function remove() {
      const current = record.value;
      if (!current) return;
      if (!deleteArmed.value) {
        deleteArmed.value = true;
        failure.value = "";
        message.value = `${t("delete.confirm")} ${usageText() ? t("delete.usage", { users: usageText() }) : ""}`;
        return;
      }
      deleteArmed.value = false;
      busy.value = true;
      clearNotices();
      try {
        const outcome = outcomeOf(await deleteOp.run({ revision: current.revision }));
        if (outcome.kind === "success") {
          const deleted = (outcome.data.deletedProjectionIds ?? []).join(", ") || t("delete.none");
          const retained = (outcome.data.retainedProjectionIdsWithoutEdit ?? []).join(", ");
          state.set("selected", null);
          reload();
          message.value = t("delete.done", { deleted }) + (retained ? ` · ${t("delete.retained", { ids: retained })}` : "");
        } else {
          const users = usageText();
          failure.value = `${outcome.message || String(outcome.kind)}${users ? ` · ${t("delete.usage", { users })}` : ""}`;
        }
      } catch (reason) {
        failure.value = reason instanceof Error ? reason.message : String(reason);
      } finally {
        busy.value = false;
      }
    }

    const grantKind = ref("role");
    const grantId = ref("");
    const grantVerb = ref("use");

    async function changeGrant(removeGrant) {
      if (!record.value) return;
      busy.value = true;
      clearNotices();
      try {
        const handle = removeGrant ? revokeOp : grantOp;
        const outcome = outcomeOf(await handle.run({
          principalKind: grantKind.value, principalId: grantId.value.trim(), verb: grantVerb.value,
        }));
        receipt.value = JSON.stringify(outcome, null, 2);
        if (outcome.kind !== "success") failure.value = outcome.message || String(outcome.kind);
        else instance.refreshObjects();
      } catch (reason) {
        failure.value = reason instanceof Error ? reason.message : String(reason);
      } finally {
        busy.value = false;
      }
    }

    function revokeGrant(grant) {
      grantKind.value = grant.kind === "role" ? "role" : "principal";
      grantId.value = grant.principalId;
      grantVerb.value = grant.verb;
      return changeGrant(true);
    }

    async function share(shared) {
      if (!record.value) return;
      busy.value = true;
      clearNotices();
      try {
        const outcome = outcomeOf(await shareOp.run({ shared }));
        const skipped = outcome.data.skippedProjectionIds ?? [];
        receipt.value = JSON.stringify(outcome, null, 2);
        if (outcome.kind !== "success") failure.value = outcome.message || String(outcome.kind);
        else if (skipped.length) message.value = t("grants.skipped", { ids: skipped.join(", ") });
        else message.value = t("grants.granted");
        if (outcome.kind === "success") instance.refreshObjects();
      } catch (reason) {
        failure.value = reason instanceof Error ? reason.message : String(reason);
      } finally {
        busy.value = false;
      }
    }

    function onSaved(saved) {
      const reference = saved && saved.primaryKey ? { className: saved.className || PANEL_TYPE, primaryKey: saved.primaryKey } : null;
      mode.value = "view";
      tab.value = "overview";
      reload();
      if (reference) state.set("selected", reference);
      message.value = `${t("grants.granted")} ${reference ? reference.primaryKey : ""}`.trim();
    }
    function onDiscarded() {
      mode.value = "view";
      clearNotices();
    }

    function openAddress(address) {
      void navigate(address).catch(() => undefined);
    }

    watch(instance.draft, draft => {
      if (draft) mode.value = "edit";
    }, { immediate: true });
    // What the reader chose decides the page; the notices belong to the last write, so they stay.
    watch(selected, () => {
      if (mode.value === "create") return;
      mode.value = "view";
      projectionId.value = "";
      deleteArmed.value = false;
    });

    return {
      t,
      selected, search: searchText, searchText, scope, sort,
      mode, tab, tabs, busy, failure, message, receipt,
      rows, visibleRows, unavailableRows, loading, rowsError, page, nextCursor,
      templateFilter, onTemplateFilter,
      grantRows, grantsShared, grantsError, grantKindLabel, verbLabel, revokeGrant,
      ownerName, visibilityLabel, formatTime, messagesText,
      memberRows, projectionId, projectionRecord, inspectProjection,
      record, recordState,
      applicationEntries, usingPanels, classNames, hiddenCount,
      onSearchInput, onScope, onSort,
      nextPage, previousPage, reload,
      onSaved, onDiscarded,
      pick, pickById, startCreate, startEdit, cancelMode, startCopy, startSaveAsTemplate, startFromTemplate,
      draftId, draftName, copyPanel, createFromTemplate, templateSource,
      remove, grantKind, grantId, grantVerb, changeGrant, share, openAddress,
    };
  },
};

await mountPanel(PanelsDirectory);
