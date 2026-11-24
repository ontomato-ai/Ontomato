import { computed, nextTick, watch } from "vue";
import { mountPanel, usePanelContext, usePanelFormDraft, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in action detail panel: single-row <page-header> (back to actions catalog, ObjectHeader identity, danger
 * OperationButton delete, and Save/Discard draft controls wired via usePanelFormDraft) above the Definition form,
 * Derived definition tables, and AnnotatedCode explanation tabs.
 *
 * The panel coordinates only declared state, tab navigation, and bidirectional parameter <-> code-segment highlighting;
 * form draft code flows straight to AnnotatedCode via member output binding without any extra state field, and the
 * panel performs no business calculations and reads no record fields.
 */

const CATALOG_PATH = "/ontology/assets/actions";
const ACTION_TYPE = "platform:Action";

const TABS = [
  { key: "definition", label: "definition" },
  { key: "derived", label: "derived" },
  { key: "code", label: "code" },
];

const ActionDetail = {
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const values = instance.state.values;

    const selected = computed(() => values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");
    const creating = computed(() => values.value.creating === true);
    const activeTab = computed({
      get: () => (typeof values.value.activeTab === "string" && values.value.activeTab ? values.value.activeTab : "definition"),
      set: (value) => instance.state.set("activeTab", value || "definition"),
    });

    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const recordStatus = computed(() => (!selectedKey.value ? "empty" : (headerStatus.value ?? "loading")));
    const detailReady = computed(() => Boolean(selectedKey.value) && recordStatus.value === "ready");
    const formMounted = computed(() => detailReady.value || (creating.value && !selectedKey.value));
    const errorText = computed(() => {
      const message = typeof headerError.value === "string" ? headerError.value.trim() : "";
      return message || t("missing");
    });

    const detailDraft = usePanelFormDraft("form", { when: formMounted });

    // Entering create mode switches straight to the definition form tab.
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
        ...(next && creating.value ? { creating: false } : {}),
        selectedParameter: null,
        activeSegmentId: null,
      });
    });

    // Route back to the catalog entry so the platform's unified unsaved-changes leave guard intercepts dirty edits.
    function goBack() {
      void navigate(CATALOG_PATH).catch(() => undefined);
    }

    async function onRemoveDone(outcome) {
      if (outcome?.kind !== "success") return;
      // Clear selection and wait a tick so any dirty form unmounts before leaving for the catalog.
      if (selectedKey.value) instance.state.set("selected", null);
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
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

    async function onFormCancel() {
      if (!creating.value) return;
      instance.state.setState({
        creating: false,
        activeTab: "definition",
        selectedParameter: null,
        activeSegmentId: null,
      });
      await nextTick();
      void navigate(CATALOG_PATH).catch(() => undefined);
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
      selectedKey,
      creating,
      recordStatus,
      detailReady,
      errorText,
      detailDraft,
      goBack,
      retry: () => instance.refreshObjects(),
      onRemoveDone,
      onFormSaved,
      onFormCancel,
      onSelectRef,
      onNavigateChild,
    };
  },
};

await mountPanel(ActionDetail);
