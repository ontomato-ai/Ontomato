import { BUILD_TEST_HEADER, BUILD_TEST_UNSUPPORTED } from "@ontomato/contracts/build-tests";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/errors";

type Access = readonly [method: string, path: RegExp];

/**
 * Node routes that a build-test request may reach. Only reads of definitions, metadata and
 * identity, plus parameter conversion and test-context status, are declared here. Writes,
 * executions and anything that can read live business data stay out and are refused below.
 *
 * The declaration is owned by the route module named in each group; adding a route that may
 * receive a preview header means adding its entry here in the same change.
 */
const ALLOWED: readonly Access[] = [
  // preferences.ts, platform-home.ts, workbench-appearance.ts, personal-workspace.ts
  ["GET", /^\/preferences$/],
  ["GET", /^\/platform\/home$/],
  ["GET", /^\/workbench-appearance$/],
  ["GET", /^\/personal-workspace(?:\/recent)?$/],
  // query-history.ts, feedback.ts, observe routes
  ["GET", /^\/query-history(?:\/.*)?$/],
  ["GET", /^\/feedback(?:\/.*)?$/],
  ["GET", /^\/observe(?:\/.*)?$/],
  // skills.ts, mcp.ts: definitions and parameter forms, not skill or MCP execution
  ["GET", /^\/skills(?:\/.*)?$/],
  ["POST", /^\/skills\/[^/]+\/render$/],
  ["GET", /^\/mcp(?:\/.*)?$/],
  // app-builder.ts: builder and SDK metadata
  ["GET", /^\/app-builder\/bootstrap$/],
  ["GET", /^\/apps-sdk\/current$/],
  // dashboards.ts: definition reads and metric parameter conversion, not card data execution
  ["GET", /^\/dashboards$/],
  ["GET", /^\/dashboards\/[^/]+$/],
  ["POST", /^\/dashboards\/groups$/],
  ["POST", /^\/dashboards\/query-by-id$/],
  ["POST", /^\/dashboards\/card-parameter-form$/],
  // schedule-applications.ts: description and parameter validation, not a run
  ["GET", /^\/platform\/schedule-applications\/[^/]+$/],
  ["POST", /^\/platform\/schedule-applications\/[^/]+\/(?:form|validate)$/],
  // workspaces.ts: workspace metadata, files and test-context status, not publish or start
  ["GET", /^\/workspaces(?:\/.*)?$/],
];

function isAllowed(method: string, path: string): boolean {
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
