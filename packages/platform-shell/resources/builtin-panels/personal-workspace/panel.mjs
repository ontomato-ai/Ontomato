import { computed, ref } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

/*
 * Built-in personal workspace panel: combines a greeting hero and inline Quick Ask composer
 * with a draggable, resizable, hideable 12-column GroupedGrid of fixed personal blocks
 * (scheduled tasks, favorite apps & agents, followed dashboards & pinned cards, recent
 * conversations, pinned objects, and recent visits), plus slide-over inspection drawers.
 */

const BLOCK_ITEMS = [
  { id: "tasks", titleKey: "block.tasks" },
  { id: "apps", titleKey: "block.apps" },
  { id: "dashboards", titleKey: "block.dashboards" },
  { id: "conversations", titleKey: "block.conversations" },
  { id: "objects", titleKey: "block.objects" },
  { id: "recent", titleKey: "block.recent" },
];

const BLOCK_HEADER_LINKS = {
  apps: [
    { path: "/app-builder", labelKey: "link.appBuilder" },
    { path: "/applications", labelKey: "link.allApps" },
  ],
  dashboards: [{ path: "/dashboards", labelKey: "link.allDashboards" }],
  tasks: [{ path: "/schedules", labelKey: "link.allTasks" }],
  conversations: [{ path: "/agents/chat", labelKey: "link.allConversations" }],
};

const LAYOUT_PRESETS = {
  balanced: {
    groups: [
      {
        id: "workspace",
        items: [
          { id: "tasks", colSpan: 8, rowSpan: 3 },
          { id: "apps", colSpan: 4, rowSpan: 3 },
          { id: "dashboards", colSpan: 8, rowSpan: 3 },
          { id: "conversations", colSpan: 4, rowSpan: 3 },
          { id: "objects", colSpan: 6, rowSpan: 3 },
          { id: "recent", colSpan: 6, rowSpan: 3 },
        ],
      },
    ],
  },
  tasks: {
    groups: [
      {
        id: "workspace",
        items: [
          { id: "tasks", colSpan: 12, rowSpan: 4 },
          { id: "conversations", colSpan: 6, rowSpan: 3 },
          { id: "apps", colSpan: 6, rowSpan: 3 },
          { id: "dashboards", colSpan: 8, rowSpan: 3 },
          { id: "objects", colSpan: 4, rowSpan: 3 },
          { id: "recent", colSpan: 12, rowSpan: 2 },
        ],
      },
    ],
  },
  data: {
    groups: [
      {
        id: "workspace",
        items: [
          { id: "dashboards", colSpan: 12, rowSpan: 4 },
          { id: "objects", colSpan: 6, rowSpan: 3 },
          { id: "tasks", colSpan: 6, rowSpan: 3 },
          { id: "apps", colSpan: 4, rowSpan: 3 },
          { id: "conversations", colSpan: 4, rowSpan: 3 },
          { id: "recent", colSpan: 4, rowSpan: 3 },
        ],
      },
    ],
  },
  assistant: {
    groups: [
      {
        id: "workspace",
        items: [
          { id: "conversations", colSpan: 8, rowSpan: 4 },
          { id: "apps", colSpan: 4, rowSpan: 4 },
          { id: "tasks", colSpan: 6, rowSpan: 3 },
          { id: "recent", colSpan: 6, rowSpan: 3 },
          { id: "dashboards", colSpan: 8, rowSpan: 3 },
          { id: "objects", colSpan: 4, rowSpan: 3 },
        ],
      },
    ],
  },
};

const PRESET_LIST = [
  { id: "balanced", labelKey: "prefs.preset.balanced" },
  { id: "tasks", labelKey: "prefs.preset.tasks" },
  { id: "data", labelKey: "prefs.preset.data" },
  { id: "assistant", labelKey: "prefs.preset.assistant" },
];

function cloneLayout(source) {
  return {
    groups: (source?.groups ?? []).map((group) => ({
      id: group.id,
      ...(group.title ? { title: group.title } : {}),
      items: (group.items ?? []).map((item) => ({
        id: item.id,
        colSpan: item.colSpan,
        rowSpan: item.rowSpan,
        ...(item.hidden ? { hidden: true } : {}),
      })),
    })),
  };
}

