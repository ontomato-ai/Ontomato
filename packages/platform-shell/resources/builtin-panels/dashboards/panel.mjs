import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  mountPanel,
  usePanelContext,
  usePanelOperation,
  usePanelOutput,
} from "@ontomato/sdk/panel";

const DASHBOARD = "platform:Dashboard";

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

await mountPanel({
  setup() {
    const { instance, notify, t } = usePanelContext();
    const values = instance.state.values;

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

    // Clear selected card and dialog when switching to a different board, while preserving valid deep links.
    watch(dashboardPrimaryKey, (nextBoardId, prevBoardId) => {
      if (nextBoardId === prevBoardId) return;
      if (cardPrimaryKey.value && !cardBelongsToBoard(cardPrimaryKey.value, nextBoardId)) {
        instance.state.setState({ cardId: null, cardDialog: null });
      } else if (values.value.cardDialog && !cardPrimaryKey.value) {
        instance.state.set("cardDialog", null);
      }
    });

    // Per-card member refs for targeted single-card refresh without reloading the whole board.
    const cardRefs = new Map();
    function setCardRef(primaryKey, el) {
      if (!primaryKey) return;
      if (el && typeof el.refresh === "function") {
        cardRefs.set(primaryKey, el);
      } else {
        cardRefs.delete(primaryKey);
      }
    }
    onBeforeUnmount(() => {
      cardRefs.clear();
    });

    function refreshCard(primaryKey) {
      const target = cardRefs.get(primaryKey);
      if (target && typeof target.refresh === "function") {
        target.refresh();
      }
    }

    function refreshAllCards() {
      for (const target of cardRefs.values()) {
        if (typeof target.refresh === "function") target.refresh();
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

    function openCardDialog(itemRef, dialog) {
      if (!itemRef?.primaryKey) return;
      instance.state.setState({
        cardId: { className: itemRef.className, primaryKey: itemRef.primaryKey },
        cardDialog: dialog,
      });
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

    // ---------- Board & group operations ----------
    function notifyFailure(outcome) {
      if (outcome.kind === "cancel") return;
      const reason = outcome.message || outcome.code || "";
      notify({ kind: "error", text: t("notice.actionFailed", { reason }) });
    }

    function notifyError(error) {
      notify({ kind: "error", text: t("notice.actionFailed", { reason: error?.message ?? String(error) }) });
    }

    const opSaveLayout = usePanelOperation("boardGrid", "saveLayout", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          notify({ kind: "success", text: t("notice.layoutSaved") });
        } else {
          notifyFailure(outcome);
        }
      },
      onError: notifyError,
    });

    const opCreateGroup = usePanelOperation("boardGrid", "createGroup", {
      available: hasBoard,
      onSettled(receipt) {
        const outcome = outcomeOf(receipt);
        if (outcome.kind === "success") {
          groupDialogOpen.value = false;
          notify({ kind: "success", text: t("notice.groupCreated") });
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

    function onLayoutChange(change) {
      if (!hasBoard.value) return;
      const payload = layoutPayloadFromChange(change);
      void opSaveLayout.run(payload);
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

    return {
      t,
      hasBoard,
      hasCard,
      noBoards,
      setCardRef,
      refreshCard,
      refreshAllCards,
      cardFieldString,
      cardFormats,
      paramDialogOpen,
      sourceDialogOpen,
      openCardDialog,
      closeCardDialog,
      onCardParametersSaved,
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
    };
  },
});
