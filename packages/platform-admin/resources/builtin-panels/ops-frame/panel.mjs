import { computed, onBeforeUnmount, ref, watch } from "vue";
import { appIcon, mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

const MIN_SIDE_WIDTH = 360;
const MAX_SIDE_WIDTH = 760;
const SNAP_THRESHOLD = 80;
const MAX_SESSION_LIMIT = 50;
const SESSION_PAGE_STEP = 20;

function pickLocalizedText(names, locale, fallback = "") {
  if (!names || typeof names !== "object") return fallback;
  if (locale && typeof names[locale] === "string" && names[locale].trim()) return names[locale];
  const base = locale?.split("-")[0];
  if (base) {
    const matched = Object.entries(names).find(([key, val]) => key.toLowerCase().startsWith(base.toLowerCase()) && typeof val === "string" && val.trim());
    if (matched) return matched[1];
  }
  if (typeof names.en === "string" && names.en.trim()) return names.en;
  const first = Object.values(names).find((val) => typeof val === "string" && val.trim());
  return typeof first === "string" ? first : fallback;
}

await mountPanel({
  setup() {
    const context = usePanelContext();
    const state = context.instance.state;

    const currentLocale = computed(() => context.t("locale.code"));
    const entryMenu = computed(() => context.entryMenu.value);
    const panelUses = computed(() => entryMenu.value?.panelUses ?? []);
    const declaredGroups = computed(() => entryMenu.value?.groups ?? []);
    const currentEntry = computed(() => context.currentEntry.value);

    const appTitle = computed(() =>
      pickLocalizedText(entryMenu.value?.names, currentLocale.value, context.t("panel.name")),
    );

    // Declarative frame-conversation entry (no hardcoded path or entry ID).
    const conversationEntry = computed(() =>
      panelUses.value.find((use) => use.kind === "frame-conversation") ?? null,
    );
    const hasConversationEntry = computed(() => Boolean(conversationEntry.value));
    const isConversationEntry = computed(() => {
      const entry = currentEntry.value;
      if (!entry) return false;
      if (entry.kind === "frame-conversation") return true;
      return Boolean(conversationEntry.value && entry.path === conversationEntry.value.path);
    });

    // Build sidebar navigation items and collapsible group tab strips strictly from entryMenu.
    const navModel = computed(() => {
      const groupByKey = new Map(declaredGroups.value.map((group) => [group.key, group]));
      const namedByGroup = new Map();
      for (const use of panelUses.value) {
        if (use.kind === "frame-conversation") continue;
        if (use.groupKey && groupByKey.has(use.groupKey)) {
          const list = namedByGroup.get(use.groupKey) ?? [];
          list.push(use);
          namedByGroup.set(use.groupKey, list);
        }
      }

      const items = [];
      const seenGroups = new Set();
      for (const use of panelUses.value) {
        if (use.kind === "frame-conversation") continue;
        if (use.groupKey && groupByKey.has(use.groupKey)) {
          if (seenGroups.has(use.groupKey)) continue;
          seenGroups.add(use.groupKey);
          const group = groupByKey.get(use.groupKey);
          const groupUses = namedByGroup.get(use.groupKey) ?? [use];
          const tabs = groupUses.map((entry) => ({
            id: entry.id,
            path: entry.path,
            label: pickLocalizedText(entry.names, currentLocale.value),
          }));
          items.push({
            key: `group:${group.key}`,
            groupKey: group.key,
            path: groupUses[0].path,
            icon: groupUses[0].icon ?? "pages",
            label: pickLocalizedText(group.names, currentLocale.value, group.key),
            tabs,
          });
          continue;
        }
        items.push({
          key: use.id,
          groupKey: null,
          path: use.path,
          icon: use.icon ?? "pages",
          label: pickLocalizedText(use.names, currentLocale.value),
          tabs: [],
        });
      }
      return { items, groupByKey };
    });

    const navItems = computed(() => navModel.value.items);

    const activeUseIndex = computed(() => {
      const path = currentEntry.value?.path;
      if (!path) return -1;
      return panelUses.value.findIndex((use) => use.path === path);
    });
    const activeUse = computed(() =>
      activeUseIndex.value >= 0 ? panelUses.value[activeUseIndex.value] : null,
    );

    const activeNavItem = computed(() => {
      const use = activeUse.value;
      if (!use || use.kind === "frame-conversation") return null;
      if (use.groupKey) {
        const grouped = navItems.value.find((item) => item.groupKey === use.groupKey);
        if (grouped) return grouped;
      }
      return navItems.value.find((item) => item.path === use.path) ?? null;
    });

    const activeGroupTabs = computed(() => {
      const item = activeNavItem.value;
      return item && item.tabs.length > 1 ? item.tabs : [];
    });

    const activeTabPath = computed(() => activeUse.value?.path ?? null);

    const paneTitle = computed(() => {
      if (activeNavItem.value) return activeNavItem.value.label;
      if (activeUse.value) {
        return pickLocalizedText(activeUse.value.names, currentLocale.value);
      }
      return appTitle.value;
    });

    // Panel state accessors (instance.state.values is a Vue Ref holding declared panel state).
    const sessionId = computed(() => {
      const raw = state.values.value.sessionId;
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
    });
    const paneMode = computed(() => (state.values.value.pane === "side" ? "side" : "full"));
    const sessionLimit = computed(() => {
      const raw = state.values.value.sessionLimit;
      return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 20;
    });

    const layoutMode = computed(() => {
      if (!hasConversationEntry.value) return "content-only";
      if (isConversationEntry.value) return "pure";
      return paneMode.value === "side" ? "side" : "full";
    });
    const isFloating = computed(() => layoutMode.value === "full");
    const composerFolded = ref(false);

    // Sync active session with recentSessions ObjectList highlight:
    // highlight only when viewing pure conversation on that session, so clicking any session
    // while on a feature page always navigates cleanly to pure conversation on that session.
    let syncingSelection = false;
    watch(
      [sessionId, isConversationEntry],
      ([id, pure]) => {
        const current = state.values.value.selectedSession;
        const currentKey = current && typeof current === "object" ? current.primaryKey : null;
        const desiredKey = pure && id ? id : null;
        if (currentKey === desiredKey) return;
        syncingSelection = true;
        try {
          state.set(
            "selectedSession",
            desiredKey ? { className: "platform:AgentSession", primaryKey: desiredKey } : null,
          );
        } finally {
          syncingSelection = false;
        }
      },
      { immediate: true },
    );

    watch(
      () => state.values.value.selectedSession,
      (next) => {
        if (syncingSelection) return;
        const key = next && typeof next === "object" && typeof next.primaryKey === "string" ? next.primaryKey : null;
        if (!key) return;
        if (key !== sessionId.value) {
          state.set("sessionId", key);
        }
        drawerOpen.value = false;
        if (!isConversationEntry.value && conversationEntry.value) {
          void context.navigate(conversationEntry.value.path);
        }
      },
    );

    // Detect when the active session was deleted from the recent list.
    const listedSessions = usePanelOutput("recentSessions", "listed");
    const loadedSessionCount = usePanelOutput("recentSessions", "loadedCount");
    let previousListedIds = new Set();
    watch(listedSessions, (rows) => {
      if (!Array.isArray(rows)) return;
      const nextIds = new Set(
        rows
          .map((item) => (item && typeof item === "object" ? item.primaryKey : null))
          .filter((id) => typeof id === "string"),
      );
      const activeId = sessionId.value;
      if (activeId && previousListedIds.has(activeId) && !nextIds.has(activeId)) {
        state.set("sessionId", null);
      }
      previousListedIds = nextIds;
    });

    const canShowMoreSessions = computed(() =>
      typeof loadedSessionCount.value === "number"
      && loadedSessionCount.value >= sessionLimit.value
      && sessionLimit.value < MAX_SESSION_LIMIT,
    );

    function showMoreSessions() {
      state.set("sessionLimit", Math.min(MAX_SESSION_LIMIT, sessionLimit.value + SESSION_PAGE_STEP));
    }

    function startNewChat() {
      drawerOpen.value = false;
      state.set("sessionId", null);
      state.set("selectedSession", null);
      if (!isConversationEntry.value && conversationEntry.value) {
        void context.navigate(conversationEntry.value.path);
      }
    }

    function openEntry(path) {
      drawerOpen.value = false;
      void context.navigate(path);
    }

    function togglePaneMode() {
      composerFolded.value = false;
      state.set("pane", paneMode.value === "side" ? "full" : "side");
    }

    function closeFeaturePane() {
      if (conversationEntry.value) {
        void context.navigate(conversationEntry.value.path);
      }
    }

    function onSessionIdUpdate(next) {
      const normalized = typeof next === "string" && next.trim().length > 0 ? next.trim() : null;
      if (normalized !== sessionId.value) {
        state.set("sessionId", normalized);
      }
    }

    function onChatExpand() {
      composerFolded.value = false;
      if (!isConversationEntry.value && paneMode.value !== "side") {
        state.set("pane", "side");
      }
    }

    function onEntryTriggered(payload) {
      composerFolded.value = false;
      const triggeredId = typeof payload?.sessionId === "string" && payload.sessionId.trim().length > 0
        ? payload.sessionId.trim()
        : null;
      if (triggeredId && triggeredId !== sessionId.value) {
        state.set("sessionId", triggeredId);
      }
      if (!isConversationEntry.value && paneMode.value !== "side") {
        state.set("pane", "side");
      }
    }

    // Side-by-side drag resize handle (6px left edge of right pane).
    const featurePaneRef = ref(null);
    const sideWidthPx = ref(null);
    const dragging = ref(false);
    let dragStartX = 0;
    let dragStartWidth = 0;
    let dragOvershoot = 0;

    function onPointerMove(event) {
      if (!dragging.value) return;
      const raw = dragStartWidth + (dragStartX - event.clientX);
      if (raw > MAX_SIDE_WIDTH) {
        dragOvershoot = raw - MAX_SIDE_WIDTH;
        sideWidthPx.value = MAX_SIDE_WIDTH;
      } else if (raw < MIN_SIDE_WIDTH) {
        dragOvershoot = raw - MIN_SIDE_WIDTH;
        sideWidthPx.value = MIN_SIDE_WIDTH;
      } else {
        dragOvershoot = 0;
        sideWidthPx.value = Math.round(raw);
      }
    }

    function stopDragging() {
      if (!dragging.value) return;
      dragging.value = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      if (dragOvershoot >= SNAP_THRESHOLD) {
        state.set("pane", "full");
      } else if (dragOvershoot <= -SNAP_THRESHOLD) {
        closeFeaturePane();
      }
      dragOvershoot = 0;
    }

    function startDragging(event) {
      if (layoutMode.value !== "side") return;
      event.preventDefault();
      const paneEl = featurePaneRef.value;
      dragStartX = event.clientX;
      dragStartWidth = paneEl ? paneEl.getBoundingClientRect().width : 520;
      dragOvershoot = 0;
      dragging.value = true;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    }

    const featurePaneStyle = computed(() => {
      if (layoutMode.value !== "side" || sideWidthPx.value === null) return undefined;
      return { width: `${sideWidthPx.value}px`, flexBasis: `${sideWidthPx.value}px` };
    });

    // Responsive <= 760px drawer state.
    const drawerOpen = ref(false);
    const narrow = ref(typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 760px)").matches
      : false);
    let mediaQuery = null;
    function onMediaChange(event) {
      narrow.value = event.matches;
      if (!event.matches) drawerOpen.value = false;
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      mediaQuery = window.matchMedia("(max-width: 760px)");
      mediaQuery.addEventListener("change", onMediaChange);
    }

    onBeforeUnmount(() => {
      stopDragging();
      mediaQuery?.removeEventListener("change", onMediaChange);
    });

    return {
      t: context.t,
      appIcon,
      appTitle,
      navItems,
      activeNavItem,
      activeGroupTabs,
      activeTabPath,
      paneTitle,
      hasConversationEntry,
      isConversationEntry,
      sessionId,
      paneMode,
      layoutMode,
      isFloating,
      composerFolded,
      canShowMoreSessions,
      showMoreSessions,
      startNewChat,
      openEntry,
      togglePaneMode,
      closeFeaturePane,
      onSessionIdUpdate,
      onChatExpand,
      onEntryTriggered,
      featurePaneRef,
      featurePaneStyle,
      dragging,
      startDragging,
      narrow,
      drawerOpen,
    };
  },
});
