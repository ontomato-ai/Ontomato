import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelContext, usePanelNarrow, usePanelOutput } from "@ontomato/sdk/panel";

const DETAIL_PATH = "/ontology/relations/detail";

const COLUMNS_WIDE = [
  { key: "label", labelKey: "col.relation", minWidth: 180 },
  { key: "fromclassLabel", labelKey: "col.from", minWidth: 120 },
  { key: "toclassLabel", labelKey: "col.to", minWidth: 120 },
  { key: "desc", labelKey: "col.desc", emptyKey: "col.emptyDash", minWidth: 160 },
];
const COLUMNS_COMPACT = [
  { key: "label", labelKey: "col.relation", minWidth: 190 },
  { key: "toclassLabel", labelKey: "col.to", minWidth: 100 },
];

/** Observe the panel's own container width via ResizeObserver (never window.innerWidth). */
function useContainerWidth(targetRef) {
  const width = ref(0);
  let observer = null;
  let currentEl = null;

  function measure(el) {
    const rect = el.getBoundingClientRect().width;
    width.value = rect > 0 ? rect : el.clientWidth;
  }

  function disconnect() {
    observer?.disconnect();
    observer = null;
    currentEl = null;
  }

  function attach(el) {
    if (el === currentEl) return;
    disconnect();
    if (!el) {
      width.value = 0;
      return;
    }
    currentEl = el;
    measure(el);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const next = entry.contentRect.width;
        width.value = next > 0 ? next : el.clientWidth;
      });
      observer.observe(el);
    }
  }

  onMounted(() => attach(targetRef.value));
  watch(targetRef, (el) => attach(el));
  onBeforeUnmount(disconnect);
  return width;
}

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const rootRef = ref(null);
    const narrow = usePanelNarrow(rootRef);
    const containerWidth = useContainerWidth(rootRef);
    const dialogWidth = computed(() => (narrow.value ? "94%" : "540px"));
    const relationColumns = computed(() =>
      containerWidth.value > 0 && containerWidth.value <= 900 ? COLUMNS_COMPACT : COLUMNS_WIDE,
    );

    const search = computed({
      get: () => instance.state.values.value.search ?? "",
      set: (value) => instance.state.set("search", value),
    });

    // Format the ObjectList projection's declared filteredCount read-only output in the viewer's language.
    const filteredCount = usePanelOutput("catalogue", "filteredCount");
    const countText = computed(() => (filteredCount.value === null ? "" : t("rel.count", { count: filteredCount.value })));

    const creating = computed(() => instance.state.values.value.creating === true);
    const setCreating = (value) => instance.state.set("creating", value ? true : null);

    function detailAddress(primaryKey) {
      return panelAddress(DETAIL_PATH, { selected: primaryKey });
    }

    function open(ref) {
      if (!ref?.primaryKey) return;
      if (creating.value) setCreating(false);
      void navigate(detailAddress(ref.primaryKey)).catch(() => undefined);
    }

    function startCreate() {
      setCreating(true);
    }

    function cancelCreate() {
      setCreating(false);
    }

    const createDialog = computed({
      get: () => creating.value,
      set: (value) => {
        if (!value && creating.value) cancelCreate();
      },
    });

    function onSaved(saved) {
      setCreating(false);
      const key = saved?.primaryKey;
      if (key) void navigate(detailAddress(key)).catch(() => undefined);
    }

    function onDiscarded() {
      setCreating(false);
    }

    return {
      rootRef, dialogWidth, relationColumns,
      countText, search, creating, createDialog,
      open, startCreate, cancelCreate, onSaved, onDiscarded,
    };
  },
});
