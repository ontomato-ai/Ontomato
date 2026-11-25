import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { appIcon, mountPanel, panelAddress, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const DEFAULT_DETAIL_PATH = "/ontology/agents/detail";

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

const DEFAULT_AVATAR = { key: "Brain", color: LIGHT_AVATAR_COLORS[0] };

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

function avatarSwatch(color) {
  const index = Math.max(0, LIGHT_AVATAR_COLORS.indexOf(color), DARK_AVATAR_COLORS.indexOf(color));
  return { light: LIGHT_AVATAR_COLORS[index], dark: DARK_AVATAR_COLORS[index] };
}

/*
 * Agents catalog: full-width searchable table with 28px agent avatars and single-line descriptions,
 * plus a centered creation dialog collecting only what the owner requires (/name and optional /description).
 * Create-button availability follows the owner's createForm admission check independently of list view grants.
 */
await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;

    const listStatus = usePanelOutput("list", "status");
    const detailPath = computed(() => {
      const configured = values.value.detailPath;
      return typeof configured === "string" && configured.startsWith("/") ? configured : DEFAULT_DETAIL_PATH;
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

    // Probe the owner's createForm admission rule directly so view-only readers (e.g. ontology-modeling
    // without analysis-agent) see the real create availability and reason before opening the dialog.
    const createFormStateRef = shallowRef(null);
    const hasMemberContext = typeof instance.memberContext === "function";
    if (hasMemberContext) {
      let active = true;
      onBeforeUnmount(() => {
        active = false;
      });
      void instance.memberContext("createForm").then((member) => {
        if (!active) return;
        createFormStateRef.value = member.data.use("createForm");
      }).catch(() => undefined);
    }

    const createFormState = computed(() => createFormStateRef.value?.value ?? null);
    const canCreate = computed(() => {
      if (!hasMemberContext) return listStatus.value !== "forbidden";
      return createFormState.value?.status === "ready";
    });
    const createUnavailableReason = computed(() => {
      if (!hasMemberContext) return "";
      const state = createFormState.value;
      if (!state || state.status === "loading" || state.status === "ready") return "";
      if (state.status === "forbidden") {
        const message = typeof state.message === "string" ? state.message.trim() : "";
        return message || t("agents.createForbidden");
      }
      if (state.status === "error") {
        const message = typeof state.message === "string" ? state.message.trim() : "";
        return message || t("agents.createUnavailable");
      }
      return t("agents.createForbidden");
    });

    const creating = computed(() => values.value.creating === true);
    const setCreating = (open) => instance.state.set("creating", Boolean(open));

    const createDialog = computed({
      get: () => creating.value,
      set: (open) => {
        if (Boolean(open) !== creating.value) setCreating(Boolean(open));
      },
    });
    const createButtonDisabled = computed(() => creating.value || !canCreate.value);

    function agentCellName(value, displayText) {
      if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
      if (typeof value === "string" && value.length > 0) return value;
      return typeof displayText === "string" ? displayText : "";
    }

    function agentCellIcon(value) {
      if (Array.isArray(value)) return typeof value[1] === "string" ? value[1] : "";
      return "";
    }

    function avatarStyle(icon) {
      const swatch = avatarSwatch(parseAgentAvatar(icon).color);
      return { background: isDark.value ? swatch.dark : swatch.light };
    }

    function avatarAppIcon(icon) {
      const mapped = AVATAR_APP_ICON_KEYS[parseAgentAvatar(icon).key];
      return mapped ? appIcon(mapped) : null;
    }

    function avatarSvgKey(icon) {
      const key = parseAgentAvatar(icon).key;
      if (key === "TrendingUp" || key === "Target") return key;
      return "Brain";
    }

    function detailAddress(primaryKey) {
      return panelAddress(detailPath.value, { selected: primaryKey });
    }

    function openDetail(item) {
      if (!item?.primaryKey) return;
      if (creating.value) setCreating(false);
      void navigate(detailAddress(item.primaryKey)).catch(() => undefined);
    }

    function startCreate() {
      if (!canCreate.value) return;
      setCreating(true);
    }

    function cancelCreate() {
      setCreating(false);
    }

    function onCreated(saved) {
      setCreating(false);
      notify({ kind: "success", text: t("agents.created") });
      if (saved?.primaryKey) {
        void navigate(detailAddress(saved.primaryKey)).catch(() => undefined);
      }
    }

    return {
      t,
      listStatus,
      canCreate,
      createButtonDisabled,
      createUnavailableReason,
      creating,
      createDialog,
      agentCellName,
      agentCellIcon,
      avatarStyle,
      avatarAppIcon,
      avatarSvgKey,
      openDetail,
      startCreate,
      cancelCreate,
      onCreated,
      refresh: () => instance.refreshObjects(),
    };
  },
});
