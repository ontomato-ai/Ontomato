import { computed, watch } from "vue";
import { mountPanel, usePanelBack, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in actions catalog panel: lists domain actions through ObjectList (with local search, batch status updates via
 * OperationButton, and ConversationEntry creation) and displays the selected action's header, ObjectForm definition,
 * owner-projected derived definition (ObjectSummary + ObjectList tables), and AnnotatedCode explanation.
 *
 * The panel coordinates only declared state, tab navigation, and bidirectional parameter <-> code-segment highlighting;
 * form draft code flows straight to AnnotatedCode via member output binding without any extra state field, and the
 * panel performs no business calculations and reads no record fields.
 */

const ACTION_TYPE = "platform:Action";

const TABS = [
  { key: "definition", label: "definition" },
  { key: "derived", label: "derived" },
  { key: "code", label: "code" },
];

const ActionsCatalog = {
  setup() {
    const { instance } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? null);
    const activeTab = computed({
      get: () => (typeof values.value.activeTab === "string" && values.value.activeTab ? values.value.activeTab : "definition"),
      set: (value) => instance.state.set("activeTab", value || "definition"),
    });

    const creating = computed(() => values.value.creating === true);
    const detailVisible = computed(() => selected.value !== null || creating.value);

    // Opening create mode switches straight to the definition form tab.
    watch(
      creating,
      (active) => {
        if (active) activeTab.value = "definition";
      },
      { immediate: true },
    );

    // Clear ephemeral detail coordination state whenever the selected action changes or clears.
    watch(selectedKey, (next, prev) => {
      if (next === prev) return;
      instance.state.setState({
        ...(next !== null && creating.value ? { creating: false } : {}),
        selectedParameter: null,
        activeSegmentId: null,
      });
    });

    function leaveDetail() {
      instance.state.setState({
        selected: null,
        creating: false,
        activeTab: "definition",
        selectedParameter: null,
        activeSegmentId: null,
      });
    }

    // Guard both the Back button and Escape against unsaved edits in `form` across all detail tabs.
    const detailBack = usePanelBack(() => detailVisible.value, leaveDetail, {
      pushHistory: false,
      forms: "form",
    });

    function back() {
      void detailBack.back();
    }

    function onChooseAction() {
      instance.state.setState({
        creating: false,
        activeTab: "definition",
        selectedParameter: null,
        activeSegmentId: null,
      });
    }

    function onRemoveDone(outcome) {
      if (outcome?.kind === "success") leaveDetail();
    }

    function onFormSaved(saved) {
      const patch = {};
      if (creating.value) patch.creating = false;
      if (saved?.primaryKey && (!selected.value || selected.value.primaryKey !== saved.primaryKey)) {
        patch.selected = {
          className: saved.className ?? ACTION_TYPE,
          primaryKey: saved.primaryKey,
        };
      }
      if (Object.keys(patch).length > 0) {
        instance.state.setState(patch);
      }
    }

    function onFormDiscarded() {
      if (creating.value) {
        instance.state.setState({
          creating: false,
          activeTab: "definition",
          selectedParameter: null,
          activeSegmentId: null,
        });
      }
    }

    // Clicking a parameter reference inside AnnotatedCode switches to Derived definition and highlights that parameter row.
    function onSelectRef(refKey) {
      if (typeof refKey !== "string" || !refKey || !selected.value) return;
      instance.state.setState({
        activeTab: "derived",
        selectedParameter: {
          parent: { objectType: selected.value.className, primaryKey: selected.value.primaryKey },
          primaryKey: refKey,
        },
      });
    }

    // Clicking an inline child reference in derived tables locates either the parameter row or its code segment.
    function onNavigateChild(ref) {
      if (!ref || typeof ref !== "object" || typeof ref.primaryKey !== "string" || !ref.primaryKey) return;
      if (ref.collection === "parameters" && ref.parent?.objectType && ref.parent?.primaryKey) {
        instance.state.setState({
          activeTab: "derived",
          selectedParameter: {
            parent: { objectType: ref.parent.objectType, primaryKey: ref.parent.primaryKey },
            primaryKey: ref.primaryKey,
          },
        });
      } else if (ref.collection === "codeSegments") {
        instance.state.setState({
          activeTab: "code",
          activeSegmentId: ref.primaryKey,
        });
      }
    }

    return {
      tabs: TABS,
      activeTab,
      selected,
      creating,
      detailVisible,
      back,
      onChooseAction,
      onRemoveDone,
      onFormSaved,
      onFormDiscarded,
      onSelectRef,
      onNavigateChild,
      refresh: () => instance.refreshObjects(),
    };
  },
};

await mountPanel(ActionsCatalog);
