import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DEFAULT_CATALOG_PATH = "/ontology/agents";

const LIGHT_AVATAR_COLORS = [
  "#F1EFFF",
  "#EEF7FF",
  "#EFFFF8",
  "#F4F7FE",
  "#FFF4FB",
  "#FFF6ED",
];

const DARK_AVATAR_COLORS = [
  "#2c2850",
  "#1d3047",
  "#173b35",
  "#252a42",
  "#40223b",
  "#42331d",
];

const AVATAR_ICON_KEYS = [
  "Brain",
  "Sparkles",
  "Activity",
  "BarChart3",
  "TrendingUp",
  "Target",
  "Database",
  "Wallet",
  "Users",
  "Settings",
  "MessageSquare",
];

const AVATAR_APP_ICON_KEYS = {
  Sparkles: "sparkles",
  Activity: "activity",
  BarChart3: "chart-column",
  Database: "database",
  Wallet: "wallet",
  Users: "users",
  Settings: "settings",
  MessageSquare: "message-square",
};

const DEFAULT_AVATAR = { key: "Brain", color: LIGHT_AVATAR_COLORS[0] };

const SECTION_KEYS = ["basics", "model", "prompt", "capabilities", "data", "sharing"];
const OWNER_SECTION_BY_KEY = {
  basics: "basics",
  model: "model",
  prompt: "prompt",
  capabilities: "capabilities",
  data: "data",
  sharing: "execution",
};

const GRANT_VERBS = new Set(["use", "view", "edit"]);
const GRANT_DIALOG_RESET = {
  grantDialog: null,
  grantPolicy: null,
  grantPolicyId: null,
};

function parseAgentAvatar(icon) {
  if (typeof icon !== "string" || !icon.trim()) return DEFAULT_AVATAR;
  try {
    const parsed = JSON.parse(icon);
    if (parsed && typeof parsed.key === "string" && typeof parsed.color === "string") {
      return { key: parsed.key, color: parsed.color };
    }
  } catch {
    // Fall back to the default avatar when an icon token is absent or malformed.
  }
  return DEFAULT_AVATAR;
}

function avatarColorIndex(color) {
  return Math.max(0, LIGHT_AVATAR_COLORS.indexOf(color), DARK_AVATAR_COLORS.indexOf(color));
}

function storedAgentAvatar(key, colorIndex) {
  const safeIndex = colorIndex >= 0 && colorIndex < LIGHT_AVATAR_COLORS.length ? colorIndex : 0;
  return JSON.stringify({ key, color: LIGHT_AVATAR_COLORS[safeIndex] });
}

function runtimeSkillKey(skill) {
  if (!skill || typeof skill !== "object" || !skill.namespace || typeof skill.name !== "string") return "";
  const ns = skill.namespace;
  return JSON.stringify([ns.kind, ns.kind === "provider" ? ns.provider : ns.domainId, skill.name]);
}

function runtimeSkillFromKey(key) {
  if (typeof key !== "string") return null;
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [kind, source, name] = parsed;
    if (typeof source !== "string" || typeof name !== "string") return null;
    if (kind === "provider") return { namespace: { kind, provider: source }, name };
    if (kind === "domain") return { namespace: { kind, domainId: source }, name };
  } catch {
    return null;
  }
  return null;
}

/*
 * Agent detail panel: full-width edit-on-open view for one platform:AgentDefinition.
 * - Opens via ?selected=<id> from either /ontology/agents/detail or /agents/settings/detail.
 * - Shows the owner's form as six left-navigated screens, keeps the header avatar and title synced
 *   with the live draft, and owns Save/Discard in the sticky save bar beneath the header.
 * - The prompt editor grows with its content up to 420px and its preview replaces it in place;
 *   skills and external tools use selected tables plus the shared PickerDialog backed by owner reads.
 * - Readers with `view` only see read-only fields. Editors with grant access manage audience,
 *   policy access, and the unattended execution identity on the sharing screen.
 */
