import { createPanelOperationIntentRequestSchema, dispatchPanelOperationIntentRequestSchema } from "@ontomato/contracts/panel-agent";
import { operatePanel, dispatchPanel } from "../../services/product-panels/operations";
import { Router } from "express";
import { scheduledTaskReads } from "@ontomato/contracts/panel-client-requests";
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

export const assistantExecutionRouter = Router();
const ontologyPath = /^\/(?:ontology\/(?:query|ai\/(?:generation|knowledge-governance))(?:\/|$)|action(?:\/|$)|metricView(?:\/|$)|data\/queryInfoByNode$|knowledge(?:\/|$)|admin\/(?:getBussinessKnowledge)$)/;
const workbenchPath = /^\/api\/(?:assistant|panel-operation-intents|product-assets|dashboards|feedback|memories|query-history|preferences|personal-workspace)(?:\/|$)/;

assistantExecutionRouter.post("/:runId/panels/operate",wrap(async(req,res)=>{
  const runId=z.string().uuid().parse(req.params.runId);
  const callback=res.locals.runtimeCallback as RuntimeCallback | undefined;
  if(!callback || callback.runId!==runId)throw new HttpError(403,"A run callback is required","FORBIDDEN");
  const {owner,credentials}=context(req);
  res.json(await operatePanel(owner,credentials,runId,createPanelOperationIntentRequestSchema.parse(req.body)));
}));
assistantExecutionRouter.post("/:runId/panels/intents/:intentId/dispatch",wrap(async(req,res)=>{
  const runId=z.string().uuid().parse(req.params.runId),intentId=z.string().uuid().parse(req.params.intentId);
  const callback=res.locals.runtimeCallback as RuntimeCallback | undefined;
  if(!callback || callback.runId!==runId)throw new HttpError(403,"A run callback is required","FORBIDDEN");
  dispatchPanelOperationIntentRequestSchema.parse(req.body);
  const {owner,credentials}=context(req);
  res.json(await dispatchPanel(owner,credentials,runId,intentId));
}));

assistantExecutionRouter.post("/:runId/retrieval",wrap(async(req,res)=>{
  const runId=z.string().uuid().parse(req.params.runId);
  const callback=(res.locals.runtimeCallback as RuntimeCallback | undefined);
  if(!callback || callback.runId!==runId)throw new HttpError(403,"A run callback is required","FORBIDDEN");
  const operation=assistantRetrievalOperationSchema.parse(req.body);
  const {owner,credentials:initiator}=context(req);
  let credentials:AssistantCredentials=initiator;
  if(operation.operation==="begin" || operation.operation==="submit")credentials=(await credentialsForRun(owner,runId,initiator)).credentials;
  else {
    const run=await runForOwner(owner,runId);
    if(run.status!=="running")throw new HttpError(409,"Execution is closed","RUN_CLOSED");
  }
  const value=await new OntologyRetrievalClient(owner,runId,credentials).executeOperation(operation);
  if(operation.operation==="close")res.status(204).end();else res.json(value);
}));

assistantExecutionRouter.all("/:runId/:target/*", wrap(async (req, res) => {
  const runId = z.string().uuid().parse(req.params.runId);
  const callback = (res.locals.runtimeCallback as RuntimeCallback | undefined);
  if (!callback || callback.runId !== runId) throw new HttpError(403, "A run callback is required", "FORBIDDEN");
  const target = z.enum(["ontology", "workbench"]).parse(req.params.target);
  const path = "/" + req.params[0];
  const scheduleRead = target === "ontology" && !req.path.includes("%") &&
    scheduledTaskReads.some(request => request.method === req.method && request.path.test(path));
  if (/[\\%?#]/u.test(path) || path.split("/").some(segment => segment === "." || segment === "..") ||
    !(target === "ontology" ? scheduleRead || ontologyPath.test(path) : workbenchPath.test(path)) || path.startsWith("/api/assistant/executions/"))
    throw new HttpError(403, "Path is outside the execution callback", "FORBIDDEN");
  const { owner, credentials: initiatorCredentials } = context(req);
  const grantAction=target==="ontology" && callback.businessGrant && /^\/ontology\/ai\/knowledge-governance\/[^/]+\/runs\/[^/]+\/actions\/[^/]+$/u.test(path);
  const ownership=target==="workbench" && /^\/api\/(?:assistant|panel-operation-intents|feedback|query-history|product-assets|memories|preferences|personal-workspace)(?:\/|$)/u.test(path);
  const credentials: AssistantCredentials = ownership || grantAction ? initiatorCredentials : (await credentialsForRun(owner, runId, initiatorCredentials)).credentials;
  if(ownership || grantAction)await runForOwner(owner,runId);
  const headers = buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers);
  if (callback.businessGrant && !scheduleRead) { headers.tk = callback.businessGrant; delete headers["X-API-Key"]; }
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
