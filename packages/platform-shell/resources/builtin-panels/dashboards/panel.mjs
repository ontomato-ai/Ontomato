import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  mountPanel,
  panelAddress,
  usePanelContext,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DASHBOARD = "platform:Dashboard";
const METRIC_DETAIL_PATH = "/ontology/assets/metrics/detail";
const LAYOUT_DEBOUNCE_MS = 400;
const LAYOUT_WARN_THROTTLE_MS = 4000;

function cardIdFromPrimaryKey(primaryKey) {
  const raw = String(primaryKey ?? "");
  const slash = raw.indexOf("/");
  if (slash < 0) return raw;
  try {
    return decodeURIComponent(raw.slice(slash + 1));
  } catch {
    return raw.slice(slash + 1);
  }
}

function cardBelongsToBoard(cardPrimaryKey, boardPrimaryKey) {
  if (!cardPrimaryKey || !boardPrimaryKey) return false;
  const slash = cardPrimaryKey.indexOf("/");
  if (slash < 0) return false;
  try {
    return decodeURIComponent(cardPrimaryKey.slice(0, slash)) === boardPrimaryKey;
  } catch {
    return cardPrimaryKey.slice(0, slash) === boardPrimaryKey;
  }
}

function layoutPayloadFromChange(change) {
  return {
    groups: (change?.groups ?? []).map((group) => {
      const metrics = [];
      const charts = [];
      for (const item of group.items ?? []) {
        const entry = {
          id: cardIdFromPrimaryKey(item.primaryKey),
          layout: {
            colSpan: item.colSpan,
            rowSpan: item.rowSpan,
          },
        };
        if (item.section === "metric") metrics.push(entry);
        else charts.push(entry);
      }
      return {
        id: group.id,
        title: group.title,
        metrics,
        charts,
      };
    }),
  };
}

function outcomeOf(receipt) {
  if (!receipt || typeof receipt !== "object") return { kind: "unknown" };
  if (receipt.decision === "cancel") return { kind: "cancel" };
  const response = receipt.response ?? receipt;
  if (response?.kind === "not-dispatched") return { kind: "refusal", message: response.message };
  return response?.outcome ?? receipt.outcome ?? { kind: "unknown" };
}

function scrollGroupIntoView(groupId) {
  const id = String(groupId ?? "").trim();
  if (!id || typeof document === "undefined") return;
  const selector = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? `[data-group-id="${CSS.escape(id)}"]`
    : `[data-group-id="${id.replace(/"/g, '\\"')}"]`;
  const scroll = () => {
    document.querySelector(selector)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  void nextTick(() => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(scroll);
    else scroll();
  });
}

