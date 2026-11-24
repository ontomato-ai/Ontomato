import type { AuthenticatedRequest } from "../../utils/request-identity";
import { requirePanelSkillForRun } from "../../services/product-panels/operations";
import {
  directPanelMemberPathSchema, productPanelNestedReadRequestSchema, productPanelNestedReadResponseSchema, productPanelReadRequestSchema,
  type DirectPanelMemberPath, type ProductPanelReadSource,
} from "@ontomato/contracts/panel-host";
import { readProductPanelData } from "../../services/product-panels/data-reads";
import { readNestedPanel, resolvePanelMemberPath } from "../../services/product-panels/member-path";
import { readCurrentPanelRecord } from "../../services/product-panels/current";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { PROJECTION_REUSE_PANEL_HEADER } from "@ontomato/contracts/product-panels";
import { Router, type Request } from "express";
import { AGENT_DEFINITION, SKILL, MODEL_OPTION, MCP_SERVICE_OPTION, USER, OBJECT_TYPE, ONTOLOGY_TYPE, bindingKey, chartProjectionLookupRead, chartProjectionSourceRead, panelClientReads, scheduledTaskReads } from "@ontomato/contracts/panel-client-requests";
import type {AssistantCredentials} from "../../platform/agent-runtime/runtime";
import { Readable } from "node:stream";
import { z } from "zod";
import { context, wrap } from "../utils/agent-host";
import { proxyResponse } from "../utils/proxy";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import {assistantRetrievalOperationSchema} from "@ontomato/contracts/assistant-retrieval";
import {OntologyRetrievalClient} from "../../services/assistant/ontology-retrieval";
import { credentialsForRun, ownedRun, runForOwner } from "../../services/assistant/execution";
import type { RuntimeCallback } from "../../services/agent-runtime/callback-credential";
import { adoptAppBuilderDefinition, executeAuthoring, type AuthoringOperation } from "../../services/assistant/authoring";
import { authoringAdoptionRequestSchema, authoringKindSchema, authoringOperations } from "@ontomato/contracts/authoring";

export const assistantExecutionRouter = Router();
type RouteRule = {
  methods: readonly string[];
  match: string | RegExp;
};

function matchesRules(rules: readonly RouteRule[], method: string, path: string): boolean {
  return rules.some(rule =>
    rule.methods.includes(method) && (typeof rule.match === "string" ? rule.match === path : rule.match.test(path)),
  );
}

