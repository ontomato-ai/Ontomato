import { EXECUTION_CONTEXT_HEADER, PREVIEW_WRITE_FORBIDDEN, PREVIEW_WRITE_MESSAGE } from "@ontomato/contracts/execution-context";
import { AGENT_DEFINITION, SKILL, bindingKey, panelClientReads } from "@ontomato/contracts/panel-client-requests";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/errors";

type Access = readonly [method: string, path: RegExp];

/**
 * Sandboxed trial and generation operations an app-builder agent may reach through the scoped
 * assistant proxy in a preview run. Action execution itself is not here: it stays refused at
 * the Java boundary. Reads are live everywhere; this list is about write-shaped entries.
 */
const assistantPreviewOperations = new Set([
  "/action/trial", "/action/setStatus", "/action/re-explain",
  "/function/save", "/function/delete",
  "/metricView/save", "/metricView/test", "/metricView/testExecute",
  "/ontology/query/distinct-values", "/ontology/query/execute-dsl",
]);

export function isAssistantPreviewOperation(method: string, path: string): boolean {
  return method === "POST" && assistantPreviewOperations.has(path);
}

/**
 * Node routes that a preview request may reach. Only reads of definitions, metadata and
 * identity, plus parameter conversion, are declared here; everything else is a write a
 * preview must not execute. The scoped assistant proxy admits generation operations
 * enforced by their Java owner.
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
  // product-panels.ts: current product definitions and live panel data reads, never registration writes
  ["GET", /^\/product-(?:panels|projections)\/[^/]+$/],
  ["POST", /^\/product-panels\/read$/],
  ["POST", /^\/product-panels\/read-batch$/],
  ["POST", /^\/product-panels\/nested$/],
  // product-panels.ts: registered operation metadata reads
  ["GET", /^\/panel-operations\/descriptor$/],
  ["POST", /^\/panel-operations\/read$/],
  // dashboards.ts: definition reads and metric parameter conversion, not card data execution
  ["GET", /^\/dashboards$/],
  ["GET", /^\/dashboards\/[^/]+$/],
  ["POST", /^\/dashboards\/groups$/],
  ["POST", /^\/dashboards\/card-parameter-form$/],
  // schedule-applications.ts: forms and parameter validation, not a run
  ["POST", /^\/platform\/schedule-applications\/[^/]+\/(?:form|validate)$/],
  // workspaces.ts: workspace metadata and files, not publish or start
  ["GET", /^\/workspaces(?:\/.*)?$/],
];

function isAllowed(method: string, path: string): boolean {
  const generation = /^\/assistant\/executions\/[0-9a-f-]{36}\/ontology\/ontology\/ai\/generation(?:\/.*)?$/iu.test(path);
  if (generation) return true;
  const callback = /^\/assistant\/executions\/[0-9a-f-]{36}\/ontology(\/.*)$/iu.exec(path);
  if (callback && isAssistantPreviewOperation(method, callback[1]!)) return true;
  return ALLOWED.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path));
}

/**
 * Default refusal for Node business entries. A request that carries the preview header may
 * continue only when a route declaration above accepts it; the Java guard owns Java entries.
 * Reads are unaffected: every declared entry serves live data exactly as without the header.
 */
export const previewAccess: RequestHandler = (req, _res, next) => {
  if (req.header(EXECUTION_CONTEXT_HEADER) === undefined || isAllowed(req.method, req.path)) {
    next();
    return;
  }
  next(new HttpError(422, PREVIEW_WRITE_MESSAGE, PREVIEW_WRITE_FORBIDDEN));
};