await mountPanel({
  setup() {
    const panel = usePanelContext();
    const { instance, navigate, notify, t } = panel;
    const state = instance.state;
    const values = state.values;

    const catalogPath = computed(() => {
      const configured = values.value.catalogPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_CATALOG_PATH;
    });

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const activeSection = computed({
      get: () => {
        const raw = values.value.tab;
        if (SECTION_KEYS.includes(raw)) return raw;
        if (raw === "grants") return "sharing";
        return "basics";
      },
      set: (next) => state.set("tab", SECTION_KEYS.includes(next) ? next : "basics"),
    });
    const sections = computed(() => SECTION_KEYS.map((key) => ({
      key,
      label: t(`section.${key}`),
    })));
    const activeSectionLabel = computed(() => t(`section.${activeSection.value}`));
    const activeSectionHint = computed(() => t(`sectionHint.${activeSection.value}`));
    const enabledStatusOptions = computed(() => [
      { value: "enabled", label: t("form.statusEnabled") },
      { value: "disabled", label: t("form.statusDisabled") },
    ]);

    const isDark = ref(
      typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
    );
    let themeObserver = null;
    onMounted(() => {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
      const sync = () => {
        isDark.value = document.documentElement.classList.contains("dark");
      };
      sync();
      themeObserver = new MutationObserver(sync);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    });
    onBeforeUnmount(() => {
      themeObserver?.disconnect();
      themeObserver = null;
    });

    // Read-only projection outputs published by the selected agent header and form.
    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const agentCategory = usePanelOutput("header", "category");
    const canEditOutput = usePanelOutput("header", "canEdit");
    const canGrantOutput = usePanelOutput("header", "canGrant");
    const domainSharedOutput = usePanelOutput("header", "domainShared");
    const formDraftOutput = usePanelOutput("form", "draft");

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
      when: () => detailReady.value && canEdit.value,
    });

    const formHandle = computed(() => instance.forms.handle("form") ?? null);
    const dirtyItems = computed(() => {
      const handle = formHandle.value;
      if (!handle) return [];
      return [...handle.dirtyFields.value].map((path) => {
        const field = handle.fields.value.find((item) => item.path === path || path.startsWith(`${item.path}/`));
        const ownerSection = field?.section;
        const section = Object.entries(OWNER_SECTION_BY_KEY).find(([, owner]) => owner === ownerSection)?.[0] ?? "basics";
        return { path, section, label: field?.label ?? path.replace(/^\//, "") };
      });
    });
    const dirtyItemCount = computed(() => dirtyItems.value.length || (detailDraft.value?.dirty ? 1 : 0));
    const dirtyItemLabels = computed(() => dirtyItems.value.map((item) => item.label));
    const dirtySectionKeys = computed(() => [...new Set(dirtyItems.value.map((item) => item.section))]);

    function saveDraft() {
      detailDraft.value?.save?.();
    }

    function discardDraft() {
      detailDraft.value?.discard?.();
    }

    const activeSectionFields = computed(() => {
      const handle = formHandle.value;
      if (!handle) return [];
      const ownerSection = OWNER_SECTION_BY_KEY[activeSection.value];
      return handle.fields.value.filter((field) => field.section === ownerSection);
    });
    const activeSectionHasDefaults = computed(() =>
      activeSectionFields.value.some((field) => field.defaultValue !== undefined && !field.readOnly),
    );

    function resetActiveSectionDefaults() {
      const handle = formHandle.value;
      if (!handle) return;
      for (const field of activeSectionFields.value) {
        if (field.defaultValue === undefined || field.readOnly) continue;
        handle.set(field.path, JSON.parse(JSON.stringify(field.defaultValue)));
      }
    }

    const hasMemberContext = typeof instance.memberContext === "function";
    const headerRecordRef = shallowRef(null);
    const skillsMemberRef = shallowRef(null);
    const skillOptionsRef = shallowRef(null);
    const resolvedHeldSkills = shallowRef([]);
    const toolsMemberRef = shallowRef(null);
    const toolOptionsRef = shallowRef(null);
    const resolvedHeldTools = shallowRef([]);

    if (hasMemberContext) {
      let active = true;
      onBeforeUnmount(() => {
        active = false;
      });
      void instance.memberContext("header").then((member) => {
        if (!active) return;
        headerRecordRef.value = member.data.use("record");
      }).catch(() => undefined);
      void instance.memberContext("skills").then((member) => {
        if (!active) return;
        skillsMemberRef.value = member;
        skillOptionsRef.value = member.data.use("options");
      }).catch(() => undefined);
      void instance.memberContext("tools").then((member) => {
        if (!active) return;
        toolsMemberRef.value = member;
        toolOptionsRef.value = member.data.use("options");
      }).catch(() => undefined);
    }

    const liveDraftValues = computed(() => {
      const handle = instance.forms.handle("form");
      const current = handle?.values.value ?? formDraftOutput.value;
      return current && typeof current === "object" && !Array.isArray(current) ? current : null;
    });

    const savedHeaderIcon = computed(() => {
      const current = headerRecordRef.value?.value;
      if (current?.status !== "ready") return null;
      const icon = current.value?.fields?.icon;
      return typeof icon === "string" && icon.trim() ? icon : null;
    });

    const liveIcon = computed(() => {
      const draft = liveDraftValues.value;
      if (draft && Object.hasOwn(draft, "icon")) {
        return typeof draft.icon === "string" ? draft.icon : null;
      }
      return savedHeaderIcon.value;
    });

    const liveTitle = computed(() => {
      if (!detailReady.value) return undefined;
      const draftName = typeof liveDraftValues.value?.name === "string" ? liveDraftValues.value.name.trim() : "";
      return draftName || undefined;
    });

    const modelPickerKey = computed(() => {
      const engine = liveDraftValues.value?.engine;
      return `${selectedKey.value}:${typeof engine === "string" ? engine : ""}`;
    });

    // Data scope mode and its ObjectList synchronization. The form remains the only owner of `/classNames`.
    const classScopeMode = ref("graph");
    const classScopeModeOptions = computed(() => [
      { value: "graph", label: t("scope.modeGraph") },
      { value: "list", label: t("scope.modeList") },
    ]);

    // Prompt preview toggle (resets when switching agents).
    const promptPreview = ref(false);
    watch(selectedKey, () => {
      promptPreview.value = false;
      classScopeMode.value = "graph";
    });

    // Avatar & color helpers for both the live header avatar and the split-labeled /icon field.
    const avatarSwatches = computed(() => (isDark.value ? DARK_AVATAR_COLORS : LIGHT_AVATAR_COLORS));

    function avatarStyle(icon) {
      const idx = avatarColorIndex(parseAgentAvatar(icon).color);
      return { background: isDark.value ? DARK_AVATAR_COLORS[idx] : LIGHT_AVATAR_COLORS[idx] };
    }

    function avatarKeyOf(icon) {
      return parseAgentAvatar(icon).key;
    }

    function avatarSwatchIndexOf(icon) {
      return avatarColorIndex(parseAgentAvatar(icon).color);
    }

    function avatarAppIconByKey(key) {
      const mapped = AVATAR_APP_ICON_KEYS[key];
      return mapped ? appIcon(mapped) : null;
    }

    function avatarSvgKeyByKey(key) {
      if (key === "TrendingUp" || key === "Target") return key;
      return "Brain";
    }

    function selectAvatarKey(currentIcon, key, set) {
      const current = parseAgentAvatar(currentIcon);
      set(storedAgentAvatar(key, avatarColorIndex(current.color)));
    }

    function selectAvatarColor(currentIcon, swatchIndex, set) {
      const current = parseAgentAvatar(currentIcon);
      set(storedAgentAvatar(current.key, swatchIndex));
    }

    function selectedClassNames(value) {
      return Array.isArray(value) ? value.filter((name) => typeof name === "string") : [];
    }

    function removeClassName(value, name, set) {
      set(selectedClassNames(value).filter((item) => item !== name));
    }

    function clearClassNames(set) {
      set([]);
    }

    function classRefsFromNames(names) {
      return names.map((name) => ({ className: "platform:ObjectType", primaryKey: name }));
    }

    function classNamesOfRefs(refs) {
      return Array.isArray(refs)
        ? refs.flatMap((ref) => (ref && typeof ref.primaryKey === "string" ? [ref.primaryKey] : []))
        : [];
    }

    function sameStringList(left, right) {
      return left.length === right.length && left.every((item, index) => item === right[index]);
    }

    watch(
      () => JSON.stringify(selectedClassNames(liveDraftValues.value?.classNames)),
      () => {
        const names = selectedClassNames(liveDraftValues.value?.classNames);
        if (!sameStringList(names, classNamesOfRefs(values.value.classChecked))) {
          state.set("classChecked", classRefsFromNames(names));
        }
      },
      { immediate: true },
    );

    watch(
      () => values.value.classChecked,
      (refs) => {
        const handle = instance.forms.handle("form");
        if (!handle) return;
        const names = classNamesOfRefs(refs);
        const current = selectedClassNames(handle.values.value.classNames);
        if (sameStringList(names, current)) return;
        const classField = handle.fields.value.find((field) => field.path === "/classNames");
        if (!canEdit.value || classField?.readOnly) {
          state.set("classChecked", classRefsFromNames(current));
          return;
        }
        handle.set("/classNames", names);
      },
    );

    // Capability tables and shared picker dialogs. The owner form remains the only writer of both fields.
    const heldSkillRefs = computed(() => {
      const raw = liveDraftValues.value?.skills;
      return Array.isArray(raw) ? raw : [];
    });

    let skillResolveSeq = 0;
    watch(
      [skillsMemberRef, selectedKey, () => JSON.stringify(heldSkillRefs.value)],
      ([member]) => {
        const seq = ++skillResolveSeq;
        const held = heldSkillRefs.value;
        if (!member || held.length === 0) {
          resolvedHeldSkills.value = [];
          return;
        }
        void member.data.read("selected", { values: [...held] }).then((result) => {
          if (seq !== skillResolveSeq) return;
          if (result.status === "ready" && Array.isArray(result.value?.options)) {
            resolvedHeldSkills.value = result.value.options;
          }
        }).catch(() => undefined);
      },
      { immediate: true },
    );

    const skillOptionsState = computed(() => skillOptionsRef.value?.value ?? null);
    const skillsLoading = computed(() => !skillOptionsState.value || skillOptionsState.value.status === "loading");
    const skillsError = computed(() => {
      const current = skillOptionsState.value;
      if (!current || (current.status !== "error" && current.status !== "forbidden")) return "";
      const message = typeof current.message === "string" ? current.message.trim() : "";
      return message || t("skills.loadError");
    });
    const skillCatalogOptions = computed(() => {
      const current = skillOptionsState.value;
      return current?.status === "ready" && Array.isArray(current.value?.options)
        ? current.value.options
        : [];
    });
    const skillDiagnostics = computed(() => {
      const current = skillOptionsState.value;
      return current?.status === "ready" && Array.isArray(current.value?.diagnostics)
        ? current.value.diagnostics
        : [];
    });
    const skillOptionsByKey = computed(() => {
      const byKey = new Map();
      for (const option of skillCatalogOptions.value) byKey.set(option.primaryKey, option);
      for (const option of resolvedHeldSkills.value) byKey.set(option.primaryKey, option);
      return byKey;
    });

    function selectedSkillKeys(currentValue) {
      return (Array.isArray(currentValue) ? currentValue : [])
        .map((skill) => runtimeSkillKey(skill))
        .filter(Boolean);
    }

    function selectedSkillRows(currentValue) {
      return (Array.isArray(currentValue) ? currentValue : []).flatMap((skill) => {
        const key = runtimeSkillKey(skill);
        if (!key) return [];
        const option = skillOptionsByKey.value.get(key);
        return [{
          key,
          label: option?.label || skill.name || key,
          description: option?.description || "",
          unavailable: option?.unavailable ?? null,
        }];
      });
    }

    function removeSkill(currentValue, key, set) {
      set((Array.isArray(currentValue) ? currentValue : []).filter((skill) => runtimeSkillKey(skill) !== key));
    }

    function openSkillPicker(currentValue) {
      state.setState({
        skillPickerSelected: selectedSkillKeys(currentValue),
        skillPickerOpen: true,
      });
    }

    function onSkillPickerConfirm(keys) {
      const handle = formHandle.value;
      if (!handle) return;
      const byKey = skillOptionsByKey.value;
      const next = [];
      for (const key of Array.isArray(keys) ? keys : []) {
        const option = byKey.get(key);
        const value = option?.value ?? runtimeSkillFromKey(key);
        if (value) next.push(value);
      }
      handle.set("/skills", next);
    }

    const heldToolIds = computed(() => {
      const raw = liveDraftValues.value?.enabledMcpServiceIds;
      return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
    });

    let toolResolveSeq = 0;
    watch(
      [toolsMemberRef, selectedKey, () => JSON.stringify(heldToolIds.value)],
      ([member]) => {
        const seq = ++toolResolveSeq;
        const held = heldToolIds.value;
        if (!member || held.length === 0) {
          resolvedHeldTools.value = [];
          return;
        }
        void member.data.read("selected", { values: [...held] }).then((result) => {
          if (seq !== toolResolveSeq) return;
          if (result.status === "ready" && Array.isArray(result.value?.options)) {
            resolvedHeldTools.value = result.value.options;
          }
        }).catch(() => undefined);
      },
      { immediate: true },
    );

    const toolOptionsState = computed(() => toolOptionsRef.value?.value ?? null);
    const toolsLoading = computed(() => !toolOptionsState.value || toolOptionsState.value.status === "loading");
    const toolsError = computed(() => {
      const current = toolOptionsState.value;
      if (!current || (current.status !== "error" && current.status !== "forbidden")) return "";
      const message = typeof current.message === "string" ? current.message.trim() : "";
      return message || t("tools.loadError");
    });
    const toolOptionsByKey = computed(() => {
      const byKey = new Map();
      const catalog = toolOptionsState.value;
      if (catalog?.status === "ready" && Array.isArray(catalog.value?.options)) {
        for (const option of catalog.value.options) byKey.set(option.primaryKey, option);
      }
      for (const option of resolvedHeldTools.value) byKey.set(option.primaryKey, option);
      return byKey;
    });

    function selectedToolIds(currentValue) {
      return Array.isArray(currentValue) ? currentValue.filter((id) => typeof id === "string") : [];
    }

    function selectedToolRows(currentValue) {
      return selectedToolIds(currentValue).map((id) => {
        const option = toolOptionsByKey.value.get(id);
        return {
          key: id,
          label: option?.label || id,
          description: option?.description || "",
          unavailable: option?.unavailable ?? null,
        };
      });
    }

    function removeTool(currentValue, key, set) {
      set(selectedToolIds(currentValue).filter((id) => id !== key));
    }

    function openToolPicker(currentValue) {
      state.setState({
        toolPickerSelected: selectedToolIds(currentValue),
        toolPickerOpen: true,
      });
    }

    function onToolPickerConfirm(keys) {
      const handle = formHandle.value;
      if (!handle) return;
      handle.set("/enabledMcpServiceIds", (Array.isArray(keys) ? keys : []).filter((key) => typeof key === "string"));
    }

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
    const grantVerbModel = computed({
      get: () => (GRANT_VERBS.has(values.value.grantVerb) ? values.value.grantVerb : "use"),
      set: (next) => state.set("grantVerb", GRANT_VERBS.has(next) ? next : "use"),
    });
    const canSubmitGrant = computed(
      () => grantEntryAllowed.value && grantDialogOpen.value && Boolean(values.value.grantPolicyId),
    );
    const grantVerbOptions = computed(() => [
      { value: "use", label: t("grants.use") },
      { value: "view", label: t("grants.view") },
      { value: "edit", label: t("grants.edit") },
    ]);
    const grantVerbDescription = computed(() => t(`grants.levelDesc.${grantVerbModel.value}`));

    watch(
      () => values.value.grantPolicy?.primaryKey ?? null,
      policyId => state.set("grantPolicyId", policyId),
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

    // Close any grant dialog if the reader cannot manage grants on this agent.
    watch(
      [detailReady, canGrant],
      ([ready, allowed]) => {
        if (!ready || allowed) return;
        if (values.value.grantDialog === true) {
          state.setState(GRANT_DIALOG_RESET);
        }
      },
      { immediate: true },
    );

    function settledOutcome(receipt) {
      if (!receipt || receipt.decision !== "confirm") return null;
      return receipt.response?.kind === "dispatched" ? receipt.response.outcome ?? null : null;
    }

    const removeOp = usePanelOperation("remove", "delete", {
      entry: false,
      available: () => detailReady.value,
      onSettled: async (receipt) => {
        const outcome = settledOutcome(receipt);
        if (outcome) await onRemoveDone(outcome);
      },
    });
    const deleteDescriptor = computed(() =>
      removeOp.state.value.status === "ready" ? removeOp.state.value.value?.delete ?? null : null,
    );
    const canRunDelete = computed(() =>
      detailReady.value && Boolean(deleteDescriptor.value) && !deleteDescriptor.value.unavailable,
    );

    function onMoreCommand(command) {
      if (command === "delete") void removeOp.run().catch(() => undefined);
    }

    async function openChat() {
      if (!selectedKey.value) return;
      if (detailDraft.value?.dirty) {
        let allowed = true;
        if (panel.confirmLeaveUnsaved) {
          allowed = await panel.confirmLeaveUnsaved();
          if (allowed) instance.forms.discard("form");
        } else {
          allowed = await instance.forms.reset("form", { confirm: true });
        }
        if (!allowed) return;
      }
      await navigate(`/agents/chat?agentId=${encodeURIComponent(selectedKey.value)}`).catch(() => undefined);
    }

    function notifyShareSettled(receipt) {
      const outcome = settledOutcome(receipt);
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("grants.updated") });
      instance.refreshObjects();
    }

    const shareEnableOp = usePanelOperation("shareEnable", "share", {
      entry: false,
      available: () => detailReady.value && canGrant.value && !domainShared.value,
      onSettled: notifyShareSettled,
    });
    const shareDisableOp = usePanelOperation("shareDisable", "share", {
      entry: false,
      available: () => detailReady.value && canGrant.value && domainShared.value,
      onSettled: notifyShareSettled,
    });
    const activeShareDescriptor = computed(() => {
      const current = domainShared.value ? shareDisableOp : shareEnableOp;
      return current.state.value.status === "ready" ? current.state.value.value?.share ?? null : null;
    });
    const shareControlDisabled = computed(() =>
      !canGrant.value
      || !activeShareDescriptor.value
      || Boolean(activeShareDescriptor.value.unavailable)
      || shareEnableOp.running.value
      || shareDisableOp.running.value,
    );
    const domainShareOptions = computed(() => [
      { value: "explicit", label: t("grants.audienceExplicit") },
      { value: "domain", label: t("grants.audienceDomain") },
    ]);
    const domainShareModel = computed({
      get: () => (domainShared.value ? "domain" : "explicit"),
      set: (next) => {
        const target = next === "domain" ? shareEnableOp : shareDisableOp;
        void target.run().catch(() => undefined);
      },
    });

    // Route back to the sibling catalog entry so the platform's unified unsaved-changes leave guard runs.
    function goBack() {
      void navigate(catalogPath.value).catch(() => undefined);
    }

    function retry() {
      instance.refreshObjects();
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("detail.saved") });
    }

    function onShareDone(outcome) {
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("grants.updated") });
      instance.refreshObjects();
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
        ...GRANT_DIALOG_RESET,
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

    return {
      t,
      selectedKey,
      agentCategory,
      canEdit,
      canGrant,
      domainShared,
      recordStatus,
      detailReady,
      recordErrorText,
      detailDraft,
      sections,
      activeSection,
      activeSectionLabel,
      activeSectionHint,
      enabledStatusOptions,
      dirtyItemCount,
      dirtyItemLabels,
      dirtySectionKeys,
      saveDraft,
      discardDraft,
      activeSectionHasDefaults,
      resetActiveSectionDefaults,
      liveIcon,
      liveTitle,
      modelPickerKey,
      promptPreview,
      classScopeMode,
      classScopeModeOptions,
      selectedClassNames,
      removeClassName,
      clearClassNames,
      avatarIconKeys: AVATAR_ICON_KEYS,
      avatarSwatches,
      avatarStyle,
      avatarKeyOf,
      avatarSwatchIndexOf,
      avatarAppIconByKey,
      avatarSvgKeyByKey,
      selectAvatarKey,
      selectAvatarColor,
      skillsLoading,
      skillsError,
      skillDiagnostics,
      selectedSkillRows,
      removeSkill,
      openSkillPicker,
      onSkillPickerConfirm,
      toolsLoading,
      toolsError,
      selectedToolRows,
      removeTool,
      openToolPicker,
      onToolPickerConfirm,
      grantEntryAllowed,
      grantDialogOpen,
      grantVerbModel,
      grantVerbOptions,
      grantVerbDescription,
      canSubmitGrant,
      canRunDelete,
      domainShareModel,
      domainShareOptions,
      shareControlDisabled,
      goBack,
      openChat,
      onMoreCommand,
      retry,
      onSaved,
      onShareDone,
      onRemoveDone,
      openGrantDialog,
      onGrantAdded,
    };
  },
});
