import { computed, nextTick, ref, watch } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Four-layer capability map coordinator. All business reads and presentations live in official SDK projections
 * (`OntologyGraph`, `ObjectList`, `ReferencePicker`, `ObjectHeader`, `ObjectSummary`, `ObjectRelations`). This module
 * coordinates typed panel state (keeping URL-compatible `selectedType` synced with the internal `selectedTypeRef`
 * object reference), reads declared read-only projection outputs, and handles navigation to instance directories.
 */

const ONTOLOGY_TYPE = "platform:OntologyType";

const MODE_OPTIONS = [
  { value: "type", labelKey: "cm.modeType" },
  { value: "instance", labelKey: "cm.modeInstance" },
];

const VIEW_OPTIONS = [
  { value: "graph", labelKey: "cm.viewGraph" },
  { value: "list", labelKey: "cm.viewList" },
];

/** Extracts a valid `{ className, primaryKey }` object identity from panel state. */
function identity(value) {
  return value && typeof value === "object" && typeof value.className === "string" && typeof value.primaryKey === "string"
    ? { className: value.className, primaryKey: value.primaryKey }
    : null;
}

function identityKey(value) {
  const refValue = identity(value);
  return refValue ? `${refValue.className}\u0000${refValue.primaryKey}` : "";
}

