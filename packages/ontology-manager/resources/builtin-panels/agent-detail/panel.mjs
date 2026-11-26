import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  appIcon,
  mountPanel,
  usePanelContext,
  usePanelFormDraft,
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

/*
 * Agent detail panel: full-width edit-on-open view for a single platform:AgentDefinition.
 * - Opens via ?selected=<id> from either /ontology/agents/detail or /agents/settings/detail.
 * - Keeps the page header avatar and title synced with the live form draft, surfaces per-field
 *   unsaved changes directly beneath the header, provides a 560px Markdown editor with preview
 *   toggle for the system prompt, and displays public skills as a scannable card grid backed
 *   by the owner's options/resolve reads.
 * - Readers with `view` only see a read-only banner and form, with Save/Delete/Grants hidden.
 * - Editors (`canGrant`) can switch to the Permissions & sharing tab to toggle domain-wide use
 *   and grant or revoke single-select 3-level (use / view / edit) policy access.
 */
await mountPanel({
  setup() {
    const { instance, navigateBack, notify, t } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const catalogPath = computed(() => {
      const configured = values.value.catalogPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_CATALOG_PATH;
    });

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    const tabModel = computed({
      get: () => (values.value.tab === "grants" ? "grants" : "config"),
      set: (next) => state.set("tab", next === "grants" ? "grants" : "config"),
    });

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
      when: () => detailReady.value && canEdit.value && tabModel.value === "config",
    });

    const hasMemberContext = typeof instance.memberContext === "function";
    const headerRecordRef = shallowRef(null);
    const skillsMemberRef = shallowRef(null);
    const skillOptionsRef = shallowRef(null);
    const resolvedHeldSkills = shallowRef([]);

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

    // Prompt preview toggle (resets when switching agents).
    const promptPreview = ref(false);
    watch(selectedKey, () => {
      promptPreview.value = false;
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

    // Skills card grid backed by the owner's `options` and `resolve` reads (`skills/panel-reads.ts`).
    const heldSkillRefs = computed(() => {
      const raw = liveDraftValues.value?.skills;
      return Array.isArray(raw) ? raw : [];
    });

    let resolveSeq = 0;
    watch(
      [skillsMemberRef, canEdit, selectedKey, () => JSON.stringify(heldSkillRefs.value)],
      ([member, editable]) => {
        const seq = ++resolveSeq;
        const held = heldSkillRefs.value;
        if (!member || !editable || held.length === 0) {
          resolvedHeldSkills.value = [];
          return;
        }
        void member.data.read("selected", { values: [...held] }).then((result) => {
          if (seq !== resolveSeq) return;
          if (result.status === "ready" && Array.isArray(result.value?.options)) {
            resolvedHeldSkills.value = result.value.options;
          }
        }).catch(() => undefined);
      },
      { immediate: true },
    );

    const skillOptionsState = computed(() => skillOptionsRef.value?.value ?? null);
    const skillsLoading = computed(() => canEdit.value && (!skillOptionsState.value || skillOptionsState.value.status === "loading"));
    const skillsError = computed(() => {
      if (!canEdit.value) return "";
      const current = skillOptionsState.value;
      if (!current || (current.status !== "error" && current.status !== "forbidden")) return "";
      const message = typeof current.message === "string" ? current.message.trim() : "";
      return message || t("skills.loadError");
    });
    const skillCatalogOptions = computed(() => {
      if (!canEdit.value) return [];
      const current = skillOptionsState.value;
      return current?.status === "ready" && Array.isArray(current.value?.options)
        ? current.value.options
        : [];
    });
    const skillDiagnostics = computed(() => {
      if (!canEdit.value) return [];
      const current = skillOptionsState.value;
      return current?.status === "ready" && Array.isArray(current.value?.diagnostics)
        ? current.value.diagnostics
        : [];
    });

    const displayedSkills = computed(() => {
      if (skillsLoading.value) return [];
      const availableKeys = new Set(skillCatalogOptions.value.map((item) => item.primaryKey));
      const unavailableResolved = resolvedHeldSkills.value
        .filter((item) => !availableKeys.has(item.primaryKey))
        .map((item) => ({
          primaryKey: item.primaryKey,
          value: item.value,
          label: item.label || item.value?.name || item.primaryKey,
          description: item.description || "",
          unavailable: item.unavailable ?? { reason: "" },
        }));
      const seenKeys = new Set([...availableKeys, ...unavailableResolved.map((item) => item.primaryKey)]);
      const unresolvedFallback = heldSkillRefs.value
        .map((skill) => ({ key: runtimeSkillKey(skill), skill }))
        .filter(({ key }) => key && !seenKeys.has(key))
        .map(({ key, skill }) => ({
          primaryKey: key,
          value: skill,
          label: skill.name,
          description: "",
          unavailable: canEdit.value ? { reason: "" } : null,
        }));
      return [
        ...skillCatalogOptions.value.map((item) => ({
          primaryKey: item.primaryKey,
          value: item.value,
          label: item.label,
          description: item.description || "",
          unavailable: item.unavailable ?? null,
        })),
        ...unavailableResolved,
        ...unresolvedFallback,
      ];
    });

    function isSkillSelected(currentValue, option) {
      if (!Array.isArray(currentValue)) return false;
      const targetKey = option.primaryKey || runtimeSkillKey(option.value);
      return currentValue.some((item) => runtimeSkillKey(item) === targetKey);
    }

    function selectedSkillCount(currentValue) {
      return Array.isArray(currentValue) ? currentValue.length : 0;
    }

    function toggleSkill(currentValue, option, disabled, set) {
      if (disabled) return;
      const list = Array.isArray(currentValue) ? currentValue : [];
      const targetKey = option.primaryKey || runtimeSkillKey(option.value);
      const exists = list.some((item) => runtimeSkillKey(item) === targetKey);
      if (exists) {
        set(list.filter((item) => runtimeSkillKey(item) !== targetKey));
      } else if (!option.unavailable) {
        set([...list, option.value]);
      }
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

    // Fall back to config tab and close any grant dialog if the reader cannot manage grants on this agent.
    watch(
      [detailReady, canGrant],
      ([ready, allowed]) => {
        if (!ready || allowed) return;
        if (tabModel.value === "grants") {
          tabModel.value = "config";
        }
        if (values.value.grantDialog === true) {
          state.setState(GRANT_DIALOG_RESET);
        }
      },
      { immediate: true },
    );

    // Mount the heavy config form tab lazily on first visit for the current agent so deep links to
    // `?tab=grants` skip config form/picker reads, while keeping unsaved edits across config <-> grants switches.
    const configTabMounted = ref(false);
    watch(
      selectedKey,
      (next, prev) => {
        if (next !== prev) configTabMounted.value = false;
      },
      { flush: "sync" },
    );
    watch(
      [detailReady, tabModel, canGrant],
      ([ready, tab, allowed]) => {
        if (ready && (tab === "config" || !allowed)) {
          configTabMounted.value = true;
        }
      },
      { immediate: true, flush: "sync" },
    );

    function goBack() {
      void navigateBack(catalogPath.value);
    }

    function retry() {
      instance.refreshObjects();
    }

    function onSaved() {
      instance.refreshObjects();
      notify({ kind: "success", text: t("detail.saved") });
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      if (selectedKey.value) state.set("selected", null);
      await nextTick();
      void navigateBack(catalogPath.value);
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

    function onShareDone(outcome) {
      if (outcome?.kind !== "success") return;
      notify({ kind: "success", text: t("grants.updated") });
      instance.refreshObjects();
    }

    return {
      t,
      selectedKey,
      tabModel,
      configTabMounted,
      agentCategory,
      canEdit,
      canGrant,
      domainShared,
      recordStatus,
      detailReady,
      recordErrorText,
      detailDraft,
      liveIcon,
      liveTitle,
      promptPreview,
      avatarIconKeys: AVATAR_ICON_KEYS,
      avatarSwatches,
      avatarStyle,
      avatarKeyOf,
      avatarSwatchIndexOf,
      avatarAppIconByKey,
      avatarSvgKeyByKey,
      selectAvatarKey,
      selectAvatarColor,
      hasSkillGrid: hasMemberContext,
      skillsLoading,
      skillsError,
      skillDiagnostics,
      displayedSkills,
      isSkillSelected,
      selectedSkillCount,
      toggleSkill,
      grantEntryAllowed,
      grantDialogOpen,
      grantVerbModel,
      grantVerbOptions,
      grantVerbDescription,
      canSubmitGrant,
      goBack,
      retry,
      onSaved,
      onRemoveDone,
      openGrantDialog,
      onGrantAdded,
      onShareDone,
    };
  },
});
