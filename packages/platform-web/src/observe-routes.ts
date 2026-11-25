import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { turnDiagnosisPrefill } from "@ontomato/workbench-ui";
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
 * Native operations diagnosis routes still awaiting Batch 2 panel migration, plus legacy deep-link redirects to the
 * unified agent platform (`/ops/diagnosis` -> `/agents/chat`) and migrated built-in panels (`/ops/turn`, `/ops/results`,
 * `/ops/autotest/case`, `/ops/dsl`, `/ops/knowledge`, `/ops/feedback`).
 * Every route renders inside the shared platform application frame (`builtin-product-platform-frame`).
 */
export function observePageRoutes(options: ObserveRouteOptions = {}): RouteRecordRaw[] {
  const baseMeta: RouteMeta = { ...options.meta, ownHeader: true };
  return [
    { ...routes.ops, redirect: routes.turn.path },
    {
      ...routes.diagnosis,
      redirect: (to) => {
        const sourceSessionId = typeof to.query.sourceSessionId === "string" ? to.query.sourceSessionId : "";
        const sourceRunId = typeof to.query.sourceRunId === "string" ? to.query.sourceRunId : "";
        const sessionId = typeof to.query.sessionId === "string" ? to.query.sessionId : "";
        const query: Record<string, string> = { agentKind: OPS_DIAGNOSIS_KIND };
        if (to.query.diagnose === "1" && sourceSessionId && sourceRunId) {
          query.prefill = turnDiagnosisPrefill(sourceSessionId, sourceRunId);
        } else if (sessionId) {
          query.sessionId = sessionId;
        }
        return { path: routes.chat.path, query };
      },
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
      ...routes.cases,
      component: autotestPage,
      meta: { ...baseMeta, page: routes.cases.path },
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
  },
};
