import { computed, nextTick, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelBack,
  usePanelContext,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const PANEL_TYPE = "platform:ProductPanel";
const PROJECTION_TYPE = "platform:ProductProjection";
const APPLICATION_TYPE = "platform:Application";
const OBJECT_TYPE = "platform:ObjectType";
const SDK_COMPONENT_TYPE = "platform:SDKComponent";

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

const PanelsDirectory = {
  setup() {
    const { instance, navigate, notify, t, confirmLeaveUnsaved } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const formTarget = computed(() => values.value.formTarget ?? null);
    const formTargetKey = computed(() => formTarget.value?.primaryKey ?? "");
    const creating = computed(() => values.value.creating === true);
    const detailMode = computed(() => (values.value.detailMode === "edit" ? "edit" : "view"));

    // Synchronize formTarget on initial mount when opened directly into edit mode.
    if (!creating.value && detailMode.value === "edit" && selected.value && !formTarget.value) {
      state.set("formTarget", selected.value);
    }

    const isFormMode = computed(() => creating.value || (Boolean(formTargetKey.value) && detailMode.value === "edit"));
    const showDetail = computed(() => Boolean(selectedKey.value) || creating.value || isFormMode.value);

    const scopeModel = computed({
      get: () => (typeof values.value.scope === "string" && values.value.scope ? values.value.scope : "all"),
      set: (next) => state.set("scope", next || "all"),
    });
    const sortModel = computed({
      get: () => (typeof values.value.sort === "string" && values.value.sort ? values.value.sort : "updated"),
      set: (next) => state.set("sort", next || "updated"),
    });
    const templateFilterModel = computed({
      get: () => {
        if (values.value.templateFilter === true) return "template";
        if (values.value.templateFilter === false) return "ordinary";
        return "all";
      },
      set: (next) => {
        if (next === "template") state.set("templateFilter", true);
        else if (next === "ordinary") state.set("templateFilter", false);
        else state.set("templateFilter", null);
      },
    });

    const scopeOptions = computed(() => [
      { value: "all", label: t("scope.all") },
      { value: "mine", label: t("scope.mine") },
      { value: "shared", label: t("scope.shared") },
    ]);

    const tabModel = computed({
      get: () => (typeof values.value.tab === "string" && values.value.tab ? values.value.tab : "overview"),
      set: (next) => state.set("tab", next || "overview"),
    });

    // Read-only count published by the unavailable panels diagnostic list.
    const unavailableCountOutput = usePanelOutput("unavailableList", "loadedCount");
    const hasUnavailablePanels = computed(
      () => typeof unavailableCountOutput.value === "number" && unavailableCountOutput.value > 0,
    );

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

    // Keep selectedRevision synced for bound OperationButton deletion checks.
    watch(
      () => (recordReady.value && typeof revisionOutput.value === "number" ? revisionOutput.value : null),
      (revision) => {
        if ((values.value.selectedRevision ?? null) !== revision) {
          state.set("selectedRevision", revision);
        }
      },
      { immediate: true, flush: "sync" },
    );

    // Mount the dynamic preview child panel only while viewing a ready, available panel on the Preview tab.
    const shouldMountPreview = computed(
      () =>
        !isFormMode.value
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

    // Unsaved-changes guard helpers shared across row switching, create, cancel, and close.
    function isFormDirty() {
      return Boolean(instance.forms.dirty("form"));
    }

    let silentDiscard = false;
    function discardForm() {
      if (!isFormDirty()) return;
      silentDiscard = true;
      try {
        instance.forms.discard("form");
      } finally {
        silentDiscard = false;
      }
    }

    async function confirmLeaveForm() {
      if (!isFormDirty()) return true;
      if (confirmLeaveUnsaved) {
        const allowed = await confirmLeaveUnsaved();
        if (allowed) discardForm();
        return allowed;
      }
      silentDiscard = true;
      try {
        return await instance.forms.reset("form", { confirm: true });
      } finally {
        silentDiscard = false;
      }
    }

    // Capture the exact state keys touched when `selected` changes so we can tell an atomic
    // `present({ selected: B, detailMode: "edit" })` apart from a `selected`-only switch.
    let lastSelectedPatched = new Set();
    watch(
      selectedKey,
      (nextKey, prevKey) => {
        lastSelectedPatched = new Set(state.lastPatchedKeys);
        if (
          prevKey
          && nextKey
          && nextKey !== prevKey
          && (lastSelectedPatched.has("copyDialog") || lastSelectedPatched.has("grantDialog"))
        ) {
          dialogResetDeferredForKey = nextKey;
        } else if (nextKey !== prevKey) {
          dialogResetDeferredForKey = "";
        }
      },
      { flush: "sync" },
    );

    let handlingUserSelect = false;

    watch(selectedKey, async (nextKey, prevKey) => {
      if (nextKey === prevKey || handlingUserSelect) return;
      const patched = lastSelectedPatched;

      if (isFormMode.value && isFormDirty()) {
        handlingUserSelect = true;
        try {
          const allowed = await confirmLeaveForm();
          if (!allowed) {
            state.set("selected", creating.value ? null : formTarget.value);
            await nextTick();
            return;
          }
        } finally {
          handlingUserSelect = false;
        }
      }

      const patch = {};
      if (!patched.has("creating") && creating.value) {
        patch.creating = null;
      }
      if (!patched.has("detailMode") && detailMode.value !== "view") {
        patch.detailMode = "view";
      }
      if (!patched.has("sourceFile") && values.value.sourceFile !== null) {
        patch.sourceFile = null;
      }
      if (!patched.has("memberProjection") && values.value.memberProjection !== null) {
        patch.memberProjection = null;
      }
      if (!patched.has("copyDialog") && (values.value.copyDialog === true || values.value.copyId || values.value.copyName || values.value.copyTemplate !== null)) {
        Object.assign(patch, COPY_DIALOG_RESET);
      }
      if (!patched.has("grantDialog") && (values.value.grantDialog === true || values.value.grantUser || values.value.grantRole || values.value.grantPrincipalId)) {
        Object.assign(patch, GRANT_DIALOG_RESET);
      }

      const nextCreating = "creating" in patch ? patch.creating === true : creating.value;
      const nextDetailMode = "detailMode" in patch ? patch.detailMode : detailMode.value;
      const nextFormTarget = !nextCreating && nextDetailMode === "edit" && nextKey ? selected.value : null;
      if ((formTarget.value?.primaryKey ?? null) !== (nextFormTarget?.primaryKey ?? null)) {
        patch.formTarget = nextFormTarget;
      }

      if (Object.keys(patch).length > 0) {
        state.setState(patch);
      }
    });

    // Keep formTarget aligned when detailMode or creating changes without changing `selected`.
    watch([detailMode, creating], ([mode, isCreating]) => {
      if (handlingUserSelect) return;
      if (isCreating) {
        const patch = {};
        if (formTarget.value !== null) patch.formTarget = null;
        if (mode !== "view") patch.detailMode = "view";
        if (Object.keys(patch).length > 0) state.setState(patch);
        return;
      }
      if (mode === "edit") {
        if (selected.value && formTargetKey.value !== selectedKey.value) {
          state.set("formTarget", selected.value);
        }
        return;
      }
      if (formTarget.value !== null) {
        state.set("formTarget", null);
      }
    });

    // Reset per-panel view/dialog state when the reader chooses a panel from either list,
    // prompting before leaving unsaved edits in the form.
    async function onChoosePanel(nextRef) {
      if (!nextRef?.primaryKey || handlingUserSelect) return;
      handlingUserSelect = true;
      try {
        if (isFormMode.value && isFormDirty()) {
          const allowed = await confirmLeaveForm();
          if (!allowed) {
            state.set("selected", creating.value ? null : formTarget.value);
            await nextTick();
            return;
          }
        }
        state.setState({
          selected: { className: PANEL_TYPE, primaryKey: nextRef.primaryKey },
          formTarget: null,
          creating: null,
          detailMode: "view",
          sourceFile: null,
          memberProjection: null,
          ...COPY_DIALOG_RESET,
          ...GRANT_DIALOG_RESET,
        });
        await nextTick();
      } finally {
        handlingUserSelect = false;
      }
    }

    // In-form candidate projection/panel picker writing into /manifest/members on the live ObjectForm.
    const memberKind = ref("projection");
    const memberSlotName = ref("");
    const memberError = ref("");
    const memberKindOptions = computed(() => [
      { value: "projection", label: t("members.projection") },
      { value: "panel", label: t("members.panel") },
    ]);
    const memberForm = computed(() => instance.forms.handle("form"));
    const memberField = computed(() =>
      memberForm.value?.fields.value.find((field) => field.path === "/manifest/members"),
    );
    const canPickMembers = computed(() =>
      Boolean(isFormMode.value && memberField.value && !memberField.value.readOnly && !memberForm.value?.busy.value),
    );
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

    watch(isFormMode, (active) => {
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
      if (memberKind.value === "panel" && formTargetKey.value && candidateId === formTargetKey.value) {
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
      formHandle.set("/manifest/members", { ...current, [slotName]: { target } });
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
      void openAddress(panelAddress("/ontology/projections", { selected: memberProjectionKey.value }));
    }

    // Copy / Save as template / Create from template dialog state aligned with detail entry conditions.
    const copyMode = computed(() => {
      const raw = values.value.copyMode;
      return raw === "saveAsTemplate" || raw === "fromTemplate" ? raw : "copy";
    });

    function canOpenCopyForMode(mode) {
      if (!selectedKey.value || isFormMode.value || !recordReady.value || recordUnavailable.value) return false;
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

    const headerOutputVersion = ref(0);
    let dialogResetDeferredForKey = "";
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
        if (dialogResetDeferredForKey && recordReady.value) {
          dialogResetDeferredForKey = "";
        }
      },
    );

    watch(
      [recordReady, isFormMode, copyEntryAllowed, headerOutputVersion, () => values.value.copyDialog],
      ([ready, inForm, allowed, , open]) => {
        if (open !== true || allowed) return;
        if (inForm || !selectedKey.value) {
          dialogResetDeferredForKey = "";
          state.setState(COPY_DIALOG_RESET);
          return;
        }
        if (ready && dialogResetDeferredForKey !== selectedKey.value) {
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
      const nextSelected = createdId ? { className: PANEL_TYPE, primaryKey: createdId } : null;
      state.setState({
        ...COPY_DIALOG_RESET,
        formTarget: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        memberProjection: null,
        ...(nextSelected ? { selected: nextSelected } : {}),
      });
      instance.refreshObjects();
      if (createdId) {
        notify({ kind: "success", text: t("notify.copied", { id: createdId }) });
      }
    }

    // Grant dialog state aligned with detail grant permission and readiness.
    const grantEntryAllowed = computed(
      () =>
        Boolean(selectedKey.value)
        && !isFormMode.value
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
      [recordReady, isFormMode, grantEntryAllowed, headerOutputVersion, () => values.value.grantDialog],
      ([ready, inForm, allowed, , open]) => {
        if (open !== true || allowed) return;
        if (inForm || !selectedKey.value) {
          dialogResetDeferredForKey = "";
          state.setState(GRANT_DIALOG_RESET);
          return;
        }
        if (ready && dialogResetDeferredForKey !== selectedKey.value) {
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

    function onDeleteDone(outcome) {
      if (outcome?.kind !== "success") return;
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
        formTarget: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        selectedRevision: null,
        memberProjection: null,
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
      instance.refreshObjects();
    }

    async function startCreate() {
      if (isFormMode.value && isFormDirty()) {
        if (!(await confirmLeaveForm())) return;
      }
      state.setState({
        selected: null,
        formTarget: null,
        creating: true,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        memberProjection: null,
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
    }

    function startEdit() {
      if (!selectedKey.value || !recordReady.value || recordUnavailable.value || !canEdit.value) return;
      state.setState({
        formTarget: selected.value,
        creating: null,
        detailMode: "edit",
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
    }

    function cancelForm() {
      state.setState({ formTarget: null, creating: null, detailMode: "view" });
    }

    function onFormDiscarded() {
      if (silentDiscard) return;
      cancelForm();
    }

    async function closeDetail() {
      if (isFormMode.value && isFormDirty()) {
        if (!(await confirmLeaveForm())) return;
      }
      state.setState({
        selected: null,
        formTarget: null,
        creating: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        memberProjection: null,
        ...COPY_DIALOG_RESET,
        ...GRANT_DIALOG_RESET,
      });
    }

    function onSaved(saved) {
      const reference = saved?.primaryKey
        ? { className: saved.className || PANEL_TYPE, primaryKey: saved.primaryKey }
        : (formTarget.value ?? selected.value);
      state.setState({
        creating: null,
        formTarget: null,
        detailMode: "view",
        tab: "overview",
        sourceFile: null,
        memberProjection: null,
        ...(reference ? { selected: reference } : {}),
      });
      instance.refreshObjects();
      notify({ kind: "success", text: t("notify.saved") });
    }

    // Wire Escape / browser Back while editing or creating so unsaved changes pass through the host guard.
    const formBack = usePanelBack(isFormMode, cancelForm, {
      pushHistory: false,
      forms: "form",
    });

    function cancelFormGuarded() {
      void formBack.back();
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
        state.setState({
          selected: { className: PANEL_TYPE, primaryKey: reference.primaryKey },
          formTarget: null,
          creating: null,
          detailMode: "view",
          tab: "overview",
          sourceFile: null,
          memberProjection: null,
          ...COPY_DIALOG_RESET,
          ...GRANT_DIALOG_RESET,
        });
      } else if (reference.className === PROJECTION_TYPE) {
        void openAddress(panelAddress("/ontology/projections", { selected: reference.primaryKey }));
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
      formTargetKey,
      creating,
      isFormMode,
      showDetail,
      scopeModel,
      scopeOptions,
      sortModel,
      templateFilterModel,
      tabModel,
      hasUnavailablePanels,
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
      shouldMountPreview,
      memberKind,
      memberKindOptions,
      memberSlotName,
      memberError,
      canPickMembers,
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
      onDeleteDone,
      startCreate,
      startEdit,
      cancelForm,
      onFormDiscarded,
      cancelFormGuarded,
      closeDetail,
      onChoosePanel,
      onSaved,
      openAddress,
      onNavigateReference,
      onUsedByRowAction,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(PanelsDirectory);