const CapabilityMap = {
  setup() {
    const { instance, navigate } = usePanelContext();
    const state = instance.state;
    const values = state.values;

    const mode = computed(() => (values.value.mode === "type" ? "type" : "instance"));
    const view = computed(() => (values.value.view === "list" ? "list" : "graph"));
    const start = computed(() => identity(values.value.start));
    const selected = computed(() => identity(values.value.selected));
    const selectedType = computed(() => (typeof values.value.selectedType === "string" && values.value.selectedType ? values.value.selectedType : null));
    const selectedTypeRef = computed(() => identity(values.value.selectedTypeRef));
    const query = computed(() => (typeof values.value.query === "string" ? values.value.query : ""));

    // Read-only projection outputs published by `typeHeader` (`ObjectHeader`) and `graph` (`OntologyGraph`).
    const typeHeaderStatus = usePanelOutput("typeHeader", "status");
    const typeHeaderLabel = usePanelOutput("typeHeader", "label");
    const typeHeaderError = usePanelOutput("typeHeader", "errorMessage");
    const directoryPath = usePanelOutput("typeHeader", "directoryPath");
    const directoryName = usePanelOutput("typeHeader", "directoryName");
    const graphStartLabel = usePanelOutput("graph", "startLabel");
    const graphStartDetail = usePanelOutput("graph", "startDetail");
    const graphRelationKindLabels = usePanelOutput("graph", "visibleRelationKindLabels");

    // Bidirectional loop-free sync between URL-friendly `selectedType` string and `selectedTypeRef` object state.
    watch(
      selectedType,
      (typeId) => {
        const currentRef = selectedTypeRef.value;
        if (!typeId) {
          if (currentRef !== null) state.set("selectedTypeRef", null);
          return;
        }
        if (currentRef?.primaryKey !== typeId) {
          state.set("selectedTypeRef", { className: ONTOLOGY_TYPE, primaryKey: typeId });
        }
      },
      { immediate: true },
    );

    watch(
      () => selectedTypeRef.value?.primaryKey ?? null,
      (refTypeId) => {
        if (refTypeId !== selectedType.value) {
          state.set("selectedType", refTypeId);
        }
      },
    );

    // Normalize an empty relation-kind selection array back to null so all relation kinds remain visible on the graph.
    watch(
      () => values.value.relationKinds,
      (held) => {
        if (Array.isArray(held) && held.length === 0) {
          state.set("relationKinds", null);
        }
      },
    );

    const relationKindsCount = computed(() => (Array.isArray(values.value.relationKinds) ? values.value.relationKinds.length : 0));
    const activeRelationKindLabels = computed(() =>
      Array.isArray(graphRelationKindLabels.value)
        ? graphRelationKindLabels.value.filter((item) => typeof item === "string" && item.length > 0)
        : [],
    );

    function clearRelationKinds() {
      state.set("relationKinds", null);
    }

    const typeDetailVisible = computed(
      () => Boolean(selectedType.value) && typeHeaderStatus.value !== "error" && typeHeaderStatus.value !== "forbidden",
    );

    const notice = ref(null);
    const pickingStart = computed(() => values.value.pickingStart === true);
    const showUserPicker = computed(() => values.value.showUserPicker === true);

    function onTypeChosen() {
      if (pickingStart.value) state.set("pickingStart", false);
    }

    /** Navigates to the product-layer instance directory reported by the type record's read-only outputs. */
    async function openInstances() {
      const path = typeof directoryPath.value === "string" && directoryPath.value ? directoryPath.value : null;
      if (!path) return;
      const name =
        (typeof directoryName.value === "string" && directoryName.value)
        || (typeof typeHeaderLabel.value === "string" && typeHeaderLabel.value)
        || selectedType.value
        || "";
      notice.value = null;
      try {
        await navigate(path);
      } catch (reason) {
        notice.value = {
          name,
          reason: reason instanceof Error ? reason.message : String(reason),
        };
      }
    }

    const hasCustomStart = computed(() => start.value !== null);
    const canUseSelectedAsStart = computed(
      () => Boolean(selected.value) && identityKey(selected.value) !== identityKey(start.value),
    );

    const startLabel = computed(() =>
      typeof graphStartLabel.value === "string" && graphStartLabel.value ? graphStartLabel.value : null,
    );
    const startDetail = computed(() =>
      typeof graphStartDetail.value === "string" && graphStartDetail.value ? graphStartDetail.value : null,
    );

    /** Explicit user action to promote a node as instance-mode start and focus it in the right pane. */
    function onSetStart(node) {
      const target = identity(node);
      if (!target) return;
      state.setState({
        mode: "instance",
        start: target,
        selected: target,
        expandedNodes: null,
        showUserPicker: false,
        pickingStart: false,
      });
    }

    function useSelectedAsStart() {
      if (!canUseSelectedAsStart.value) return;
      onSetStart(selected.value);
    }

    function resetStart() {
      state.setState({
        mode: "instance",
        start: null,
        selected: null,
        expandedNodes: null,
        showUserPicker: false,
        pickingStart: false,
      });
    }

    function toggleUserPicker() {
      state.set("showUserPicker", !showUserPicker.value);
    }

    const pickerSection = ref(null);
    watch(pickingStart, (open) => {
      if (!open) return;
      void nextTick(() => pickerSection.value?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });

    function togglePickingStart() {
      state.set("pickingStart", !pickingStart.value);
    }

    function onQueryChange(value) {
      const text = typeof value === "string" ? value : "";
      state.set("query", text || null);
    }

    function clearQuery() {
      state.set("query", null);
    }

    function setMode(value) {
      const next = value === "type" ? "type" : "instance";
      if (next === mode.value) return;
      state.setState({
        mode: next,
        showUserPicker: false,
        ...(next === "instance" ? { pickingStart: false } : {}),
      });
    }

    function setView(value) {
      state.set("view", value === "list" ? "list" : "graph");
    }

    return {
      mode,
      view,
      modeOptions: MODE_OPTIONS,
      viewOptions: VIEW_OPTIONS,
      setMode,
      setView,
      start,
      selected,
      selectedType,
      query,
      notice,
      typeHeaderStatus,
      typeHeaderLabel,
      typeHeaderError,
      directoryPath,
      directoryName,
      typeDetailVisible,
      relationKindsCount,
      activeRelationKindLabels,
      clearRelationKinds,
      onTypeChosen,
      openInstances,
      pickerSection,
      pickingStart,
      togglePickingStart,
      showUserPicker,
      toggleUserPicker,
      hasCustomStart,
      canUseSelectedAsStart,
      startLabel,
      startDetail,
      onSetStart,
      useSelectedAsStart,
      resetStart,
      onQueryChange,
      clearQuery,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(CapabilityMap);