await mountPanel({
  setup() {
    const { instance, navigate, notify, t } = usePanelContext();
    const values = instance.state.values;
    const legacyLayout = computed(() => instance.frameState?.()?.legacyDashboardLayout === true);
    const cardActions = computed(() => ({
      maxVisible: 0,
      items: [
        { kind: "operation", operation: "renameCard", labelKey: "card.rename", prefill: true },
        ...(legacyLayout.value ? [] : [
          { kind: "local", id: "parameters", labelKey: "card.parameters", when: { field: "kind", equals: "metric" } },
          { kind: "local", id: "metricSource", labelKey: "card.metricSource", when: { field: "kind", equals: "metric" } },
        ]),
        { kind: "operation", operation: "deleteCard", labelKey: "card.delete", tone: "danger" },
      ],
    }));

    const dashboardRef = computed(() => values.value.dashboardId ?? null);
    const dashboardPrimaryKey = computed(() => dashboardRef.value?.primaryKey ?? null);
    const cardRef = computed(() => values.value.cardId ?? null);
    const cardPrimaryKey = computed(() => cardRef.value?.primaryKey ?? null);
    const hasBoard = computed(() => Boolean(dashboardPrimaryKey.value));
    const hasCard = computed(() => Boolean(cardPrimaryKey.value));

    const boardListStatus = usePanelOutput("boardTabs", "status");
    const listedBoards = usePanelOutput("boardTabs", "listed");
    const noBoards = computed(() => boardListStatus.value === "empty");

    // Reconcile active dashboard selection after deletion or when the board list becomes empty.
    watch([boardListStatus, listedBoards], ([status, list]) => {
      if (status === "empty") {
        if (dashboardPrimaryKey.value || cardPrimaryKey.value || values.value.cardDialog) {
          instance.state.setState({ dashboardId: null, cardId: null, cardDialog: null });
        }
        return;
      }
      if (status !== "ready" || !Array.isArray(list)) return;
      if (list.length === 0) {
        if (dashboardPrimaryKey.value) {
          instance.state.setState({ dashboardId: null, cardId: null, cardDialog: null });
        }
        return;
      }
      if (dashboardPrimaryKey.value && !list.some((item) => item?.primaryKey === dashboardPrimaryKey.value)) {
        const fallback = list[0];
        instance.state.setState({
          dashboardId: fallback ? { className: DASHBOARD, primaryKey: fallback.primaryKey } : null,
          cardId: null,
          cardDialog: null,
        });
      }
    });

    // Clear selected card, dialog, per-card UI states, and stale pending layout edits when switching boards.
    watch(dashboardPrimaryKey, (nextBoardId, prevBoardId) => {
      if (nextBoardId === prevBoardId) return;
      clearPendingLayoutTimer();
      if (pendingLayoutBoardId !== nextBoardId) {
        pendingLayoutPayload = null;
        pendingLayoutBoardId = null;
      }
      resetBoardLocalUiState();
      if (instance.forms.handle("boardGrid")?.dirty.value) {
        void instance.forms.handle("boardGrid")?.reset({ confirm: false });
      }
      if (cardPrimaryKey.value && !cardBelongsToBoard(cardPrimaryKey.value, nextBoardId)) {
        instance.state.setState({ cardId: null, cardDialog: null });
      } else if (values.value.cardDialog && !cardPrimaryKey.value) {
        instance.state.set("cardDialog", null);
      }
    });

    // Per-card member refs, view/zoom/truncation UI state, and title cache.
    const cardRefs = new Map();
    const cardTitles = ref({});
    const cardViewModes = reactive({});
    const cardZoomed = reactive({});
    const cardTruncations = reactive({});

    function clearReactiveMap(map) {
      for (const key of Object.keys(map)) {
        delete map[key];
      }
    }

    function resetBoardLocalUiState() {
      clearReactiveMap(cardViewModes);
      clearReactiveMap(cardZoomed);
      clearReactiveMap(cardTruncations);
    }

    function getCardViewMode(primaryKey) {
      return cardViewModes[primaryKey] === "table" ? "table" : "chart";
    }

    function setCardViewMode(primaryKey, mode) {
      if (!primaryKey) return;
      cardViewModes[primaryKey] = mode === "table" ? "table" : "chart";
    }

    function toggleCardViewMode(primaryKey) {
      setCardViewMode(primaryKey, getCardViewMode(primaryKey) === "table" ? "chart" : "table");
    }

    function isCardZoomed(primaryKey) {
      return Boolean(cardZoomed[primaryKey]);
    }

    function setCardZoomed(primaryKey, open) {
      if (!primaryKey) return;
      if (open) cardZoomed[primaryKey] = true;
      else delete cardZoomed[primaryKey];
    }

    function getCardTruncation(primaryKey) {
      return cardTruncations[primaryKey] ?? null;
    }

    function setCardTruncation(primaryKey, hint) {
      if (!primaryKey) return;
      if (typeof hint === "string" && hint.trim()) {
        cardTruncations[primaryKey] = hint.trim();
      } else {
        delete cardTruncations[primaryKey];
      }
    }

    function rememberCardTitle(primaryKey, title) {
      if (!primaryKey || typeof title !== "string") return;
      const trimmed = title.trim();
      if (!trimmed || cardTitles.value[primaryKey] === trimmed) return;
      cardTitles.value = { ...cardTitles.value, [primaryKey]: trimmed };
    }

    function setCardRef(primaryKey, el, title) {
      if (!primaryKey) return;
      if (title) rememberCardTitle(primaryKey, title);
      if (el && typeof el.refresh === "function") {
        cardRefs.set(primaryKey, el);
      } else {
        cardRefs.delete(primaryKey);
      }
    }

    function refreshCard(primaryKey) {
      const target = cardRefs.get(primaryKey);
      if (target && typeof target.refresh === "function") {
        target.refresh();
      }
    }

    function cardFieldString(row, key) {
      const raw = row?.fields?.[key];
      return typeof raw === "string" && raw.length > 0 ? raw : undefined;
    }

    function cardFormats(row) {
      const raw = row?.fields?.formats;
      if (raw && typeof raw === "object" && raw.kind === "json" && raw.value && typeof raw.value === "object") {
        return raw.value;
      }
      return undefined;
    }

    // ---------- Card dialogs ----------
    const selectedCardTitle = computed(() =>
      cardPrimaryKey.value ? cardTitles.value[cardPrimaryKey.value] ?? "" : "",
    );

    const paramDialogTitle = computed(() =>
      selectedCardTitle.value
        ? t("dialog.parametersTitleWithName", { name: selectedCardTitle.value })
        : t("dialog.parametersTitle"),
    );

    const sourceDialogTitle = computed(() =>
      selectedCardTitle.value
        ? t("dialog.metricSourceTitleWithName", { name: selectedCardTitle.value })
        : t("dialog.metricSourceTitle"),
    );

    const paramDialogOpen = computed({
      get: () => values.value.cardDialog === "parameters" && hasCard.value,
      set: (open) => {
        if (!open && values.value.cardDialog === "parameters") {
          instance.state.set("cardDialog", null);
        }
      },
    });

    const sourceDialogOpen = computed({
      get: () => values.value.cardDialog === "metricSource" && hasCard.value,
      set: (open) => {
        if (!open && values.value.cardDialog === "metricSource") {
          instance.state.set("cardDialog", null);
        }
      },
    });

    function openCardDialog(itemRef, dialog, title) {
      if (!itemRef?.primaryKey) return;
      if (title) rememberCardTitle(itemRef.primaryKey, title);
      instance.state.setState({
        cardId: { className: itemRef.className, primaryKey: itemRef.primaryKey },
        cardDialog: dialog,
      });
    }

    function onCardRowAction(payload) {
      if (!payload?.ref?.primaryKey) return;
      if (payload.id === "parameters") {
        openCardDialog(payload.ref, "parameters");
      } else if (payload.id === "metricSource") {
        openCardDialog(payload.ref, "metricSource");
      }
    }

    function closeCardDialog() {
      if (values.value.cardDialog) instance.state.set("cardDialog", null);
    }

    function onCardParametersSaved() {
      const key = cardPrimaryKey.value;
      closeCardDialog();
      if (key) refreshCard(key);
      notify({ kind: "success", text: t("notice.parametersSaved") });
    }

    function onNavigateMetric(reference) {
      if (!reference?.primaryKey) return;
      closeCardDialog();
      void navigate(panelAddress(METRIC_DETAIL_PATH, { selected: reference.primaryKey })).catch(() => undefined);
    }

    // ---------- Board & group operations ----------
    function notifyFailure(outcome) {
      if (outcome.kind === "cancel") return;
      const reason = outcome.message || outcome.code || "";
      notify({ kind: "error", text: t("notice.actionFailed", { reason }) });
    }

    function notifyError(error) {
      notify({ kind: "error", text: t("notice.actionFailed", { reason: error?.message ?? String(error) }) });
    }

    let layoutWarnLastAt = 0;
    function warnLayoutSaveFailed() {
      const now = Date.now();
      if (!layoutWarnLastAt || now - layoutWarnLastAt > LAYOUT_WARN_THROTTLE_MS) {
        layoutWarnLastAt = now;
        notify({ kind: "warning", text: t("notice.layoutSaveFailed") });
      }
    }

    // Silent debounced layout persistence matching the original DashboardPanel behavior.
    let layoutTimer = null;
    let layoutSaving = false;
    let pendingLayoutPayload = null;
    let pendingLayoutBoardId = null;

    function clearPendingLayoutTimer() {
      if (layoutTimer !== null) {
        clearTimeout(layoutTimer);
        layoutTimer = null;
      }
    }

    const opSaveLayout = usePanelOperation("boardGrid", "saveLayout", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind !== "success" && outcome.kind !== "cancel") {
          warnLayoutSaveFailed();
        }
      },
      onError() {
        warnLayoutSaveFailed();
      },
    });

    async function flushPendingLayout() {
      clearPendingLayoutTimer();
      if (layoutSaving || !pendingLayoutPayload) return;
      layoutSaving = true;
      try {
        while (pendingLayoutPayload) {
          const payload = pendingLayoutPayload;
          const boardId = pendingLayoutBoardId;
          pendingLayoutPayload = null;
          pendingLayoutBoardId = null;
          if (!boardId || boardId !== dashboardPrimaryKey.value) break;
          await opSaveLayout.run(payload);
        }
      } finally {
        layoutSaving = false;
      }
    }

    function onLayoutChange(change) {
      const boardId = dashboardPrimaryKey.value;
      if (!boardId) return;
      pendingLayoutPayload = layoutPayloadFromChange(change);
      pendingLayoutBoardId = boardId;
      clearPendingLayoutTimer();
      layoutTimer = setTimeout(() => {
        layoutTimer = null;
        void flushPendingLayout();
      }, LAYOUT_DEBOUNCE_MS);
    }

    onBeforeUnmount(() => {
      clearPendingLayoutTimer();
      if (pendingLayoutPayload) {
        void flushPendingLayout();
      }
      cardRefs.clear();
    });

    const opCreateGroup = usePanelOperation("boardGrid", "createGroup", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          groupDialogOpen.value = false;
          notify({ kind: "success", text: t("notice.groupCreated") });
          if (outcome.data?.id) {
            scrollGroupIntoView(outcome.data.id);
          }
        } else {
          notifyFailure(outcome);
        }
      },
      onError: notifyError,
    });

    const opRenameGroup = usePanelOperation("boardGrid", "renameGroup", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          groupDialogOpen.value = false;
          notify({ kind: "success", text: t("notice.groupRenamed") });
        } else {
          notifyFailure(outcome);
        }
      },
      onError: notifyError,
    });

    const opDeleteGroup = usePanelOperation("boardGrid", "deleteGroup", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          notify({ kind: "success", text: t("notice.groupDeleted") });
        } else {
          notifyFailure(outcome);
        }
      },
      onError: notifyError,
    });

    // Expose board rename action on the active board so agents can invoke it directly alongside tabs.
    usePanelOperation("boardGrid", "renameBoard", {
      available: hasBoard,
      onError: notifyError,
    });

    function onBoardCreated(outcome) {
      if (outcome?.kind !== "success") return;
      const primaryKey = outcome.created?.primaryKey ?? outcome.data?.id;
      if (typeof primaryKey === "string" && primaryKey) {
        instance.state.setState({
          dashboardId: { className: DASHBOARD, primaryKey },
          cardId: null,
          cardDialog: null,
        });
      }
    }

    // ---------- Group create / rename dialog ----------
    const groupDialogOpen = ref(false);
    const groupDialogMode = ref("create");
    const groupTitleDraft = ref("");
    const groupInsertIndex = ref(undefined);
    const editingGroupId = ref(null);

    const groupBusy = computed(() =>
      opCreateGroup.running.value || opRenameGroup.running.value || opDeleteGroup.running.value,
    );
    const groupDialogTitle = computed(() =>
      groupDialogMode.value === "rename" ? t("group.renameTitle") : t("group.createTitle"),
    );
    const canSubmitGroup = computed(() => {
      if (groupBusy.value) return false;
      if (groupDialogMode.value === "create") return groupTitleDraft.value.trim().length > 0;
      return Boolean(editingGroupId.value);
    });

    function openCreateGroup(insertIndex) {
      groupDialogMode.value = "create";
      groupTitleDraft.value = "";
      groupInsertIndex.value = typeof insertIndex === "number" ? insertIndex : undefined;
      editingGroupId.value = null;
      groupDialogOpen.value = true;
    }

    function openRenameGroup(group) {
      if (!group?.id) return;
      groupDialogMode.value = "rename";
      groupTitleDraft.value = group.title ?? "";
      groupInsertIndex.value = undefined;
      editingGroupId.value = group.id;
      groupDialogOpen.value = true;
    }

    function submitGroupDialog() {
      if (!canSubmitGroup.value) return;
      const title = groupTitleDraft.value.trim();
      if (groupDialogMode.value === "create") {
        const input = groupInsertIndex.value !== undefined
          ? { title, insertIndex: groupInsertIndex.value }
          : { title };
        void opCreateGroup.run(input);
      } else if (editingGroupId.value) {
        void opRenameGroup.run({ groupId: editingGroupId.value, title });
      }
    }

    function deleteGroup(group) {
      if (!group?.id || groupBusy.value) return;
      void opDeleteGroup.run({ groupId: group.id });
    }

    function handleGroupCommand(cmd, group, index) {
      if (groupBusy.value) return;
      if (cmd === "create_above") {
        openCreateGroup(index);
      } else if (cmd === "create_below") {
        openCreateGroup(index + 1);
      } else if (cmd === "rename") {
        openRenameGroup(group);
      } else if (cmd === "delete") {
        deleteGroup(group);
      }
    }

    return {
      t,
      legacyLayout,
      cardActions,
      hasBoard,
      hasCard,
      noBoards,
      setCardRef,
      cardFieldString,
      cardFormats,
      getCardViewMode,
      setCardViewMode,
      toggleCardViewMode,
      isCardZoomed,
      setCardZoomed,
      getCardTruncation,
      setCardTruncation,
      paramDialogOpen,
      sourceDialogOpen,
      paramDialogTitle,
      sourceDialogTitle,
      openCardDialog,
      onCardRowAction,
      closeCardDialog,
      onCardParametersSaved,
      onNavigateMetric,
      onBoardCreated,
      onLayoutChange,
      groupDialogOpen,
      groupDialogTitle,
      groupTitleDraft,
      groupBusy,
      canSubmitGroup,
      openCreateGroup,
      openRenameGroup,
      submitGroupDialog,
      deleteGroup,
      handleGroupCommand,
    };
  },
});
