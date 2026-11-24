import { computed } from "vue";
import { mountPanel, usePanelContext, usePanelOutput } from "@ontomato/sdk/panel";

/*
 * Built-in application gallery panel: renders available applications (`platform:Application.available`)
 * and enabled agents (`platform:AgentDefinition.available`) as clickable cards backed by real object
 * identities, with per-card pin/unpin operations synchronized to personal home preferences.
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

    const appsStatus = usePanelOutput("applications", "status");
    const appsCount = usePanelOutput("applications", "loadedCount");
    const agentsStatus = usePanelOutput("agents", "status");
    const agentsCount = usePanelOutput("agents", "loadedCount");

    const showApplications = computed(() => category.value !== "agents");
    const showAgents = computed(() => category.value === "all" || category.value === "agents");

    const appsReadyEmpty = computed(() => appsStatus.value === "ready" && (appsCount.value ?? 0) === 0);
    const agentsReadyEmpty = computed(() => agentsStatus.value === "ready" && (agentsCount.value ?? 0) === 0);

    const showCombinedEmpty = computed(() =>
      category.value === "all" && appsReadyEmpty.value && agentsReadyEmpty.value,
    );
    const hideEmptyApplicationsInAll = computed(() =>
      category.value === "all" && appsReadyEmpty.value,
    );
    const hideEmptyAgentsInAll = computed(() =>
      category.value === "all" && agentsReadyEmpty.value,
    );
    const showSectionHeadings = computed(() =>
      category.value === "all"
      && !hideEmptyApplicationsInAll.value
      && !hideEmptyAgentsInAll.value
      && (appsCount.value ?? 0) > 0
      && (agentsCount.value ?? 0) > 0,
    );
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
      showApplications,
      showAgents,
      showCombinedEmpty,
      hideEmptyApplicationsInAll,
      hideEmptyAgentsInAll,
      showSectionHeadings,
      filtered,
      selectCategory,
      clearFilters,
    };
  },
});
