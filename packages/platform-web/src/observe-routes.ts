import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import type { RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

export interface ObserveRouteOptions {
  meta?: RouteMeta;
  props?: Record<string, unknown>;
}

const autotestPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.AutotestPage);
const liveLogsPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.LiveLogsPage);

/**
 * Native operations diagnosis routes still awaiting Batch 2 panel migration (`/ops/test`, `/ops/live-logs`), plus
 * legacy parameterised detail redirects (`/ops/turn/:turnKey`, `/ops/autotest/runs/:runId/cases/:caseId`) and the
 * `/ops` root redirect to the frame-conversation entry (`/ops/diagnosis`).
 * Every route renders inside the dedicated operations application frame (`builtin-product-ops-frame`).
 */
export function observePageRoutes(options: ObserveRouteOptions = {}): RouteRecordRaw[] {
  const baseMeta: RouteMeta = { ...options.meta, ownHeader: true };
  return [
    {
      ...routes.turnDetail,
      redirect: (to) => {
        const turnKey = typeof to.params.turnKey === "string" ? to.params.turnKey : "";
        return turnKey
          ? { path: routes.turn.path, query: { ...to.query, selected: turnKey } }
          : { path: routes.turn.path };
      },
    },
    {
      ...routes.test,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.test.path, entryPath: routes.test.path },
    },
    {
      ...routes.caseDetail,
      redirect: (to) => {
        const runId = typeof to.params.runId === "string" ? to.params.runId : "";
        const caseId = typeof to.params.caseId === "string" ? to.params.caseId : "";
        return runId && caseId
          ? { path: "/ops/autotest/case", query: { ...to.query, selected: `${runId}::${caseId}` } }
          : { path: routes.results.path };
      },
    },
    {
      ...routes.logs,
      component: liveLogsPage,
      meta: { ...baseMeta, page: routes.logs.path, entryPath: routes.logs.path },
    },
  ];
}

export const observeRoutes = {
  root: {
    ...routes.ops,
    redirect: routes.diagnosis.path,
  },
};