const ontologyReads = [
  "/ontology/query/overview",
  "/action/export",
  "/metricView/export",
  "/admin/getDatasetDesc",
  "/admin/getAllClassNames",
  "/user/getCur",
  "/platform/applications",
];
const ontologyPosts = [
  "/ontology/query/schema",
  "/ontology/query/dsl-reference",
  "/ontology/query/distinct-values",
  "/ontology/query/execute-dsl",
  "/ontology/query/metrics/search",
  "/ontology/query/metrics/recall",
  "/ontology/query/metrics/parameter-form",
  "/ontology/query/metrics/parse-parameters",
  "/ontology/query/metrics/execute",
  "/ontology/query/knowledge/search",
  "/ontology/query/outputs",
  "/action/queryById",
  "/action/queryList",
  "/action/find",
  "/action/form",
  "/action/execute",
  "/action/re-explain",
  "/action/save",
  "/action/delete",
  "/metricView/find",
  "/metricView/test",
  "/metricView/testExecute",
  "/metricView/save",
  "/metricView/delete",
  "/function/save",
  "/function/delete",
  "/workflow/subjects",
  "/workflow/grants",
  "/vectorResource/upload",
  "/vectorResource/delete",
  "/data/queryInfoByNode",
  "/knowledge/findknowledge",
  "/admin/getBussinessKnowledge",
  "/admin/getSchemaByClassName",
  "/admin/getRelationshipByClassNames",
];
const assetReadPaths = [
  "/metricView/queryById",
  "/metricView/queryList",
  "/metricView/form",
  "/function/queryList",
  "/function/queryById",
  "/function/form",
];
const queryOutput = /^\/ontology\/query\/outputs\/[0-9a-f-]+$/u;
const queryOutputCancel = /^\/ontology\/query\/outputs\/[0-9a-f-]+\/cancel$/u;
const governanceAction = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/runs\/[^/]+\/actions\/[^/]+$/u;
const governanceClose = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/skill-runs\/[^/]+\/close$/u;
const ontologyRules: readonly RouteRule[] = [
  { methods: ["GET"], match: queryOutput },
  { methods: ["GET"], match: /^\/platform\/applications\/catalogue\/[^/]+$/u },
  { methods: ["GET", "PUT"], match: /^\/platform\/applications\/(?!catalogue$)[^/]+\/panel-uses$/u },
  { methods: ["PUT"], match: /^\/platform\/applications\/(?!catalogue$)[^/]+\/identity$/u },
  { methods: ["DELETE"], match: /^\/platform\/applications\/(?!catalogue$)[^/]+$/u },
  { methods: ["POST"], match: queryOutputCancel },
  { methods: ["POST"], match: "/ontology/ai/knowledge-governance/skill-runs" },
  { methods: ["POST"], match: governanceAction },
  { methods: ["POST"], match: governanceClose },
];
function ontologyAllowed(method: string, path: string) {
  if (method === "GET" && ontologyReads.includes(path)) return true;
  if (method === "POST" && ontologyPosts.includes(path)) return true;
  return matchesRules(ontologyRules, method, path);
}
const workbenchPath = /^\/api\/(?:panel-operation-intents|product-assets|dashboards|feedback|memories|query-history|preferences|personal-workspace)(?:\/|$)/;
const workbenchRules: readonly RouteRule[] = [
  { methods: ["GET", "POST"], match: workbenchPath },
  { methods: ["PUT", "DELETE"], match: /^\/api\/product-assets\/[^/]+$/u },
  { methods: ["GET"], match: /^\/apps-sdk\/current\/.+$/u },
  { methods: ["GET"], match: "/api/apps-sdk/current" },
  { methods: ["GET"], match: "/api/app-builder/type-table" },
  { methods: ["GET"], match: /^\/api\/component-packages\/(?!install$)(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u },
  { methods: ["GET", "POST"], match: "/api/domain-components" },
  { methods: ["GET", "PUT"], match: /^\/api\/domain-components\/[^/]+$/u },
  { methods: ["GET", "POST"], match: "/api/workspaces" },
  { methods: ["GET", "PATCH", "DELETE"], match: /^\/api\/workspaces\/(?!applications$)[^/]+$/u },
  { methods: ["GET"], match: /^\/api\/workspaces\/(?!applications$)[^/]+\/(?:tree|commits|sessions|releases|files\/content|diff|panel-candidate|build-tests)$/u },
  { methods: ["POST"], match: /^\/api\/workspaces\/(?!applications$)[^/]+\/(?:import|restore|publish|rollback|build-tests)$/u },
  { methods: ["DELETE"], match: /^\/api\/workspaces\/(?!applications$)[^/]+\/build-tests$/u },
  { methods: ["GET", "PUT", "DELETE"], match: /^\/api\/product-panels\/(?!read$|nested-read$|definition-stream$|personal-state$)[^/]+$/u },
  { methods: ["POST"], match: "/api/product-projections/chart-sources" },
  { methods: ["GET", "PUT"], match: /^\/api\/product-projections\/(?!chart-sources$)[^/]+$/u },
  { methods: ["GET"], match: /^\/api\/product-projections\/(?!chart-sources$)[^/]+\/used-by$/u },
];

const skillReadPath = /^\/api\/skills(?:\/[^/]+\/(?:references|files|file))?$/u;
const initiatorPanelReads = [AGENT_DEFINITION, SKILL, ONTOLOGY_TYPE]
  .flatMap(type => panelClientReads(bindingKey({ kind: "PlatformObjectType", id: type })));
const executorPanelReads = [
  ...[MODEL_OPTION, MCP_SERVICE_OPTION, USER, OBJECT_TYPE]
    .flatMap(type => panelClientReads(bindingKey({ kind: "PlatformObjectType", id: type }))),
  ...panelClientReads(bindingKey({ kind: "MetricView", id: "*" })),
  chartProjectionLookupRead,
  chartProjectionSourceRead,
];

async function panelReader(req: Request, runId: string, source: ProductPanelReadSource, memberPath: DirectPanelMemberPath) {
  if (source.kind === "candidate")
    throw new HttpError(400, "A page skill reads a registered application entry", "INVALID_REQUEST");
  const { owner, credentials } = context(req);
  const run = await runForOwner(owner, runId);
  if (!run.channel || run.status !== "running")
    throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if (run.channel.authority.executionKind !== "live")
    throw new HttpError(422, "Page skill reads do not support test data", "BUILD_TEST_UNSUPPORTED");
  const { use } = await requirePanelSkillForRun(owner, credentials, run,
    source.kind === "frame" ? { ...source, root: "frame" } : source);
  const executor = await credentialsForRun(owner, runId, credentials, run.sessionId);
  if (executor.executionUserId !== null) {
    // The execution account may read owner data only through a placement the initiator could actually open.
    const panel = await readCurrentPanelRecord(owner, credentials, use.panelId);
    await resolvePanelMemberPath(owner, credentials, panel, memberPath, use);
  }
  const reader = { ...owner, userId: executor.executionUserId ?? owner.userId };
  const userName = executor.executionUserId === null ? (req as AuthenticatedRequest).userName : undefined;
  return { reader, credentials: executor.credentials, userName };
}

assistantExecutionRouter.post("/:runId/panels/read", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const input = productPanelReadRequestSchema.parse(req.body);
  const { reader, credentials, userName } = await panelReader(req, runId, input.source, input.memberPath);
  res.json(await readProductPanelData(reader, credentials, input, userName));
}));

