import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import type { RouteRecordRaw } from "vue-router";

const placeholder = () => import("./views/ObservePlaceholder.vue");

/*
 * The /observe root and its child addresses. Each app assembles its own root: an app may add auth/permission meta and
 * its own shell; the open-source root has no meta. ObserveLayout renders the page an address names (turn evidence,
 * automatic tests, live logs, DSL, knowledge) inside the agent shell, so every child is a neutral placeholder; the
 * addresses exist for deep links and for the shell's browser history.
 */
export const observeRoutes = {
  root: {
    ...routes.ops,
    redirect: routes.diagnosis.path,
    component: () => import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.ObserveLayout),
  },
  children: [
    { ...routes.diagnosis, component: placeholder },
    { ...routes.opsKnowledge, component: placeholder },
    { ...routes.turn, component: placeholder },
    { ...routes.turnDetail, component: placeholder },
    { ...routes.logs, component: placeholder },
    { ...routes.test, component: placeholder },
    { ...routes.results, component: placeholder },
    { ...routes.cases, component: placeholder },
    { ...routes.caseDetail, component: placeholder },
    { ...routes.dsl, component: placeholder },
  ] satisfies RouteRecordRaw[],
};
