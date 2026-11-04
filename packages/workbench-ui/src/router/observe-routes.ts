import type { RouteRecordRaw } from "vue-router";

const placeholder = () => import("../views/observe/ObservePlaceholder.vue");

/*
 * The /observe root and its child addresses. Each app assembles its own root: an app may add auth/permission meta and
 * its own shell; the open-source root has no meta. ObserveLayout renders the page an address names (turn evidence,
 * automatic tests, live logs, DSL, knowledge) inside the agent shell, so every child is a neutral placeholder; the
 * addresses exist for deep links and for the shell's browser history.
 */
export const observeRoutes = {
  root: {
    path: "/observe",
    component: () => import("../features/diagnosis/components/layout/ObserveLayout.vue"),
  },
  children: [
    { path: "", redirect: "/observe/diagnosis" },
    { path: "diagnosis", name: "ObserveDiagnosis", component: placeholder },
    { path: "knowledge", name: "ObserveKnowledge", component: placeholder },
    { path: "turn", name: "ObserveTurn", component: placeholder },
    { path: "turn/:turnKey", name: "ObserveTurnDetail", component: placeholder },
    { path: "live-logs", name: "ObserveLiveLogs", component: placeholder },
    { path: "test", name: "ObserveTest", component: placeholder },
    { path: "results", name: "ObserveResults", component: placeholder },
    { path: "cases", name: "ObserveCases", component: placeholder },
    { path: "autotest/runs/:runId/cases/:caseId", name: "ObserveAutoTestCaseDetail", component: placeholder },
    { path: "dsl", name: "ObserveDsl", component: placeholder },
  ] satisfies RouteRecordRaw[],
};
