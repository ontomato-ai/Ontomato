import { isLivePresentationEligibleRun } from "../../services/agent-host/presentation";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import {
  directPanelMemberPathSchema, productPanelNestedReadRequestSchema, productPanelNestedReadResponseSchema, productPanelReadRequestSchema,
  type DirectPanelMemberPath, type ProductPanelReadSource,
} from "@ontomato/contracts/panel-host";
import { readAssistantPanelMember } from "../../services/assistant/registered-panel-read";
import { readNestedPanel, resolvePanelMemberPath } from "../../services/product-panels/member-path";
import { requirePanelUseEntry } from "../../services/product-panels/application-use";
import { readCurrentPanelRecord } from "../../services/product-panels/current";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { PROJECTION_REUSE_PANEL_HEADER } from "@ontomato/contracts/product-panels";
import { Router, type Request } from "express";
import { AGENT_DEFINITION, SKILL, ONTOLOGY_TYPE, bindingKey, panelClientReads } from "@ontomato/contracts/panel-client-requests";
import type {AssistantCredentials} from "../../platform/agent-runtime/runtime";
import { AGENT_EXECUTION_HEADER, callbackResponseHeaders, unsafeCallbackPath } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { z } from "zod";
import { context, wrap } from "../utils/agent-host";
import { proxyResponse } from "../utils/proxy";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import {assistantRetrievalOperationSchema} from "@ontomato/contracts/assistant-retrieval";
import { pageCatalogRequestSchema, pageDescriptionRequestSchema, pageSearchRequestSchema } from "@ontomato/contracts/page-context";
import { readPageCatalog, readPageDescription, searchPages } from "../../services/product-panels/page-discovery";
import {OntologyRetrievalClient} from "../../services/assistant/ontology-retrieval";
import { credentialsForRun, ownedRun, runForOwner } from "../../services/assistant/execution";
import { assistantStore } from "../../services/assistant/store";
import type { RuntimeCallback } from "../../services/agent-runtime/callback-credential";
import { adoptAppBuilderDefinition, executeAuthoring, type AuthoringOperation } from "../../services/assistant/authoring";
import { authoringAdoptionRequestSchema, authoringKindSchema, authoringOperations } from "@ontomato/contracts/authoring";

export const assistantExecutionRouter = Router();
export const assistantExecutionMountPath = "/api/assistant/executions";
export const assistantOwnerCallbackPath = "/:runId/:target(ontology|workbench)/*";

const governanceAction = /^\/ontology\/ai\/knowledge-governance\/[^/]+\/runs\/[^/]+\/actions\/[^/]+$/u;

// These existing reads and personal operations belong to the initiator, including on runs
// with a separate execution account. Every other route uses the run's execution identity.
const skillReadPath = /^\/api\/(?:assistant\/agent-skills|skills(?:\/[^/]+\/(?:references|files|file))?)$/u;
const initiatorPanelReads = [AGENT_DEFINITION, SKILL, ONTOLOGY_TYPE]
  .flatMap(type => panelClientReads(bindingKey({ kind: "PlatformObjectType", id: type })));
async function panelReader(req: Request, runId: string, source: ProductPanelReadSource, memberPath: DirectPanelMemberPath) {
  if (source.kind === "candidate" || source.kind === "app-candidate")
    throw new HttpError(400, "A page operation reads a registered application entry", "INVALID_REQUEST");
  const { owner, credentials } = context(req);
  const run = await runForOwner(owner, runId);
  if (!run.channel || run.status !== "running")
    throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if (run.channel.authority.executionKind === "preview"
      && !isLivePresentationEligibleRun({ host: "workbench", owner, runId, sessionId: run.sessionId, channel: run.channel }))
    throw new HttpError(422, "Page operation reads do not support test data", "PREVIEW_WRITE_FORBIDDEN");
  if (source.kind === "frame")
    throw new HttpError(403, "The application frame is not a page operation target", "PANEL_FRAME_SKILL_REQUIRED");
  const { use } = await requirePanelUseEntry(credentials, source, owner);
  const executor = await credentialsForRun(owner, runId, credentials, run.sessionId);
  if (executor.executionUserId !== null) {
    // The execution account may read owner data only through a placement the initiator could actually open.
    const panel = await readCurrentPanelRecord(owner, credentials, use.panelId);
    await resolvePanelMemberPath(owner, credentials, panel, memberPath, use);
  }
  const reader = { ...owner, userId: executor.executionUserId ?? owner.userId };
  const userName = executor.executionUserId === null ? (req as AuthenticatedRequest).userName : undefined;
  return { reader, credentials: executor.credentials, retrievalScopeId: executor.retrievalScopeId, userName };
}

async function pageDiscoveryOwner(req: Request, runId: string) {
  const { owner, credentials } = context(req);
  const run = await runForOwner(owner, runId);
  if (!run.channel || run.status !== "running") throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  return { owner, credentials };
}

assistantExecutionRouter.post("/:runId/panels/catalog", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const { owner, credentials } = await pageDiscoveryOwner(req, runId);
  res.json(await readPageCatalog(owner, credentials, pageCatalogRequestSchema.parse(req.body ?? {})));
}));

