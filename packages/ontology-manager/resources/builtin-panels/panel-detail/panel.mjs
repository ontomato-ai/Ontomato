import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const PANEL_TYPE = "platform:ProductPanel";
const PROJECTION_TYPE = "platform:ProductProjection";
const APPLICATION_TYPE = "platform:Application";
const OBJECT_TYPE = "platform:ObjectType";
const SDK_COMPONENT_TYPE = "platform:SDKComponent";

const CATALOG_PATH = "/ontology/panels";
const PANEL_DETAIL_PATH = "/ontology/panels/detail";
const PROJECTIONS_PAGE = "/ontology/projections/detail";
const OPEN_EDIT_KEY_PREFIX = "ontomato:open-edit:builtin-product-ontology-panel-detail:";

const COPY_DIALOG_RESET = {
  copyDialog: null,
  copyId: null,
  copyName: null,
  copyTemplate: null,
};

const GRANT_DIALOG_RESET = {
  grantDialog: null,
  grantUser: null,
  grantRole: null,
  grantPrincipalId: null,
};

const PanelDetail = {
  setup() {
    const { instance, navigate, notify, t, confirmLeaveUnsaved } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const detailMode = computed(() => (values.value.detailMode === "edit" ? "edit" : "view"));

    const tabModel = computed({
      get: () => (typeof values.value.tab === "string" && values.value.tab ? values.value.tab : "overview"),
      set: (next) => state.set("tab", next || "overview"),
    });

    // Read-only projection outputs published by the selected panel header.
    const recordStatus = usePanelOutput("headerTitle", "status");
    const recordLabelOutput = usePanelOutput("headerTitle", "label");
    const recordErrorOutput = usePanelOutput("headerTitle", "errorMessage");
    const canEditOutput = usePanelOutput("headerTitle", "canEdit");
    const canGrantOutput = usePanelOutput("headerTitle", "canGrant");
    const canDeleteOutput = usePanelOutput("headerTitle", "canDelete");
    const isTemplateOutput = usePanelOutput("headerTitle", "isTemplate");
    const domainSharedOutput = usePanelOutput("headerTitle", "domainShared");
    const revisionOutput = usePanelOutput("headerTitle", "revision");
    const hiddenUsedByCountOutput = usePanelOutput("headerTitle", "hiddenUsedByCount");
    const unavailableOutput = usePanelOutput("headerTitle", "unavailable");

    const recordReady = computed(() => recordStatus.value === "ready");
    const recordUnavailable = computed(() => unavailableOutput.value === true);
    const recordLabel = computed(() =>
      typeof recordLabelOutput.value === "string" && recordLabelOutput.value ? recordLabelOutput.value : selectedKey.value,
    );
    const canEdit = computed(() => canEditOutput.value === true);
    const canGrant = computed(() => canGrantOutput.value === true);
    const canDelete = computed(() => canDeleteOutput.value === true);
    const isTemplate = computed(() => isTemplateOutput.value === true);
    const domainShared = computed(() => domainSharedOutput.value === true);
    const hiddenUsedByCount = computed(() =>
      typeof hiddenUsedByCountOutput.value === "number" ? hiddenUsedByCountOutput.value : 0,
    );
    const hasSelectedRevision = computed(() => typeof values.value.selectedRevision === "number");

    const recordErrorText = computed(() => {
      const message = typeof recordErrorOutput.value === "string" ? recordErrorOutput.value : "";
      return message || t("detail.missing");
    });

    const showEditForm = computed(
      () =>
        Boolean(selectedKey.value)
        && recordReady.value
        && !recordUnavailable.value
        && canEdit.value
        && detailMode.value === "edit",
    );

    const editDraft = usePanelFormDraft("form", {
      when: showEditForm,
    });

    // Keep selectedRevision synced for bound delete operation checks.
    watch(
      () => (recordReady.value && typeof revisionOutput.value === "number" ? revisionOutput.value : null),
      (revision) => {
        if ((values.value.selectedRevision ?? null) !== revision) {
          state.set("selectedRevision", revision);
        }
      },
      { immediate: true, flush: "sync" },
    );

    // Track one-time sessionStorage handoff set by the catalog's create dialog so newly created panels
    // open straight into full-width edit mode without persisting edit mode in the URL.
    const pendingOpenEditKey = ref("");
    const pendingAutoEdit = computed(
      () => Boolean(pendingOpenEditKey.value && pendingOpenEditKey.value === selectedKey.value),
    );

    function consumeOpenEditHint(key) {
      if (!key) {
        pendingOpenEditKey.value = "";
        return;
      }
      const storageKey = `${OPEN_EDIT_KEY_PREFIX}${key}`;
      let hit = false;
      try {
        if (sessionStorage.getItem(storageKey) !== null) {
          sessionStorage.removeItem(storageKey);
          hit = true;
        }
      } catch {
        // Ignore storage unavailability.
      }
      pendingOpenEditKey.value = hit ? key : "";
    }

    consumeOpenEditHint(selectedKey.value);

    watch(
      [selectedKey, recordStatus, recordReady, recordUnavailable, canEdit, pendingOpenEditKey],
      ([key, status, ready, unavailable, editable, pending]) => {
        if (!pending || pending !== key) return;
        if (ready) {
          pendingOpenEditKey.value = "";
          if (!unavailable && editable && detailMode.value !== "edit") {
            state.set("detailMode", "edit");
          }
        } else if (status === "error" || status === "forbidden" || status === "empty") {
          pendingOpenEditKey.value = "";
        }
      },
      { immediate: true, flush: "sync" },
    );

    // Mount the dynamic preview child panel only while viewing a ready, available panel on the Preview tab.
    const tabItems = computed(() => [
      { name: "overview", label: t("tab.overview") },
      { name: "source", label: t("tab.source") },
      { name: "members", label: t("tab.members") },
      { name: "usage", label: t("tab.usage") },
      ...(canGrant.value ? [{ name: "grants", label: t("tab.grants") }] : []),
      { name: "preview", label: t("tab.preview") },
    ]);

    const shouldMountPreview = computed(
      () =>
        !showEditForm.value
        && Boolean(selectedKey.value)
        && recordReady.value
        && !recordUnavailable.value
        && tabModel.value === "preview",
    );

    watch(
      () => (shouldMountPreview.value ? selected.value : null),
      (nextTarget) => {
        const current = values.value.previewTarget ?? null;
        if ((current?.primaryKey ?? null) !== (nextTarget?.primaryKey ?? null)) {
          state.set("previewTarget", nextTarget);
        }
      },
      { immediate: true },
    );

    // Leave the Grants tab when switching to a panel the reader cannot grant.
    watch([recordReady, canGrant, tabModel], ([ready, grantable, activeTab]) => {
      if (ready && !grantable && activeTab === "grants") {
        state.set("tab", "overview");
      }
    });

    // Unsaved-changes helpers when switching selected target while editing.
    function isFormDirty() {
      return Boolean(instance.forms.dirty("form"));
    }

    function discardForm() {
      if (!isFormDirty()) return;
      instance.forms.discard("form");
    }

    async function confirmLeaveForm() {
      if (!isFormDirty()) return true;
      if (confirmLeaveUnsaved) {
        const allowed = await confirmLeaveUnsaved();
        if (allowed) discardForm();
        return allowed;
      }
      return await instance.forms.reset("form", { confirm: true });
    }

    // Track header output updates to avoid prematurely clearing dialogs or edit mode while the next
    // selected panel's record is still loading.
    const headerOutputVersion = ref(0);
    let outputDeferredForKey = "";
    let lastSelectedPatched = new Set();

    watch(
      [
        recordStatus,
        recordLabelOutput,
        canEditOutput,
        canGrantOutput,
        canDeleteOutput,
        isTemplateOutput,
        domainSharedOutput,
        revisionOutput,
        unavailableOutput,
      ],
      () => {
        headerOutputVersion.value += 1;
        if (outputDeferredForKey && recordReady.value) {
          outputDeferredForKey = "";
        }
      },
    );

    watch(
      selectedKey,
      (nextKey, prevKey) => {
        lastSelectedPatched = new Set(state.lastPatchedKeys);
        if (prevKey && nextKey && nextKey !== prevKey) {
          if (
            lastSelectedPatched.has("copyDialog")
            || lastSelectedPatched.has("grantDialog")
            || lastSelectedPatched.has("detailMode")
          ) {
            outputDeferredForKey = nextKey;
          } else {
            outputDeferredForKey = "";
          }
        } else if (nextKey !== prevKey) {
          outputDeferredForKey = "";
        }
      },
      { flush: "sync" },
    );

    let restoringSelection = false;
    watch(selectedKey, async (nextKey, prevKey) => {
      if (nextKey === prevKey || restoringSelection) return;
      const patched = lastSelectedPatched;

      if (detailMode.value === "edit" && isFormDirty()) {
        restoringSelection = true;
        try {
          const allowed = await confirmLeaveForm();
          if (!allowed) {
            state.set("selected", prevKey ? { className: PANEL_TYPE, primaryKey: prevKey } : null);
            await nextTick();
            return;
          }
        } finally {
          restoringSelection = false;
        }
      }

      consumeOpenEditHint(nextKey);

      const patch = {};
      if (!patched.has("detailMode") && detailMode.value !== "view") {
        patch.detailMode = "view";
      }
      if (!patched.has("sourceFile") && values.value.sourceFile !== null) {
        patch.sourceFile = null;
      }
      if (!patched.has("memberProjection") && values.value.memberProjection !== null) {
        patch.memberProjection = null;
      }
      if (
        !patched.has("copyDialog")
        && (values.value.copyDialog === true || values.value.copyId || values.value.copyName || values.value.copyTemplate !== null)
      ) {
        Object.assign(patch, COPY_DIALOG_RESET);
      }
      if (
        !patched.has("grantDialog")
        && (values.value.grantDialog === true || values.value.grantUser || values.value.grantRole || values.value.grantPrincipalId)
      ) {
        Object.assign(patch, GRANT_DIALOG_RESET);
      }
      if (Object.keys(patch).length > 0) {
        state.setState(patch);
      }
    });

    // Reset detailMode back to view if an unauthorized/unavailable panel cannot be edited.
    watch(
      [selectedKey, recordReady, recordUnavailable, canEdit, detailMode, headerOutputVersion],
      ([key, ready, unavailable, editable, mode]) => {
        if (mode !== "edit") return;
        if (!key) {
          state.set("detailMode", "view");
          return;
        }
        if (ready && outputDeferredForKey !== key && (unavailable || !editable)) {
          state.set("detailMode", "view");
        }
      },
    );

    // In-form candidate projection/panel picker and visual member layout organizer (PN-05).
    const LAYOUT_MARKER_RE = /<!--\s*ontomato-layout:(\{[\s\S]*?\})\s*-->/;
    const memberKind = ref("projection");
    const memberSlotName = ref("");
    const memberAddZone = ref("main");
    const memberError = ref("");
    const memberKindOptions = computed(() => [
      { value: "projection", label: t("members.projection") },
      { value: "panel", label: t("members.panel") },
    ]);
    const layoutModeOptions = computed(() => [
      { value: "main-side", label: t("layout.modeMainSide") },
      { value: "grid", label: t("layout.modeGrid") },
    ]);
    const layoutConfig = reactive({
      mode: "main-side",
      columns: 2,
      sideWidth: "320px",
      gap: 16,
      zones: {},
      spans: {},
    });

    const memberForm = computed(() => (showEditForm.value ? instance.forms.handle("form") : null));
    const canPickMembers = computed(() => {
      const formHandle = memberForm.value;
      if (!formHandle) return false;
      const membersField = formHandle.fields.value.find((field) => field.path === "/manifest/members");
      return Boolean(membersField && !membersField.readOnly);
    });
    const currentHtmlText = computed(() => {
      const raw = memberForm.value?.values.value?.content?.html;
      return typeof raw === "string" ? raw : "";
    });
    const isLayoutManagedHtml = computed(() => LAYOUT_MARKER_RE.test(currentHtmlText.value));

    function parseLayoutFromHtml(html) {
      const match = LAYOUT_MARKER_RE.exec(html);
      if (!match) return;
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.mode === "grid" || parsed.mode === "main-side") layoutConfig.mode = parsed.mode;
        if (typeof parsed.columns === "number" && parsed.columns >= 1 && parsed.columns <= 4) layoutConfig.columns = parsed.columns;
        if (typeof parsed.sideWidth === "string" && parsed.sideWidth) layoutConfig.sideWidth = parsed.sideWidth;
        if (typeof parsed.gap === "number" && parsed.gap >= 0 && parsed.gap <= 48) layoutConfig.gap = parsed.gap;
        if (parsed.zones && typeof parsed.zones === "object") layoutConfig.zones = { ...parsed.zones };
        if (parsed.spans && typeof parsed.spans === "object") layoutConfig.spans = { ...parsed.spans };
      } catch {
        // Ignore malformed layout marker and preserve existing defaults.
      }
    }

    watch(
      [showEditForm, selectedKey],
      ([active]) => {
        if (active) parseLayoutFromHtml(currentHtmlText.value);
      },
      { immediate: true },
    );

    const editableMemberItems = computed(() => {
      const raw = memberForm.value?.values.value?.manifest?.members;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      return Object.entries(raw).map(([slot, entry], index) => {
        const target = entry && typeof entry === "object" ? entry.target : null;
        let targetText = "—";
        if (target && typeof target === "object") {
          if ("projectionId" in target) targetText = `${t("members.projection")} · ${target.projectionId}`;
          else if ("panelId" in target) targetText = `${t("members.panel")} · ${target.panelId}`;
          else if ("fromState" in target) targetText = `state:${target.fromState}`;
          else if ("fromPlatform" in target) targetText = "platform";
        }
        const zone = layoutConfig.zones[slot] === "side" ? "side" : "main";
        const span = typeof layoutConfig.spans[slot] === "number" && layoutConfig.spans[slot] >= 1 ? layoutConfig.spans[slot] : 1;
        return { slot, index, targetText, zone, span };
      });
    });
    const mainZoneMembers = computed(() => editableMemberItems.value.filter((item) => item.zone !== "side"));
    const sideZoneMembers = computed(() => editableMemberItems.value.filter((item) => item.zone === "side"));
    const layoutPreviewStyle = computed(() =>
      layoutConfig.mode === "main-side"
        ? {
            gridTemplateColumns: `minmax(0, 1fr) ${layoutConfig.sideWidth}`,
            gap: `${layoutConfig.gap}px`,
          }
        : {
            gridTemplateColumns: `repeat(${layoutConfig.columns}, minmax(0, 1fr))`,
            gap: `${layoutConfig.gap}px`,
          },
    );

    function escapeSlotAttr(slot) {
      return String(slot).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function renderManagedLayoutHtml(items) {
      const meta = {
        mode: layoutConfig.mode,
        columns: layoutConfig.columns,
        sideWidth: layoutConfig.sideWidth,
        gap: layoutConfig.gap,
        zones: Object.fromEntries(items.map((item) => [item.slot, item.zone])),
        spans: Object.fromEntries(items.map((item) => [item.slot, item.span])),
      };
      const marker = `<!-- ontomato-layout:${JSON.stringify(meta)} -->`;
      if (layoutConfig.mode === "main-side") {
        const mainSlots = items.filter((item) => item.zone !== "side")
          .map((item) => `      <projection slot="${escapeSlotAttr(item.slot)}"></projection>`)
          .join("\n");
        const sideSlots = items.filter((item) => item.zone === "side")
          .map((item) => `      <projection slot="${escapeSlotAttr(item.slot)}"></projection>`)
          .join("\n");
        return `${marker}
<style>
  .panel-layout { display: grid; grid-template-columns: minmax(0, 1fr) ${layoutConfig.sideWidth}; gap: ${layoutConfig.gap}px; padding: var(--spacing-md); }
  .panel-zone { display: flex; flex-direction: column; gap: ${layoutConfig.gap}px; min-width: 0; }
  @media (max-width: 760px) { .panel-layout { grid-template-columns: minmax(0, 1fr); } }
</style>
<div id="app" v-cloak>
  <section class="panel-layout">
    <main class="panel-zone">
${mainSlots}
    </main>
    <aside class="panel-zone">
${sideSlots}
    </aside>
  </section>
</div>`;
      }
      const gridItems = items
        .map((item) => {
          const span = Math.min(item.span, layoutConfig.columns);
          const styleAttr = span > 1 ? ` style="grid-column: span ${span};"` : "";
          return `    <div class="panel-grid-cell"${styleAttr}><projection slot="${escapeSlotAttr(item.slot)}"></projection></div>`;
        })
        .join("\n");
      return `${marker}
<style>
  .panel-grid { display: grid; grid-template-columns: repeat(${layoutConfig.columns}, minmax(0, 1fr)); gap: ${layoutConfig.gap}px; padding: var(--spacing-md); }
  .panel-grid-cell { min-width: 0; }
  @media (max-width: 760px) { .panel-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
<div id="app" v-cloak>
  <section class="panel-grid">
${gridItems}
  </section>
</div>`;
    }

    function syncHtmlIfManaged(nextMembers) {
      const formHandle = memberForm.value;
      if (!formHandle || !isLayoutManagedHtml.value) return;
      const items = Object.keys(nextMembers).map((slot) => ({
        slot,
        zone: layoutConfig.zones[slot] === "side" ? "side" : "main",
        span: typeof layoutConfig.spans[slot] === "number" && layoutConfig.spans[slot] >= 1 ? layoutConfig.spans[slot] : 1,
      }));
      formHandle.set("/content/html", renderManagedLayoutHtml(items));
    }

    function applyVisualLayoutToHtml() {
      const formHandle = memberForm.value;
      if (!formHandle || !canPickMembers.value) return;
      formHandle.set("/content/html", renderManagedLayoutHtml(editableMemberItems.value));
      notify({ kind: "success", text: t("layout.applied") });
    }

    function onLayoutSettingChanged() {
      const raw = memberForm.value?.values.value?.manifest?.members;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        syncHtmlIfManaged(raw);
      }
    }

    function moveDraftMember(slot, delta) {
      const formHandle = memberForm.value;
      if (!formHandle || !canPickMembers.value) return;
      const raw = formHandle.values.value?.manifest?.members;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const entries = Object.entries(raw);
      const index = entries.findIndex(([key]) => key === slot);
      const targetIndex = index + delta;
      if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return;
      const [moved] = entries.splice(index, 1);
      entries.splice(targetIndex, 0, moved);
      const nextMembers = Object.fromEntries(entries);
      formHandle.set("/manifest/members", nextMembers);
      syncHtmlIfManaged(nextMembers);
    }

    function removeDraftMember(slot) {
      const formHandle = memberForm.value;
      if (!formHandle || !canPickMembers.value) return;
      const raw = formHandle.values.value?.manifest?.members;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const nextMembers = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== slot));
      delete layoutConfig.zones[slot];
      delete layoutConfig.spans[slot];
      formHandle.set("/manifest/members", nextMembers);
      syncHtmlIfManaged(nextMembers);
    }

    function toggleMemberZone(slot) {
      layoutConfig.zones = {
        ...layoutConfig.zones,
        [slot]: layoutConfig.zones[slot] === "side" ? "main" : "side",
      };
      onLayoutSettingChanged();
    }

    function setMemberSpan(slot, span) {
      layoutConfig.spans = {
        ...layoutConfig.spans,
        [slot]: Number(span) || 1,
      };
      onLayoutSettingChanged();
    }
    const pickedProjectionLabel = usePanelOutput("memberProjectionPicker", "selectedLabel");
    const pickedPanelLabel = usePanelOutput("memberPanelPicker", "selectedLabel");
    const pickedMemberId = computed(() =>
      memberKind.value === "panel"
        ? (values.value.memberPickPanel?.primaryKey ?? "")
        : (values.value.memberPickProjection?.primaryKey ?? ""),
    );
    const pickedMemberLabel = computed(() => {
      const label = memberKind.value === "panel" ? pickedPanelLabel.value : pickedProjectionLabel.value;
      return typeof label === "string" && label ? label : pickedMemberId.value;
    });
    const canAddPickedMember = computed(() =>
      Boolean(canPickMembers.value && pickedMemberId.value && memberSlotName.value.trim()),
    );

    watch(showEditForm, (active) => {
      if (active) return;
      memberSlotName.value = "";
      memberError.value = "";
      if (values.value.memberPickProjection || values.value.memberPickPanel) {
        state.setState({ memberPickProjection: null, memberPickPanel: null });
      }
    });

    watch(memberKind, () => {
      memberError.value = "";
    });

    function addPickedMember() {
      const formHandle = memberForm.value;
      if (!formHandle || !canPickMembers.value) return;
      const slotName = memberSlotName.value.trim();
      const candidateId = pickedMemberId.value;
      if (!slotName || !candidateId) return;
      if (memberKind.value === "panel" && selectedKey.value && candidateId === selectedKey.value) {
        memberError.value = t("members.cannotEmbedSelf");
        return;
      }
      const rawMembers = formHandle.values.value?.manifest?.members;
      const current = rawMembers && typeof rawMembers === "object" && !Array.isArray(rawMembers) ? rawMembers : {};
      if (Object.hasOwn(current, slotName)) {
        memberError.value = t("members.keyExists");
        return;
      }
      const target = memberKind.value === "panel" ? { panelId: candidateId } : { projectionId: candidateId };
      const nextMembers = { ...current, [slotName]: { target } };
      layoutConfig.zones = { ...layoutConfig.zones, [slotName]: memberAddZone.value === "side" ? "side" : "main" };
      formHandle.set("/manifest/members", nextMembers);
      syncHtmlIfManaged(nextMembers);
      memberSlotName.value = "";
      memberError.value = "";
      state.setState({ memberPickProjection: null, memberPickPanel: null });
      notify({ kind: "success", text: t("members.added", { slot: slotName }) });
    }

    // Inline projection summary inside the Members tab.
    const memberProjectionKey = computed(() => values.value.memberProjection?.primaryKey ?? "");

    function onChooseMemberRow(reference) {
      if (reference?.className === PROJECTION_TYPE && reference.primaryKey) {
        state.set("memberProjection", { className: PROJECTION_TYPE, primaryKey: reference.primaryKey });
      }
    }

    function clearMemberProjection() {
      state.set("memberProjection", null);
    }

    function openMemberProjection() {
      if (!memberProjectionKey.value) return;
      void openAddress(panelAddress(PROJECTIONS_PAGE, { selected: memberProjectionKey.value }));
    }

    // Delete operation bound through usePanelOperation so the header dropdown (for available panels),
    // the direct danger button (for unavailable panels), and agent page_action share the exact same
    // owner confirmation, inspectImpact check, dispatch, and post-delete navigation.
    async function onDeleteDone(outcome) {
      if (!outcome) return;
      if (outcome.kind !== "success") {
        if (outcome.message) {
          notify({ kind: "error", text: outcome.message });
        }
        return;
      }
      const deleted = Array.isArray(outcome.data?.deletedProjectionIds) ? outcome.data.deletedProjectionIds : [];
      const retained = Array.isArray(outcome.data?.retainedProjectionIdsWithoutEdit)
        ? outcome.data.retainedProjectionIdsWithoutEdit
        : [];
      let text = t("notify.deleted");
      if (deleted.length) text = t("notify.deletedWithProjections", { deleted: deleted.join(", ") });
      else if (retained.length) text = t("notify.deletedWithRetained", { retained: retained.join(", ") });
      notify({ kind: "success", text });
      state.setState({
        selected: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        selectedRevision: null,
        memberProjection: null,
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
      instance.refreshObjects();
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    const deletePanelOp = usePanelOperation("deletePanel", "delete", {
      available: () =>
        Boolean(selectedKey.value)
        && recordReady.value
        && !showEditForm.value
        && canDelete.value
        && hasSelectedRevision.value,
      onSettled: (answer) => {
        if (!answer || answer.decision !== "confirm") return;
        if (answer.response?.kind === "dispatched") {
          void onDeleteDone(answer.response.outcome);
        }
      },
      onError: (reason) => {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      },
    });

    const deleteDescriptor = computed(() =>
      deletePanelOp.state.value.status === "ready" ? (deletePanelOp.state.value.value?.delete ?? null) : null,
    );
    const canRunDelete = computed(
      () =>
        Boolean(selectedKey.value)
        && recordReady.value
        && !showEditForm.value
        && canDelete.value
        && hasSelectedRevision.value
        && Boolean(deleteDescriptor.value)
        && !deleteDescriptor.value.unavailable,
    );
    const deleteRunning = computed(() => deletePanelOp.running.value);

    function runDeletePanel() {
      if (!canRunDelete.value) return;
      void deletePanelOp.run();
    }

    // PN-04: Bound "Set as personal home" operation on the currently viewed available panel.
    const setAsHomeOp = usePanelOperation("setAsHome", "setAsHome", {
      available: () =>
        Boolean(selectedKey.value)
        && recordReady.value
        && !recordUnavailable.value
        && !showEditForm.value,
      onSettled: (answer) => {
        if (!answer || answer.decision !== "confirm") return;
        const outcome = answer.response?.kind === "dispatched" ? answer.response.outcome : null;
        if (outcome?.kind === "success") {
          notify({ kind: "success", text: outcome.message || t("action.setAsHomeDone") });
        } else if (outcome?.message) {
          notify({ kind: "error", text: outcome.message });
        }
      },
      onError: (reason) => {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      },
    });
    const setAsHomeDescriptor = computed(() =>
      setAsHomeOp.state.value.status === "ready" ? (setAsHomeOp.state.value.value?.setAsHome ?? null) : null,
    );
    const canSetAsHome = computed(
      () =>
        Boolean(selectedKey.value)
        && recordReady.value
        && !recordUnavailable.value
        && !showEditForm.value
        && Boolean(setAsHomeDescriptor.value)
        && !setAsHomeDescriptor.value.unavailable,
    );
    const setAsHomeRunning = computed(() => setAsHomeOp.running.value);

    function runSetAsHome() {
      if (!canSetAsHome.value) return;
      void setAsHomeOp.run();
    }

    // Copy / Save as template / Create from template dialog state aligned with detail entry conditions.
    const copyMode = computed(() => {
      const raw = values.value.copyMode;
      return raw === "saveAsTemplate" || raw === "fromTemplate" ? raw : "copy";
    });

    function canOpenCopyForMode(mode) {
      if (!selectedKey.value || showEditForm.value || !recordReady.value || recordUnavailable.value) return false;
      if (mode === "fromTemplate") return isTemplate.value;
      return canEdit.value;
    }

    const copyEntryAllowed = computed(() => canOpenCopyForMode(copyMode.value));
    const copyDialogOpen = computed({
      get: () => values.value.copyDialog === true && copyEntryAllowed.value,
      set: (open) => {
        if (!open) {
          state.setState(COPY_DIALOG_RESET);
        } else if (copyEntryAllowed.value) {
          state.set("copyDialog", true);
        }
      },
    });
    const copyIdModel = computed({
      get: () => (typeof values.value.copyId === "string" ? values.value.copyId : ""),
      set: (next) => state.set("copyId", next),
    });
    const copyNameModel = computed({
      get: () => (typeof values.value.copyName === "string" ? values.value.copyName : ""),
      set: (next) => state.set("copyName", next),
    });
    const canSubmitCopy = computed(
      () =>
        copyEntryAllowed.value
        && copyDialogOpen.value
        && Boolean(copyIdModel.value.trim())
        && Boolean(copyNameModel.value.trim()),
    );
    const copyDialogTitle = computed(() =>
      copyMode.value === "saveAsTemplate"
        ? t("copy.saveAsTemplateTitle")
        : copyMode.value === "fromTemplate"
          ? t("copy.fromTemplateTitle")
          : t("copy.title"),
    );
    const copyDialogNote = computed(() =>
      copyMode.value === "saveAsTemplate"
        ? t("copy.templateNote")
        : copyMode.value === "fromTemplate"
          ? t("copy.fromTemplateNote")
          : t("copy.note"),
    );
    const copyActionLabelKey = computed(() =>
      copyMode.value === "saveAsTemplate"
        ? "action.saveAsTemplate"
        : copyMode.value === "fromTemplate"
          ? "action.fromTemplate"
          : "action.copy",
    );

    watch(
      [recordReady, showEditForm, copyEntryAllowed, headerOutputVersion, () => values.value.copyDialog],
      ([ready, inEdit, allowed, , open]) => {
        if (open !== true || allowed) return;
        if (inEdit || !selectedKey.value) {
          outputDeferredForKey = "";
          state.setState(COPY_DIALOG_RESET);
          return;
        }
        if (ready && outputDeferredForKey !== selectedKey.value) {
          state.setState(COPY_DIALOG_RESET);
        }
      },
    );

    function openCopyDialog(mode) {
      if (!canOpenCopyForMode(mode)) return;
      const baseId = selectedKey.value;
      const baseName = recordLabel.value;
      const suggestedId = mode === "fromTemplate" ? `${baseId}-new` : `${baseId}-copy`;
      const suggestedName = mode === "saveAsTemplate"
        ? t("copy.defaultTemplateName", { name: baseName })
        : mode === "fromTemplate"
          ? t("copy.defaultDerivedName", { name: baseName })
          : t("copy.defaultName", { name: baseName });
      const templateValue = mode === "saveAsTemplate" ? true : mode === "fromTemplate" ? false : null;
      state.setState({
        copyMode: mode,
        copyId: suggestedId,
        copyName: suggestedName,
        copyTemplate: templateValue,
        copyDialog: true,
      });
    }

    function onCopyDone(outcome) {
      if (outcome?.kind !== "success") return;
      const createdId = typeof outcome.data?.id === "string" && outcome.data.id ? outcome.data.id : null;
      state.setState({
        ...COPY_DIALOG_RESET,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        memberProjection: null,
      });
      instance.refreshObjects();
      if (createdId) {
        notify({ kind: "success", text: t("notify.copied", { id: createdId }) });
        void openAddress(panelAddress(PANEL_DETAIL_PATH, { selected: createdId }));
      }
    }

    // Grant dialog state aligned with detail grant permission and readiness.
    const grantEntryAllowed = computed(
      () =>
        Boolean(selectedKey.value)
        && !showEditForm.value
        && recordReady.value
        && !recordUnavailable.value
        && canGrant.value,
    );
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
      get: () => (values.value.grantVerb === "edit" ? "edit" : "use"),
      set: (next) => state.set("grantVerb", next === "edit" ? "edit" : "use"),
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

    watch(
      [recordReady, showEditForm, grantEntryAllowed, headerOutputVersion, () => values.value.grantDialog],
      ([ready, inEdit, allowed, , open]) => {
        if (open !== true || allowed) return;
        if (inEdit || !selectedKey.value) {
          outputDeferredForKey = "";
          state.setState(GRANT_DIALOG_RESET);
          return;
        }
        if (ready && outputDeferredForKey !== selectedKey.value) {
          state.setState(GRANT_DIALOG_RESET);
        }
      },
    );

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
      instance.refreshObjects();
    }

    function onShareDone(outcome) {
      if (outcome?.kind !== "success") return;
      const skipped = Array.isArray(outcome.data?.skippedProjectionIds) ? outcome.data.skippedProjectionIds : [];
      if (skipped.length) {
        notify({ kind: "warning", text: t("grants.skipped", { ids: skipped.join(", ") }) });
      } else {
        notify({ kind: "success", text: t("grants.updated") });
      }
      instance.refreshObjects();
    }

    // Header More dropdown actions.
    const hasMoreNonDeleteActions = computed(() => canEdit.value || isTemplate.value || canGrant.value);
    const hasMoreActions = computed(() => hasMoreNonDeleteActions.value || canRunDelete.value);

    function onMoreCommand(command) {
      if (command === "copy" || command === "saveAsTemplate" || command === "fromTemplate") {
        openCopyDialog(command);
      } else if (command === "grants" && canGrant.value) {
        tabModel.value = "grants";
      } else if (command === "delete") {
        runDeletePanel();
      }
    }

    // Edit mode transitions.
    function startEdit() {
      if (!selectedKey.value || !recordReady.value || recordUnavailable.value || !canEdit.value) return;
      state.setState({
        detailMode: "edit",
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
    }

    function cancelEdit() {
      state.set("detailMode", "view");
    }

    function onSaved() {
      state.set("detailMode", "view");
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    // Wire Escape and Cancel while editing so unsaved changes pass through confirmLeaveUnsaved.
    const formBack = usePanelBack(showEditForm, cancelEdit, {
      pushHistory: false,
      forms: "form",
    });

    function cancelEditGuarded() {
      return formBack.back();
    }

    // PN-06: Unify Cancel and Discard into one guarded exit action without double confirmation.
    const headerDraft = computed(() => {
      const draft = editDraft.value;
      if (!draft) return null;
      return {
        ...draft,
        confirmDiscard: false,
        discard: () => cancelEditGuarded(),
      };
    });
    const headerDraftLabels = computed(() => ({
      discard: t("action.cancel"),
    }));

    // Route back to the catalog entry so the platform's unified unsaved-changes guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function openAddress(address) {
      if (!address) return;
      try {
        await navigate(address);
      } catch (reason) {
        notify({ kind: "error", text: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    function onNavigateReference(reference) {
      if (!reference?.primaryKey) return;
      if (reference.className === PANEL_TYPE) {
        void openAddress(panelAddress(PANEL_DETAIL_PATH, { selected: reference.primaryKey }));
      } else if (reference.className === PROJECTION_TYPE) {
        void openAddress(panelAddress(PROJECTIONS_PAGE, { selected: reference.primaryKey }));
      } else if (reference.className === APPLICATION_TYPE) {
        void openAddress(panelAddress("/ontology/applications/detail", { selected: reference.primaryKey }));
      } else if (reference.className === OBJECT_TYPE) {
        void openAddress(panelAddress("/ontology/objects", { selected: reference.primaryKey }));
      } else if (reference.className === SDK_COMPONENT_TYPE) {
        void openAddress(panelAddress("/ontology/components", { selected: reference.primaryKey }));
      }
    }

    function onUsedByRowAction({ id, ref }) {
      if (id === "openEntry" && ref?.primaryKey) {
        void openAddress(ref.primaryKey);
      }
    }

    return {
      t,
      selectedKey,
      tabModel,
      tabItems,
      recordStatus,
      recordReady,
      recordUnavailable,
      recordErrorText,
      canEdit,
      canGrant,
      canDelete,
      isTemplate,
      domainShared,
      hiddenUsedByCount,
      hasSelectedRevision,
      showEditForm,
      pendingAutoEdit,
      editDraft,
      headerDraft,
      headerDraftLabels,
      shouldMountPreview,
      canSetAsHome,
      setAsHomeRunning,
      runSetAsHome,
      canRunDelete,
      deleteRunning,
      runDeletePanel,
      hasMoreNonDeleteActions,
      hasMoreActions,
      onMoreCommand,
      memberKind,
      memberKindOptions,
      memberSlotName,
      memberAddZone,
      memberError,
      canPickMembers,
      layoutModeOptions,
      layoutConfig,
      isLayoutManagedHtml,
      editableMemberItems,
      mainZoneMembers,
      sideZoneMembers,
      layoutPreviewStyle,
      applyVisualLayoutToHtml,
      onLayoutSettingChanged,
      moveDraftMember,
      removeDraftMember,
      toggleMemberZone,
      setMemberSpan,
      pickedMemberId,
      pickedMemberLabel,
      canAddPickedMember,
      addPickedMember,
      memberProjectionKey,
      onChooseMemberRow,
      clearMemberProjection,
      openMemberProjection,
      copyEntryAllowed,
      copyDialogOpen,
      copyIdModel,
      copyNameModel,
      canSubmitCopy,
      copyDialogTitle,
      copyDialogNote,
      copyActionLabelKey,
      grantEntryAllowed,
      grantDialogOpen,
      grantPrincipalKindModel,
      grantVerbModel,
      grantPrincipalId,
      canSubmitGrant,
      grantKindOptions,
      openCopyDialog,
      onCopyDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
      startEdit,
      cancelEditGuarded,
      onSaved,
      goBack,
      openAddress,
      onNavigateReference,
      onUsedByRowAction,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(PanelDetail);
