import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import type { RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

export interface ObserveRouteOptions {
  /** Override for the diagnosis conversation route (`/ops/diagnosis`), used by tests. */
  component?: PageComponent;
  meta?: RouteMeta;
  props?: Record<string, unknown>;
}

const diagnosisPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.ObserveLayout);
const autotestPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.AutotestPage);
const liveLogsPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.LiveLogsPage);

/**
 * Native operations diagnosis routes still awaiting Batch 2 panel migration, plus legacy deep-link redirects to the
 * migrated built-in panels (`/ops/turn`, `/ops/cases`, `/ops/results`, `/ops/autotest/case`, `/ops/dsl`, `/ops/knowledge`, `/ops/feedback`).
 * Every route renders inside the shared platform application frame (`builtin-product-platform-frame`).
 */
export function observePageRoutes(options: ObserveRouteOptions = {}): RouteRecordRaw[] {
  const baseMeta: RouteMeta = { ...options.meta, ownHeader: true };
  const routeProps = options.props;
  return [
    { ...routes.ops, redirect: routes.turn.path },
    {
      ...routes.diagnosis,
      component: options.component ?? diagnosisPage,
      ...(routeProps ? { props: routeProps } : {}),
      meta: { ...baseMeta, page: routes.diagnosis.path },
    },
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
      meta: { ...baseMeta, page: routes.test.path },
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
      meta: { ...baseMeta, page: routes.logs.path },
    },
  ];
}

export const observeRoutes = {
  root: {
    ...routes.ops,
    redirect: routes.turn.path,
    component: diagnosisPage,
  },
};