function layoutSignature(layout) {
  const groups = Array.isArray(layout?.groups) ? layout.groups : [];
  return groups
    .flatMap((group) => (Array.isArray(group?.items) ? group.items : []))
    .map((item) => `${item?.id ?? ""}:${item?.colSpan ?? ""}:${item?.rowSpan ?? ""}:${item?.hidden ? "1" : "0"}`)
    .join("|");
}

function greetingPeriodForHour(hour) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

function inferCardKind(card) {
  const fields = card?.row?.fields;
  const rawKind = typeof card?.kind === "string"
    ? card.kind
    : (typeof fields?.cardKind === "string"
        ? fields.cardKind
        : (typeof fields?.kind === "string" ? fields.kind : ""));
  if (rawKind.toLowerCase() === "chart") return "chart";
  if (rawKind.toLowerCase() === "metric") return "metric";
  return fields?.chartFile !== undefined ? "chart" : "metric";
}

function cardPathFromPrimaryKey(primaryKey) {
  const raw = String(primaryKey ?? "");
  const slash = raw.indexOf("/");
  if (slash < 0) return "/dashboards";
  try {
    const dashboardId = decodeURIComponent(raw.slice(0, slash));
    const cardId = decodeURIComponent(raw.slice(slash + 1));
    return `/dashboards?dashboardId=${encodeURIComponent(dashboardId)}&cardId=${encodeURIComponent(cardId)}`;
  } catch {
    return "/dashboards";
  }
}

function objectPathFromRef(ref) {
  if (!ref?.className || !ref?.primaryKey) return "";
  return `/browser/views/${encodeURIComponent(ref.className)}?key=${encodeURIComponent(ref.primaryKey)}&from=workspace`;
}

function taskPathFromPrimaryKey(primaryKey) {
  if (!primaryKey) return "/schedules";
  return `/schedules?selectedTask=${encodeURIComponent(primaryKey)}`;
}

function outcomeOf(receipt) {
  if (!receipt || typeof receipt !== "object") return { kind: "unknown" };
  if (receipt.decision === "cancel") return { kind: "cancel" };
  const response = receipt.response ?? receipt;
  if (response?.kind === "not-dispatched") return { kind: "refusal", message: response.message };
  return response?.outcome ?? receipt.outcome ?? { kind: "unknown" };
}

