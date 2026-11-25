import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

/*
 * Built-in application gallery panel: renders available applications (`platform:Application`) and
 * enabled agents (`platform:AgentDefinition`) in one continuous card grid via
 * `platform:Application.available`, with per-card pin/unpin operations synchronized to personal
 * home preferences.
 */

const CATEGORIES = ["all", "business", "agents", "build", "admin"];

await mountPanel({
  setup() {
    const { instance, t } = usePanelContext();

    const category = computed(() => {
      const value = instance.state.values.value.category;
      return typeof value === "string" && CATEGORIES.includes(value) ? value : "all";
    });

    const searchText = computed({
      get: () => {
        const value = instance.state.values.value.search;
        return typeof value === "string" ? value : "";
      },
      set: (value) => {
        const next = typeof value === "string" ? value : "";
        instance.state.set("search", next === "" ? null : next);
      },
    });

    const filtered = computed(() => category.value !== "all" || searchText.value.trim() !== "");

    function selectCategory(next) {
      instance.state.set("category", next);
    }

    function clearFilters() {
      instance.state.set("category", "all");
      instance.state.set("search", null);
    }

    return {
      t,
      categories: CATEGORIES,
      category,
      searchText,
      filtered,
      selectCategory,
      clearFilters,
    };
  },
});
