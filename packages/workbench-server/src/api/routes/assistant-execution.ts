import type { AuthenticatedRequest } from "../../utils/request-identity";
import { createPanelOperationIntentRequestSchema, dispatchPanelOperationIntentRequestSchema, panelOperationRefSchema } from "@ontomato/contracts/panel-agent";
import { operatePanel, dispatchPanel, rejectPanelEventForRun, requirePanelSkillForRun } from "../../services/product-panels/operations";
import { productPanelReadRequestSchema } from "@ontomato/contracts/panel-host";
import { readProductPanelData } from "../../services/product-panels/data-reads";
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
import { credentialsForRun, runForOwner } from "../../services/assistant/execution";
import type { RuntimeCallback } from "../../services/agent-runtime/callback-credential";
import { adoptAppBuilderDefinition, executeAuthoring, type AuthoringOperation } from "../../services/assistant/authoring";
import { authoringAdoptionRequestSchema, authoringKindSchema, authoringOperations } from "@ontomato/contracts/authoring";

export const assistantExecutionRouter = Router();
const ontologyReads = [
  "/ontology/query/overview",
  "/action/export",
  "/metricView/export",
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
  "/metricView/find",
  "/metricView/test",
  "/metricView/testExecute",
  "/data/queryInfoByNode",
  "/knowledge/findknowledge",
  "/admin/getBussinessKnowledge",
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
const governanceRead = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/(?:work|sources\/[^/]+)$/u;
const governanceAction = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/runs\/[^/]+\/actions\/[^/]+$/u;
const governanceClose = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/skill-runs\/[^/]+\/close$/u;
function ontologyAllowed(method: string, path: string) {
  if (method === "GET") return ontologyReads.includes(path) || queryOutput.test(path) || governanceRead.test(path);
  if (method === "POST") {
    return ontologyPosts.includes(path) ||
      queryOutputCancel.test(path) ||
      path === "/ontology/ai/knowledge-governance/skill-runs" ||
      governanceAction.test(path) || governanceClose.test(path);
  }
  return false;
}
const workbenchPath = /^\/api\/(?:panel-operation-intents|product-assets|dashboards|feedback|memories|query-history|preferences|personal-workspace)(?:\/|$)/;

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

assistantExecutionRouter.post("/:runId/panels/operate",wrap(async(req,res)=>{
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const {owner,credentials}=context(req);
  const input = createPanelOperationIntentRequestSchema.safeParse(req.body);
  if (!input.success) {
    // Events have no owner call target. Resolve their scope separately so the caller can receive the event guidance.
    const ref = panelOperationRefSchema.strip().safeParse(req.body);
    if (ref.success) await rejectPanelEventForRun(owner, credentials, runId, ref.data);
    throw input.error;
  }
  res.json(await operatePanel(owner, credentials, runId, input.data, (req as AuthenticatedRequest).userName));
}));
assistantExecutionRouter.post("/:runId/panels/intents/:intentId/dispatch",wrap(async(req,res)=>{
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const intentId = z.string().uuid().parse(req.params.intentId);
  dispatchPanelOperationIntentRequestSchema.parse(req.body);
  const {owner,credentials}=context(req);
  res.json(await dispatchPanel(owner,credentials,runId,intentId));
}));

assistantExecutionRouter.post("/:runId/panels/read", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const input = productPanelReadRequestSchema.parse(req.body);
  if (input.source.kind !== "registered")
    throw new HttpError(400, "A page skill reads a registered application entry", "INVALID_REQUEST");
  const { owner, credentials } = context(req);
  const run = await runForOwner(owner, runId);
  if (!run.channel || run.status !== "running")
    throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if (run.channel.authority.executionKind !== "live")
    throw new HttpError(422, "Page skill reads do not support test data", "BUILD_TEST_UNSUPPORTED");
  await requirePanelSkillForRun(owner, credentials, run, input.source);
  const executor = await credentialsForRun(owner, runId, credentials, run.sessionId);
  const reader = { ...owner, userId: executor.executionUserId ?? owner.userId };
  const userName = executor.executionUserId === null ? (req as AuthenticatedRequest).userName : undefined;
  res.json(await readProductPanelData(reader, executor.credentials, input, userName));
}));

assistantExecutionRouter.post("/:runId/retrieval",wrap(async(req,res)=>{
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const operation=assistantRetrievalOperationSchema.parse(req.body);
  const {owner,credentials:initiator}=context(req);
  let credentials:AssistantCredentials=initiator;
  if(operation.operation==="begin" || operation.operation==="submit" || operation.operation==="submit-metric")credentials=(await credentialsForRun(owner,runId,initiator)).credentials;
  else {
    const run=await runForOwner(owner,runId);
    if(run.status!=="running")throw new HttpError(409,"Execution is closed","RUN_CLOSED");
  }
  const value=await new OntologyRetrievalClient(owner,runId,credentials).executeOperation(operation);
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
    !(resourceRead || assistantDirectory || (target === "ontology" ? ontologyAllowed(req.method, path) : workbenchPath.test(path))))
    throw new HttpError(403, "Path is outside the execution callback", "FORBIDDEN");
  const { owner, credentials: initiatorCredentials } = context(req);
  const grantAction=target==="ontology" && callback.businessGrant && governanceAction.test(path);
  const ownership = assistantDirectory || target === "workbench" && /^\/api\/(?:panel-operation-intents|feedback|query-history|product-assets|memories|preferences|personal-workspace)(?:\/|$)/u.test(path);
  let credentials: AssistantCredentials = initiatorCredentials;
  if (initiatorResourceRead || ownership || grantAction) {
    const run = await runForOwner(owner, runId);
    if (initiatorResourceRead && (!run.channel || run.status !== "running")) {
      throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
    }
  } else {
    credentials = (await credentialsForRun(owner, runId, initiatorCredentials)).credentials;
  }
  const headers = buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers);
  if (callback.businessGrant && !resourceRead && !assistantDirectory) {
    headers.tk = callback.businessGrant;
    delete headers["X-API-Key"];
  }
  headers["X-Ontomato-Run-Id"] = runId;
  headers["X-Ontomato-Retrieval-Caller-Id"] = runId;
  const origin = target === "ontology" ? config.dataQuery.baseUrl : environment.agentRuntime().callbackUrl;
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  let body: string | ReadableStream<Uint8Array> | undefined;
  if (req.method !== "GET") {
    if (req.is("multipart/form-data")) {
      headers["Content-Type"] = req.headers["content-type"]!;
      body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    } else body = JSON.stringify(req.body);
  }
  const response = await fetch(origin.replace(/\/$/u, "") + path + query, {
    method: req.method, headers, body, redirect: "error", ...(body instanceof ReadableStream ? {duplex:"half"} : {}),
  } as NonNullable<Parameters<typeof fetch>[1]>);
  await proxyResponse(response, res);
}));