await mountPanel({
  setup() {
    const { instance, navigate, notify, t, currentUser } = usePanelContext();
    const values = instance.state.values;

    const greetingText = computed(() => {
      const period = greetingPeriodForHour(new Date().getHours());
      const displayName = currentUser?.value?.displayName?.trim();
      if (displayName) {
        return t(`hero.greetingNamed.${period}`, { name: displayName });
      }
      return t(`hero.greeting.${period}`);
    });
    const preferencesOpen = ref(false);
    const resettingHome = ref(false);
    const refreshingAll = ref(false);
    const projectionRefs = new Map();

    const isCustomHomeOutput = usePanelOutput("homeStatus", "isCustomHome");
    const isCustomHome = computed(() => isCustomHomeOutput.value === true);

    const gridHiddenCount = usePanelOutput("workspaceGrid", "hiddenCount");
    const favoriteDashboardsLoaded = usePanelOutput("favoriteDashboards", "loadedCount");
    const hasFavoriteDashboards = computed(() => (favoriteDashboardsLoaded.value ?? 0) > 0);
    const pinnedSessionsLoaded = usePanelOutput("pinnedSessions", "loadedCount");
    const hasPinnedSessions = computed(() => (pinnedSessionsLoaded.value ?? 0) > 0);

    const currentLayout = computed(() => {
      const value = values.value.layout;
      return value && typeof value === "object" && Array.isArray(value.groups)
        ? value
        : LAYOUT_PRESETS.balanced;
    });

    const activePresetId = computed(() => {
      const current = layoutSignature(currentLayout.value);
      for (const preset of PRESET_LIST) {
        if (layoutSignature(LAYOUT_PRESETS[preset.id]) === current) return preset.id;
      }
      return null;
    });

    const hiddenItems = computed(() => {
      const hiddenIds = new Set();
      for (const group of currentLayout.value.groups ?? []) {
        for (const item of group.items ?? []) {
          if (item?.hidden && typeof item.id === "string") hiddenIds.add(item.id);
        }
      }
      return BLOCK_ITEMS.filter((entry) => hiddenIds.has(entry.id));
    });

    const hiddenCount = computed(() => {
      const output = gridHiddenCount.value;
      return typeof output === "number" ? output : hiddenItems.value.length;
    });

    const openModeObjects = computed(() =>
      values.value.openModeObjects === "page" ? "page" : "drawer",
    );
    const openModeMetrics = computed(() =>
      values.value.openModeMetrics === "page" ? "page" : "drawer",
    );
    const openModeTasks = computed(() =>
      values.value.openModeTasks === "page" ? "page" : "drawer",
    );

    const selectedObject = computed(() => values.value.selectedObject ?? null);
    const hasSelectedObject = computed(() =>
      Boolean(selectedObject.value?.className && selectedObject.value?.primaryKey),
    );
    const selectedObjectPath = computed(() => objectPathFromRef(selectedObject.value));
    const objectDrawerOpen = computed({
      get: () => hasSelectedObject.value,
      set: (open) => {
        if (!open && hasSelectedObject.value) instance.state.set("selectedObject", null);
      },
    });

    const selectedCardLabel = ref("");
    const selectedCardKind = ref("metric");
    const selectedCard = computed(() => values.value.selectedCard ?? null);
    const hasSelectedCard = computed(() => Boolean(selectedCard.value?.primaryKey));
    const selectedCardTarget = computed(() => {
      const current = selectedCard.value;
      if (!current?.className || !current?.primaryKey) return null;
      return selectedCardLabel.value
        ? { className: current.className, primaryKey: current.primaryKey, label: selectedCardLabel.value }
        : { className: current.className, primaryKey: current.primaryKey };
    });
    const selectedCardPath = computed(() =>
      selectedCard.value?.primaryKey ? cardPathFromPrimaryKey(selectedCard.value.primaryKey) : "",
    );
    const cardDrawerOpen = computed({
      get: () => hasSelectedCard.value,
      set: (open) => {
        if (!open && hasSelectedCard.value) {
          selectedCardLabel.value = "";
          selectedCardKind.value = "metric";
          instance.state.set("selectedCard", null);
        }
      },
    });

    const selectedTaskLabel = ref("");
    const selectedTaskOpenPath = ref("");
    const selectedTask = computed(() => values.value.selectedTask ?? null);
    const hasSelectedTask = computed(() => Boolean(selectedTask.value?.primaryKey));
    const selectedTaskTarget = computed(() => {
      const current = selectedTask.value;
      if (!current?.className || !current?.primaryKey) return null;
      return selectedTaskLabel.value
        ? { className: current.className, primaryKey: current.primaryKey, label: selectedTaskLabel.value }
        : { className: current.className, primaryKey: current.primaryKey };
    });
    const selectedTaskPath = computed(() => {
      if (selectedTaskOpenPath.value) return selectedTaskOpenPath.value;
      return selectedTask.value?.primaryKey ? taskPathFromPrimaryKey(selectedTask.value.primaryKey) : "";
    });
    const taskDrawerOpen = computed({
      get: () => hasSelectedTask.value,
      set: (open) => {
        if (!open && hasSelectedTask.value) {
          selectedTaskLabel.value = "";
          selectedTaskOpenPath.value = "";
          instance.state.set("selectedTask", null);
        }
      },
    });

    const opResetHome = usePanelOperation("homeActions", "resetHome", {
      available: isCustomHome,
      onSettled(receipt) {
        resettingHome.value = false;
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          notify({ kind: "success", text: t("notice.restoredDefaultHome") });
        } else if (outcome.kind !== "cancel") {
          notify({ kind: "error", text: t("notice.actionFailed", { reason: outcome.message || outcome.code || "" }) });
        }
      },
      onError(error) {
        resettingHome.value = false;
        notify({ kind: "error", text: t("notice.actionFailed", { reason: error?.message ?? String(error) }) });
      },
    });

    async function runResetHome() {
      if (resettingHome.value || !isCustomHome.value) return;
      resettingHome.value = true;
      await opResetHome.run({ target: null, input: {} });
    }

    function bindProjection(slotName) {
      return (el) => {
        if (el && typeof el.refresh === "function") {
          projectionRefs.set(slotName, el);
        } else {
          projectionRefs.delete(slotName);
        }
      };
    }

    function refreshAll() {
      if (refreshingAll.value) return;
      refreshingAll.value = true;
      try {
        for (const projection of projectionRefs.values()) {
          projection.refresh?.();
        }
      } finally {
        setTimeout(() => {
          refreshingAll.value = false;
        }, 350);
      }
    }

    function openPath(path) {
      if (!path) return;
      void navigate(path);
    }

    function blockHeaderLinks(itemId) {
      return BLOCK_HEADER_LINKS[itemId] ?? [];
    }

    function setOpenMode(field, mode) {
      instance.state.set(field, mode === "page" ? "page" : "drawer");
    }

    function applyPreset(presetId) {
      const preset = LAYOUT_PRESETS[presetId] ?? LAYOUT_PRESETS.balanced;
      instance.state.set("layout", cloneLayout(preset));
      notify({ kind: "success", text: t("notice.presetApplied") });
    }

    function resetDefaultLayout() {
      instance.state.set("layout", cloneLayout(LAYOUT_PRESETS.balanced));
      notify({ kind: "success", text: t("notice.layoutReset") });
    }

    function restoreBlock(itemId) {
      const next = cloneLayout(currentLayout.value);
      for (const group of next.groups) {
        for (const item of group.items) {
          if (item.id === itemId) delete item.hidden;
        }
      }
      instance.state.set("layout", next);
    }

    function restoreAllHidden() {
      const next = cloneLayout(currentLayout.value);
      for (const group of next.groups) {
        for (const item of group.items) {
          delete item.hidden;
        }
      }
      instance.state.set("layout", next);
    }

    function onChooseObject(ref) {
      if (!ref?.className || !ref?.primaryKey) return;
      if (openModeObjects.value === "page") {
        openPath(objectPathFromRef(ref));
        return;
      }
      instance.state.set("selectedObject", { className: ref.className, primaryKey: ref.primaryKey });
    }

    function onSelectCard(card) {
      const ref = card?.ref ?? (card?.id ? { className: "platform:DashboardCard", primaryKey: card.id } : null);
      if (!ref?.className || !ref?.primaryKey) return;
      if (openModeMetrics.value === "page") {
        openPath(card?.row?.outputs?.openPath || cardPathFromPrimaryKey(ref.primaryKey));
        return;
      }
      selectedCardLabel.value = typeof card?.name === "string" ? card.name : "";
      selectedCardKind.value = inferCardKind(card);
      instance.state.set("selectedCard", { className: ref.className, primaryKey: ref.primaryKey });
    }

    function onSelectTask(task) {
      const ref = task?.ref ?? (task?.id ? { className: "platform:ScheduledTask", primaryKey: task.id } : null);
      if (!ref?.className || !ref?.primaryKey) return;
      const targetPath = task?.row?.outputs?.openPath || taskPathFromPrimaryKey(ref.primaryKey);
      if (openModeTasks.value === "page") {
        openPath(targetPath);
        return;
      }
      selectedTaskLabel.value = typeof task?.title === "string" ? task.title : "";
      selectedTaskOpenPath.value = targetPath;
      instance.state.set("selectedTask", { className: ref.className, primaryKey: ref.primaryKey });
    }

    function onResolveTask(task) {
      const taskId = task?.id ?? task?.ref?.primaryKey;
      if (!taskId) return;
      openPath(taskPathFromPrimaryKey(taskId));
    }

    return {
      t,
      greetingText,
      preferencesOpen,
      resettingHome,
      refreshingAll,
      isCustomHome,
      hiddenCount,
      hiddenItems,
      hasFavoriteDashboards,
      hasPinnedSessions,
      activePresetId,
      presets: PRESET_LIST,
      openModeObjects,
      openModeMetrics,
      openModeTasks,
      hasSelectedObject,
      selectedObject,
      selectedObjectPath,
      objectDrawerOpen,
      hasSelectedCard,
      selectedCardKind,
      selectedCardTarget,
      selectedCardPath,
      cardDrawerOpen,
      hasSelectedTask,
      selectedTaskTarget,
      selectedTaskPath,
      taskDrawerOpen,
      bindProjection,
      refreshAll,
      runResetHome,
      openPath,
      blockHeaderLinks,
      setOpenMode,
      applyPreset,
      resetDefaultLayout,
      restoreBlock,
      restoreAllHidden,
      onChooseObject,
      onSelectCard,
      onSelectTask,
      onResolveTask,
    };
  },
});
