import { BUILD_TEST_HEADER, BUILD_TEST_UNSUPPORTED } from "@ontomato/contracts/build-tests";
import { AGENT_DEFINITION, SKILL, bindingKey, panelClientReads } from "@ontomato/contracts/panel-client-requests";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/errors";

type Access = readonly [method: string, path: RegExp];

const assistantBuildTestOperations = new Set([
  "/action/execute", "/metricView/execute", "/metricView/test", "/metricView/testExecute",
  "/vectorResource/upload", "/vectorResource/delete", "/ontology/query/distinct-values", "/ontology/query/execute-dsl",
]);

export function isAssistantBuildTestOperation(method: string, path: string): boolean {
  return method === "POST" && assistantBuildTestOperations.has(path);
}

/**
 * Node routes that a build-test request may reach. Only reads of definitions, metadata and
 * identity, plus parameter conversion and test-context status, are declared here.
 * The scoped assistant proxy also admits test operations enforced by their Java owner.
 *
 * The declaration is owned by the route module named in each group; adding a route that may
 * receive a preview header means adding its entry here in the same change.
 */
const ALLOWED: readonly Access[] = [
  // preferences.ts, platform-home.ts, workbench-appearance.ts, personal-workspace.ts
  ["GET", /^\/preferences$/],
  ["GET", /^\/platform\/home$/],
  ["GET", /^\/workbench-appearance$/],
  ["GET", /^\/personal-workspace\/recent$/],
  // query-history.ts, feedback.ts, observe routes
  ["GET", /^\/query-history(?:\/.*)?$/],
  ["GET", /^\/feedback(?:\/.*)?$/],
  ["GET", /^\/observe(?:\/.*)?$/],
  // skills.ts, mcp.ts: definitions and parameter forms, not skill or MCP execution
  ["GET", /^\/skills(?:\/.*)?$/],
  ["GET", /^\/mcp(?:\/.*)?$/],
  // assistant.ts: agent definitions and the skill catalogue, including semantic read-only POSTs
  ...[AGENT_DEFINITION, SKILL].flatMap(type => panelClientReads(bindingKey({ kind: "PlatformObjectType", id: type }))
    .map(({ method, path }) => [method, path] as const)),
  // app-builder.ts: builder and SDK metadata
  ["GET", /^\/app-builder\/bootstrap$/],
  ["GET", /^\/apps-sdk\/current$/],
  // product-panels.ts: current product definitions, never business reads or registration writes
  ["GET", /^\/product-(?:panels|projections)\/[^/]+$/],
  ["POST", /^\/product-panels\/read$/],
  ["POST", /^\/product-panels\/read-batch$/],
  ["POST", /^\/product-panels\/nested$/],
  // product-panels.ts: registered operation metadata and owner-routed trials with the preview context
  ["GET", /^\/panel-operations\/descriptor$/],
  ["POST", /^\/panel-operations\/read$/],
  // dashboards.ts /add-chart-file stays unsupported: imports may settle metrics.
  // dashboards.ts: definition reads and metric parameter conversion, not card data execution
  ["GET", /^\/dashboards$/],
  ["GET", /^\/dashboards\/[^/]+$/],
  ["POST", /^\/dashboards\/groups$/],
  ["POST", /^\/dashboards\/card-parameter-form$/],
  // schedule-applications.ts: forms and parameter validation, not a run
  ["POST", /^\/platform\/schedule-applications\/[^/]+\/(?:form|validate)$/],
  // workspaces.ts: workspace metadata, files and test-context status, not publish or start
  ["GET", /^\/workspaces(?:\/.*)?$/],
];

function isAllowed(method: string, path: string): boolean {
  const callback = /^\/assistant\/executions\/[0-9a-f-]{36}\/ontology(\/.*)$/iu.exec(path);
  if (callback && isAssistantBuildTestOperation(method, callback[1]!)) return true;
  return ALLOWED.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path));
}

/**
 * Default refusal for Node business entries. A request that carries the preview header may
 * continue only when a route declaration above accepts it; the Java guard owns Java entries.
 */
export const buildTestAccess: RequestHandler = (req, _res, next) => {
  if (req.header(BUILD_TEST_HEADER) === undefined || isAllowed(req.method, req.path)) {
    next();
    return;
  }
  next(new HttpError(422, "This interface does not support test data", BUILD_TEST_UNSUPPORTED));
};
