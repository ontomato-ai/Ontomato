import { computed, ref } from "vue";
import { mountPanel, usePanelContext, usePanelNarrow, usePanelOutput } from "@ontomato/sdk/panel";

const COUNTS = new Map([
  ["/applications/app-academic-planner/courses", "courses"],
  ["/applications/app-academic-planner/enrollments", "enrollments"],
]);

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    const root = ref(null);
    const narrow = usePanelNarrow(root);
    const term = computed({
      get: () => instance.state.values.value.term,
      set: (value) => instance.state.set("term", value),
    });
    const totals = [...COUNTS].map(([path, member]) => [path, usePanelOutput(member, "total")]);
    const trailingText = computed(() => Object.fromEntries(totals
      .filter(([, total]) => total.value !== null)
      .map(([path, total]) => [path, String(total.value)])));
    return { root, narrow, term, trailingText, countMember: (path) => COUNTS.get(path) };
  },
});
