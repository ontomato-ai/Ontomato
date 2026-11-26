import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { mountPanel, panelAddress, usePanelBack, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Base components (platform:SDKComponent, read-only catalogue).
 *
 * Renders a full-width searchable ObjectList table catalog that switches in place into a full-width detail view when
 * a component is chosen or deep-linked via `?selected=`. Catalog view stays mounted with `v-show` and restores the
 * enclosing scroll container's position and search keyword on return. Detail view coordinates readiness solely through
 * ObjectHeader's read-only `status` and `errorMessage` outputs so missing components explain themselves in place
 * without mounting the meaning card or the five detail tables.
 */

/** The capability map's type mode, opened at the platform's SDK component class. */
const CAPABILITY_MAP = "/ontology/assets/capability-map";
const COMPONENT_CLASS = "platform:SDKComponent";

/** Locate the nearest scrollable ancestor of the panel root, falling back to the document scrolling element. */
function findScrollContainer(start) {
  let node = start?.parentElement ?? null;
  let firstOverflowAncestor = null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = typeof window !== "undefined" ? window.getComputedStyle(node).overflowY : "";
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      if (!firstOverflowAncestor) firstOverflowAncestor = node;
      if (node.scrollHeight > node.clientHeight || node.scrollTop > 0) return node;
    }
    node = node.parentElement;
  }
  return firstOverflowAncestor ?? document.scrollingElement ?? document.documentElement;
}

await mountPanel({
  setup() {
    const { instance, navigate, t } = usePanelContext();
    const rootRef = ref(null);
    const navigateError = ref("");

    const search = computed({
      get: () => String(instance.state.values.value.search ?? ""),
      set: (value) => instance.state.set("search", value || null),
    });

    // `catalogue` declares server-side `search`, so ObjectList leaves `filteredCount` null and reports `loadedCount`.
    const filteredCount = usePanelOutput("list", "filteredCount");
    const loadedCount = usePanelOutput("list", "loadedCount");
    const visibleCount = computed(() => filteredCount.value ?? loadedCount.value);
    const countText = computed(() => (visibleCount.value === null ? "" : t("components.count", { count: visibleCount.value })));

    const selected = computed(() => instance.state.values.value.selected ?? null);
    const selectedKey = computed(() => selected.value?.primaryKey ?? "");

    // Read-only readiness signals from ObjectHeader; detail sections mount once the selected component resolves.
    const headerStatus = usePanelOutput("header", "status");
    const headerError = usePanelOutput("header", "errorMessage");
    const recordStatus = computed(() => (selectedKey.value ? (headerStatus.value ?? "loading") : "empty"));
    const recordReady = computed(() => recordStatus.value === "ready");
    const missingDescription = computed(() => headerError.value || t("detail.notFound", { id: selectedKey.value }));

    let savedScrollContainer = null;
    let savedScrollTop = 0;
    let scrollCaptured = false;
    let restoreFrameId = null;

    function cancelPendingRestore() {
      if (restoreFrameId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(restoreFrameId);
      }
      restoreFrameId = null;
    }

    function captureCatalogScroll() {
      const container = findScrollContainer(rootRef.value);
      savedScrollContainer = container;
      savedScrollTop = container ? container.scrollTop : 0;
    }

    function open(reference) {
      if (!reference?.primaryKey) return;
      captureCatalogScroll();
      scrollCaptured = true;
      instance.state.set("selected", { className: COMPONENT_CLASS, primaryKey: reference.primaryKey });
    }

    // Clear only `selected` when returning so the catalog keeps its search keyword and filtered results intact.
    function backToCatalog() {
      instance.state.set("selected", null);
    }

    const { back } = usePanelBack(() => Boolean(selectedKey.value), backToCatalog, { pushHistory: true });

    watch(selectedKey, async (next, prev) => {
      navigateError.value = "";
      cancelPendingRestore();
      if (next) {
        if (!prev && !scrollCaptured) captureCatalogScroll();
        scrollCaptured = false;
        await nextTick();
        if (!selectedKey.value) return;
        const container = savedScrollContainer ?? findScrollContainer(rootRef.value);
        if (container) container.scrollTop = 0;
      } else if (prev) {
        const container = savedScrollContainer ?? findScrollContainer(rootRef.value);
        const top = savedScrollTop;
        await nextTick();
        if (selectedKey.value || !container) return;
        container.scrollTop = top;
        if (typeof requestAnimationFrame === "function") {
          restoreFrameId = requestAnimationFrame(() => {
            restoreFrameId = null;
            if (!selectedKey.value && container) container.scrollTop = top;
          });
        }
      }
    });

    onBeforeUnmount(cancelPendingRestore);

    async function openComponentClass() {
      navigateError.value = "";
      try {
        await navigate(panelAddress(CAPABILITY_MAP, { mode: "type", selectedType: COMPONENT_CLASS }));
      } catch (error) {
        navigateError.value = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      rootRef,
      search,
      countText,
      selectedKey,
      recordStatus,
      recordReady,
      missingDescription,
      navigateError,
      open,
      back,
      openComponentClass,
      refresh: () => instance.refreshObjects(),
    };
  },
});