const assistantNestedPanelReadRequestSchema = productPanelNestedReadRequestSchema.extend({
  memberPath: directPanelMemberPathSchema,
});
assistantExecutionRouter.post("/:runId/panels/nested", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const input = assistantNestedPanelReadRequestSchema.parse(req.body);
  const { reader, credentials } = await panelReader(req, runId, input.source, input.memberPath);
  res.json(productPanelNestedReadResponseSchema.parse(await readNestedPanel(reader, credentials, input)));
}));

assistantExecutionRouter.post("/:runId/retrieval",wrap(async(req,res)=>{
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const operation=assistantRetrievalOperationSchema.parse(req.body);
  const {owner,credentials:initiator}=context(req);
  let credentials:AssistantCredentials=initiator;
  let retrievalScopeId: string | null;
  if(operation.operation==="begin" || operation.operation==="submit" || operation.operation==="submit-metric") {
    const resolved = await credentialsForRun(owner,runId,initiator);
    credentials = resolved.credentials;
    retrievalScopeId = resolved.retrievalScopeId ?? resolved.credentials.headers?.["X-Ontomato-Retrieval-Caller-Id"] ?? null;
  } else {
    const { turn, run } = await ownedRun(owner,runId);
    if(run.status!=="running")throw new HttpError(409,"Execution is closed","RUN_CLOSED");
    retrievalScopeId = turn?.retrieval_scope_id ?? null;
  }
  if (!retrievalScopeId) throw new HttpError(403, "Retrieval scope is unavailable for this run", "FORBIDDEN");
  const value=await new OntologyRetrievalClient(owner,retrievalScopeId,credentials).executeOperation(operation);
  if(operation.operation==="close")res.status(204).end();else res.json(value);
}));

function callbackRun(req: Request, callback: RuntimeCallback | undefined) {
  const runId = z.string().uuid().parse(req.params.runId);
  if (!callback || callback.runId !== runId) throw new HttpError(403, "A run callback is required", "FORBIDDEN");
  return runId;
}

for (const kind of ["action", "metric-view"] as const) {
  for (const [name, operation] of Object.entries(authoringOperations[kind])) {
    assistantExecutionRouter[operation.method === "GET" ? "get" : "post"](
      "/:runId/authoring" + operation.path,
      wrap(async (req, res) => {
        const runId = callbackRun(req, res.locals.runtimeCallback);
        const { owner, credentials } = context(req);
        const input = "body" in operation ? operation.body.parse(req.body)
          : "params" in operation ? operation.params.parse({ executionId: req.params.executionId }) : {};
        const result = await executeAuthoring(owner, credentials, runId, kind, name as AuthoringOperation, input);
        res.json(operation.response.parse(result));
      }),
    );
  }
}

assistantExecutionRouter.post("/:runId/authoring/:kind/adopt", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const kind = authoringKindSchema.parse(req.params.kind);
  const { definition } = authoringAdoptionRequestSchema.shape.input.parse(req.body);
  const { owner, credentials } = context(req);
  res.json(await adoptAppBuilderDefinition(owner, credentials, runId, kind, definition));
}));