assistantExecutionRouter.post("/:runId/panels/search", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const { owner, credentials } = await pageDiscoveryOwner(req, runId);
  res.json(await searchPages(owner, credentials, pageSearchRequestSchema.parse(req.body)));
}));

assistantExecutionRouter.post("/:runId/panels/description", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const { owner, credentials } = await pageDiscoveryOwner(req, runId);
  res.json(await readPageDescription(owner, credentials, pageDescriptionRequestSchema.parse(req.body)));
}));

assistantExecutionRouter.post("/:runId/panels/read", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const input = productPanelReadRequestSchema.parse(req.body);
  const { reader, credentials, retrievalScopeId, userName } = await panelReader(req, runId, input.source, input.memberPath);
  res.json(await readAssistantPanelMember({ owner: reader, credentials }, input, userName, retrievalScopeId ?? undefined));
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

assistantExecutionRouter.get("/:runId/workbench/api/app-builder/workspace", wrap(async (req, res) => {
  const runId = callbackRun(req, res.locals.runtimeCallback);
  const { owner } = context(req);
  const run = await runForOwner(owner, runId);
  if (run.status !== "running" || run.channel?.authority.executionKind !== "preview")
    throw new HttpError(403, "An active App Builder run is required", "FORBIDDEN");
  const session = await assistantStore.session(run.sessionId, owner);
    if (!session.workspace_id) throw new HttpError(422, "The run has no workspace", "WORKSPACE_REQUIRED");
    res.json({ workspaceId: session.workspace_id });
}));

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

assistantExecutionRouter.all(assistantOwnerCallbackPath, wrap(async (req, res) => {
  const callback = res.locals.runtimeCallback as RuntimeCallback;
  const runId = callbackRun(req, callback);
  const target = z.enum(["ontology", "workbench"]).parse(req.params.target);
  const path = "/" + req.params[0];
  if (unsafeCallbackPath(path)) throw new HttpError(403, "Invalid execution callback path", "FORBIDDEN");
  const workbenchResource = target === "workbench" && path.startsWith("/api/");
  const initiatorResourceRead = workbenchResource && (
    (req.method === "GET" && skillReadPath.test(path)) ||
    initiatorPanelReads.some(read => read.service === "" && read.method === req.method && read.path.test(path.slice(4)))
  );
  const ownership = target === "workbench" && (
    (req.method === "GET" && path === "/api/assistant/agents") ||
    /^\/api\/(?:panel-operation-intents|feedback|query-history|business-definitions|business-definition-triggers|memories|preferences|personal-workspace)(?:\/|$)/u.test(path)
  );
  const { owner, credentials: initiatorCredentials } = context(req);
  const businessGrant = target === "ontology" && governanceAction.test(path) ? callback.businessGrant : undefined;
  let credentials: AssistantCredentials = initiatorCredentials;
  let retrievalScopeId: string | null = null;
  const requestedContext = req.header(EXECUTION_CONTEXT_HEADER);
  let executionContext: string | undefined;
  if (initiatorResourceRead || ownership || businessGrant) {
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
    const authority = resolved.run.channel?.authority;
    if (authority?.executionKind === "preview") executionContext = previewExecutionContextHeader;
  }
  if (requestedContext !== undefined && requestedContext !== executionContext)
    throw new HttpError(403, "Execution context differs from the run's bound target", "PREVIEW_EXECUTION_FORBIDDEN");
  const headers = buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey, credentials.headers);
  if (businessGrant) {
    headers.tk = businessGrant;
    delete headers["X-API-Key"];
  }
  headers["X-Ontomato-Run-Id"] = runId;
  headers[AGENT_EXECUTION_HEADER] = runId;
  if (retrievalScopeId) headers["X-Ontomato-Retrieval-Caller-Id"] = retrievalScopeId;
  else delete headers["X-Ontomato-Retrieval-Caller-Id"];
  if (executionContext !== undefined) headers[EXECUTION_CONTEXT_HEADER] = executionContext;
  const reusePanel = req.header(PROJECTION_REUSE_PANEL_HEADER);
  if (reusePanel !== undefined) headers[PROJECTION_REUSE_PANEL_HEADER] = reusePanel;
  const upstream = new URL(target === "ontology" ? config.dataQuery.baseUrl : environment.agentRuntime().callbackUrl);
  upstream.pathname = upstream.pathname.replace(/\/$/u, "") + "/" + req.path.split("/").slice(3).join("/");
  upstream.search = req.url.slice(req.path.length);
  const contentType = req.header("Content-Type");
  if (contentType) headers["Content-Type"] = contentType;
  else delete headers["Content-Type"];
  for (const name of ["Accept", "Idempotency-Key"]) {
    const value = req.header(name);
    if (value !== undefined) headers[name] = value;
  }
  const response = await fetch(upstream.href, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" && Buffer.isBuffer(req.body) ? req.body as Uint8Array<ArrayBuffer> : undefined,
    redirect: "manual",
  });
  callbackResponseHeaders(response.headers, (name, value) => res.setHeader(name, value));
  await proxyResponse(response, res);
}));
