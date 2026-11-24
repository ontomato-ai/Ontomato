import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import type { RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

export interface ObserveRouteOptions {
  /** Override for the diagnosis conversation route (`/ops/diagnosis`), used by tests. */
  component?: PageComponent;
  /** Edition-specific override for the DSL execution page (`/ops/dsl`), e.g. enterprise MQL tab. */
  dslComponent?: PageComponent;
  meta?: RouteMeta;
  props?: Record<string, unknown>;
}

const diagnosisPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.ObserveLayout);
const turnEvidencePage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.TurnEvidencePage);
const autotestPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.AutotestPage);
const liveLogsPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.LiveLogsPage);
const dslTestPage: PageComponent = () =>
  import("@ontomato/workbench-ui/features/diagnosis").then((module) => module.DslTestPage);

/**
 * Native operations diagnosis routes still awaiting panel migration. Every route renders directly inside the shared
 * platform application frame (`builtin-product-platform-frame`) alongside already-migrated panel entries such as
 * `/ops/knowledge` and `/ops/feedback`, so the application keeps one menu and one persistent outer frame.
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
      ...routes.turn,
      component: turnEvidencePage,
      meta: { ...baseMeta, page: routes.turn.path },
    },
    {
      ...routes.turnDetail,
      component: turnEvidencePage,
      meta: { ...baseMeta, page: routes.turn.path },
    },
    {
      ...routes.test,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.test.path },
    },
    {
      ...routes.results,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.results.path },
    },
    {
      ...routes.cases,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.cases.path },
    },
    {
      ...routes.caseDetail,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.results.path },
    },
    {
      ...routes.logs,
      component: liveLogsPage,
      meta: { ...baseMeta, page: routes.logs.path },
    },
    {
      ...routes.dsl,
      component: options.dslComponent ?? dslTestPage,
      meta: { ...baseMeta, page: routes.dsl.path },
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