assistantExecutionRouter.all("/:runId/:target/*", wrap(async (req, res) => {
  const callback = res.locals.runtimeCallback as RuntimeCallback;
  const runId = callbackRun(req, callback);
  const target = z.enum(["ontology", "workbench"]).parse(req.params.target);
  const path = "/" + req.params[0];
  const canonicalPath = !req.path.includes("%");
  const workbenchResource = target === "workbench" && canonicalPath && path.startsWith("/api/");
  const initiatorResourceRead = workbenchResource && (
    (req.method === "GET" && skillReadPath.test(path)) ||
    initiatorPanelReads.some(read => read.service === "" && read.method === req.method && read.path.test(path.slice(4)))
  );
  const executorResourceRead = target === "ontology"
    ? canonicalPath && (
      (req.method === "POST" && assetReadPaths.includes(path)) ||
      [...scheduledTaskReads, ...executorPanelReads].some(
        read => read.service === "/data-query" && read.method === req.method && read.path.test(path),
      )
    )
    : workbenchResource && executorPanelReads.some(
      read => read.service === "" && read.method === req.method && read.path.test(path.slice(4)),
    );
  const resourceRead = initiatorResourceRead || executorResourceRead;
  const assistantDirectory = target === "workbench" && req.method === "GET" && path === "/api/assistant/agents";
  if (/[\\%?#]/u.test(path) || path.split("/").some(segment => segment === "." || segment === "..") ||
    !(resourceRead || assistantDirectory || (target === "ontology" ? ontologyAllowed(req.method, path) : matchesRules(workbenchRules, req.method, path))))
    throw new HttpError(403, "Path is outside the execution callback", "FORBIDDEN");
  const { owner, credentials: initiatorCredentials } = context(req);
  const grantAction=target==="ontology" && callback.businessGrant && governanceAction.test(path);
  const ownership = assistantDirectory || target === "workbench" && /^\/api\/(?:panel-operation-intents|feedback|query-history|product-assets|memories|preferences|personal-workspace)(?:\/|$)/u.test(path);
  let credentials: AssistantCredentials = initiatorCredentials;
  let retrievalScopeId: string | null = null;
  if (initiatorResourceRead || ownership || grantAction) {
    if (target === "ontology") {
      const { turn, run } = await ownedRun(owner, runId);
      if (initiatorResourceRead && (!run.channel || run.status !== "running")) {
        throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
      }
      retrievalScopeId = turn?.retrieval_scope_id ?? null;
    } else {
      const run = await runForOwner(owner, runId);
      if (initiatorResourceRead && (!run.channel || run.status !== "running")) {
        throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
      }
    }
  } else {
    const resolved = await credentialsForRun(owner, runId, initiatorCredentials);
    credentials = resolved.credentials;
    retrievalScopeId = resolved.retrievalScopeId ?? resolved.credentials.headers?.["X-Ontomato-Retrieval-Caller-Id"] ?? null;
  }
  const headers = buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers);
  if (callback.businessGrant && !resourceRead && !assistantDirectory) {
    headers.tk = callback.businessGrant;
    delete headers["X-API-Key"];
  }
  headers["X-Ontomato-Run-Id"] = runId;
  if (retrievalScopeId) headers["X-Ontomato-Retrieval-Caller-Id"] = retrievalScopeId;
  else delete headers["X-Ontomato-Retrieval-Caller-Id"];
  const executionContext = req.header(BUILD_TEST_HEADER);
  if (executionContext !== undefined) headers[BUILD_TEST_HEADER] = executionContext;
  const reusePanel = req.header(PROJECTION_REUSE_PANEL_HEADER);
  if (reusePanel !== undefined) headers[PROJECTION_REUSE_PANEL_HEADER] = reusePanel;
  const origin = target === "ontology" ? config.dataQuery.baseUrl : environment.agentRuntime().callbackUrl;
  const upstreamPath = target === "workbench" && path.startsWith("/api/component-packages/")
    ? "/api/component-packages/" + encodeURIComponent(path.slice("/api/component-packages/".length))
    : path;
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  let body: string | ReadableStream<Uint8Array> | undefined;
  if (req.method !== "GET") {
    if (req.is("multipart/form-data")) {
      headers["Content-Type"] = req.headers["content-type"]!;
      body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    } else body = JSON.stringify(req.body);
  }
  const response = await fetch(origin.replace(/\/$/u, "") + upstreamPath + query, {
    method: req.method, headers, body, redirect: "error", ...(body instanceof ReadableStream ? {duplex:"half"} : {}),
  } as NonNullable<Parameters<typeof fetch>[1]>);
  await proxyResponse(response, res);
}));
