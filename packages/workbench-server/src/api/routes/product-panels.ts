import { hasActivePresentationForRun, isLivePresentationEligibleRun } from "../../services/agent-host/presentation";
import { randomUUID } from "node:crypto";
import {
  cancelPanelOperationIntentRequestSchema, createPanelHumanOperationIntentRequestSchema, dispatchPanelHumanOperationIntentRequestSchema,
  inspectPanelOperationImpactRequestSchema, localPanelConfirmationRequestSchema, panelHumanOperationDispatchResponseSchema, panelHumanOperationIntentParamsSchema,
  panelOperationDescriptorResponseSchema, panelOperationRefSchema, panelUseRefSchema,
  panelUploadRequestSchema, readPanelOperationRequestSchema, readPanelOperationResponseSchema, updatePanelOperationSettingsRequestSchema,
} from "@ontomato/contracts/panel-agent";
import { PANEL_UPLOAD_MAX_BYTES, PANEL_UPLOADS_PATH, panelUploadReceiptSchema } from "@ontomato/contracts/panel-upload";
import { panelDownloadFileSchema } from "@ontomato/contracts/panel-download";
import { agentSessionRefSchema } from "@ontomato/contracts/agent-channel";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import {
  PANEL_MEMBER_RENDER_HEADER, PANEL_NESTED_READ_PATH, productPanelNestedReadRequestSchema, productPanelNestedReadResponseSchema,
} from "@ontomato/contracts/panel-host";
import {
  cancelHumanPanelOperation, cancelPendingAgentPageQuestion, claimPendingLocalConfirmation,
  dispatchHumanPanelOperation, inspectPanelOperationImpact, ownPanelSettings, prepareHumanPanelOperation,
  projectPanelOperationIntent, readPanelOperation, readPanelOperationDescriptor, registerPendingLocalConfirmation, stagePanelUpload,
} from "../../services/product-panels/operations";
import { panelOperationStore } from "../../services/product-panels/operation-store";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import {
  APPLICATION_OPEN_PATH, APPLICATION_REGISTRANT_HEADER, applicationEntryResolutionQuerySchema,
  applicationIconValidationRequestSchema, applicationPanelReferencesRequestSchema,
  chartProjectionLookupResponseSchema, chartProjectionTemplateSchema, METRIC_CHART_COMPONENT,
  isApplicationPanelUse,
  PROJECTION_REUSE_PANEL_HEADER,
  productCurrentIdParamsSchema, productPanelGetQuerySchema, productPanelReadQuerySchema,
  type ProductPanel, type ProductPanelResponse, type ProductProjection, type ProductPanelReadQuery,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema,
  registerProductPanelRequestSchema,
  registerProductProjectionRequestSchema, updateChartProjectionSourceRequestSchema,
} from "@ontomato/contracts/product-panels";
import { CHART_PROJECTION_SOURCES_PATH, chartProjectionSourceRead } from "@ontomato/contracts/panel-client-requests";
import { domainProductIdParamsSchema, domainProductIdSchema } from "@ontomato/contracts/product-record-id";
import { mountProductCatalog } from "./product-catalog";
import { mountPanelPersonalState } from "./panel-personal-state";
import { context, wrap } from "../utils/agent-host";
import { getApiKeyFromRequest, getLocaleFromRequest, getTokenFromRequest } from "../utils/request";
import { buildAttachmentContentDisposition } from "../utils/http";
import { platformService } from "../middleware/platform-service";
import { workbenchIdentity } from "../../identity/installed";
import {
  readCurrentPanelRecord, readCurrentProjectionRecord, saveCurrentPanel, saveCurrentProjection,
  validateApplicationPanelReferences,
} from "../../services/product-panels/current";
import { HttpError } from "../../utils/errors";
import { readBundledPanelProjections } from "../../services/product-panels/bundled-projections";
import { bundledPanelProjectionIds, renderDefinitionJson } from "../../services/product-panels/render-definitions";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { readPanelDomainComponents, validateProjectionComponent } from "../../services/product-panels/component-catalogue";
import { readNestedPanel, requireRegisteredPanelRoot } from "../../services/product-panels/member-path";
import { productDefinitionStreamRequestSchema, type ProductDefinitionStreamFrame } from "@ontomato/contracts/product-subscriptions";
import { authorizeDefinitionStream, requirePanelDefinitions, snapshotPanelDefinitions } from "../../services/product-panels/definition-stream";
import type { createChartProjectionService } from "../../services/product-panels/chart-sources";
import { readRegisteredPanelEntry } from "../../services/product-panels/application-use";
import { openApplicationDefinitions } from "../../services/product-panels/open-entry";
import { panelConfirmation } from "../../services/product-panels/confirmation";
import { runForOwner } from "../../services/assistant/execution";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runWithLogContext } from "../../logging/log-context";

type FrameRead = Extract<ProductPanelReadQuery, { source: "frame" }>;

function requireFrameForRead({ applicationId, useId }: FrameRead, caller: ReturnType<typeof context>, id: string) {
  return requireRegisteredPanelRoot(caller.owner, caller.credentials,
    { kind: "frame", applicationId, useId }, { expectedPanelId: id });
}

function renderProjectionFields(
  projection: ProductProjection,
  domainComponent: Awaited<ReturnType<typeof validateProjectionComponent>>,
) {
  const component = domainComponent === undefined ? "" : `,"domainComponent":${renderDefinitionJson(domainComponent)}`;
  return `"projection":${renderDefinitionJson(projection)}${component}`;
}

function renderPanelJson(
  panel: ProductPanel, projections: ProductPanelResponse["projections"],
  domainComponents: ProductPanelResponse["domainComponents"],
) {
  const fields = [`"panel":${renderDefinitionJson(panel)}`];
  if (projections !== undefined) {
    const entries = Object.entries(projections).map(([id, entry]) => {
      const value = entry.status === "ready"
        ? `{"status":"ready",${renderProjectionFields(entry.projection, entry.domainComponent)}}`
        : JSON.stringify(entry);
      return `${JSON.stringify(id)}:${value}`;
    });
    fields.push(`"projections":{${entries.join(",")}}`);
  }
  if (domainComponents !== undefined) fields.push(`"domainComponents":${JSON.stringify(domainComponents)}`);
  return `{${fields.join(",")}}`;
}

function registrationIssue(issue: z.ZodIssue, branch?: number): string {
  if (issue.code === z.ZodIssueCode.invalid_union) {
    const choices = issue.unionErrors;
    const closest = branch === undefined
      ? choices.reduce((best, choice) => choice.issues.length < best.issues.length ? choice : best)
      : choices[branch];
    return registrationIssue(closest.issues[0]!);
  }
  const field = (path: (string | number)[]) => path.length ? `field '${path.join(".")}'` : "request body";
  if (issue.code === z.ZodIssueCode.unrecognized_keys)
    return issue.keys.map(key => `${field([...issue.path, key])} is not allowed`).join(", ");
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined")
    return `${field(issue.path)} is required`;
  return `${field(issue.path)} – ${issue.message}`;
}

function parseRegistration<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, record: string, branch?: number): T {
  const request = schema.safeParse(body);
  if (!request.success)
    throw new HttpError(400, `${record}, ${registrationIssue(request.error.issues[0]!, branch)}`, "INVALID_REQUEST");
  return request.data;
}

export const productPanelsRouter = Router();
mountProductCatalog(productPanelsRouter, "panel");
mountPanelPersonalState(productPanelsRouter);
productPanelsRouter.get("/preview/app/:appId", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { appPreviewQuerySchema, readApplicationPreviewDescriptor } = await import("../../services/app-builder/preview-service");
  const appId = productCurrentIdParamsSchema.shape.id.parse(req.params.appId);
  const preview = await readApplicationPreviewDescriptor(owner, credentials, appId, appPreviewQuerySchema.parse(req.query));
  res.set("Cache-Control", "no-store").json(preview);
}));
productPanelsRouter.post(PANEL_NESTED_READ_PATH.slice("/product-panels".length), wrap(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { owner, credentials } = context(req);
  const request = productPanelNestedReadRequestSchema.parse(req.body);
  res.json(productPanelNestedReadResponseSchema.parse(await readNestedPanel(owner, credentials, request, true)));
}));
export const productPanelOpeningRouter = Router();
productPanelOpeningRouter.get(APPLICATION_OPEN_PATH.slice("/product-panels".length), wrap(async (req, res) => {
  const ref = applicationEntryResolutionQuerySchema.parse(req.query);
  const credentials = { token: getTokenFromRequest(req), apiKey: getApiKeyFromRequest(req), locale: resolveLocale(getLocaleFromRequest(req)) };
  const { owner, entry, frame, content, projections, componentUsable } = await openApplicationDefinitions(ref, credentials);
  await runWithLogContext(owner, async () => {
    const render = async (root: typeof content) => {
      if (!root) return "null";
      const { panel, projectionIds } = root;
      const [bundled, components] = await Promise.all([
        readBundledPanelProjections(owner, credentials, projectionIds, { records: projections, componentUsable }),
        readPanelDomainComponents({ domainId: panel.domainId, credentials, componentUsable }, panel.manifest.components),
      ]);
      return renderPanelJson(panel, bundled, components);
    };
    const [frameJson, contentJson] = await Promise.all([render(frame), render(content)]);
    res.set("Cache-Control", "no-store").type("json")
      .send(`${JSON.stringify(entry).slice(0, -1)},"frame":${frameJson},"content":${contentJson}}`);
  });
}));
productPanelsRouter.get("/:id/snapshot", wrap(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const query = productPanelReadQuerySchema.parse(req.query);
  if ("source" in query) {
    const { panel } = await requireFrameForRead(query, c, id);
    res.json(await snapshotPanelDefinitions(c.owner, c.credentials, panel));
    return;
  }
  res.json(await requirePanelDefinitions(c.owner, c.credentials, id));
}));
productPanelsRouter.post("/definition-stream", wrap(async (req, res) => {
  const {owner,credentials}=context(req);
  const {targets}=productDefinitionStreamRequestSchema.parse(req.body);
  const {attach,snapshot}=await authorizeDefinitionStream(owner,credentials,targets);
  if(res.destroyed)return;
  const send=(frame:ProductDefinitionStreamFrame)=>res.write(`data: ${JSON.stringify(frame)}\n\n`);
  const stop=attach(send,()=>res.end());
  res.once('close',stop);
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
  res.flushHeaders();
  const definitions=await snapshot();
  if(!res.destroyed)send({kind:'snapshot',definitions});
}));
productPanelsRouter.get("/:id", wrap(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const query = productPanelGetQuerySchema.parse(req.query);
  const { owner, credentials } = c;
  const [panel, placement] = await Promise.all([
    "source" in query && query.source === "frame"
      ? requireFrameForRead(query, c, id).then(({ panel }) => panel)
      : readCurrentPanelRecord(owner, credentials, id, !("view" in query && query.view === "1")),
    "source" in query && query.source === "registered" ? readRegisteredPanelEntry(credentials, query, owner) : undefined,
  ]);
  const use = placement?.use;
  if (use && (!isApplicationPanelUse(use) || use.panelId !== id))
    throw new HttpError(404, "This entry does not use the requested panel", "PANEL_ENTRY_UNAVAILABLE");
  const [projections, domainComponents] = await Promise.all([
    query.includeProjections === "1"
      ? readBundledPanelProjections(owner, credentials, bundledPanelProjectionIds(panel, use?.inputs)) : undefined,
    panel.manifest?.components ? readPanelDomainComponents({ domainId: panel.domainId, credentials }, panel.manifest.components) : undefined,
  ]);
  res.type("json").send(renderPanelJson(panel, projections, domainComponents));
}));
productPanelsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = domainProductIdParamsSchema.parse(req.params);
  const { revision, publicationAccess, ...input } = parseRegistration(registerProductPanelRequestSchema, req.body, `Panel '${id}'`);
  const panel = await saveCurrentPanel(c.owner, c.credentials, id, input, revision, publicationAccess);
  res.json({ panel });
}));
export const productProjectionsRouter = Router();
mountProductCatalog(productProjectionsRouter, "projection");
export function createChartProjectionsRouter(service: ReturnType<typeof createChartProjectionService>) {
  const router = Router();
  const collection = CHART_PROJECTION_SOURCES_PATH.slice("/product-projections".length);
  const template = chartProjectionSourceRead.template.slice("/product-projections".length);
  const projectionParams = z.object({ projectionId: productCurrentIdParamsSchema.shape.id }).strict();
  const savedTemplateSchema = chartProjectionTemplateSchema.pick({ chartFile: true });
  router.get(collection, wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const source = registerChartProjectionRequestSchema.parse(req.query);
    const projectionId = await service.lookup(owner, credentials, source);
    res.json(chartProjectionLookupResponseSchema.parse({ projectionId }));
  }));
  router.post(collection, wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const source = registerChartProjectionRequestSchema.parse(req.body);
    const projection = await service.register(owner, credentials, source);
    res.json(registerChartProjectionResponseSchema.parse({ projection }));
  }));
  router.get(template, wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { projectionId } = projectionParams.parse(req.params);
    res.json(chartProjectionTemplateSchema.parse(await service.read(owner, credentials, projectionId)));
  }));
  router.put(template, wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { projectionId } = projectionParams.parse(req.params);
    const { chartFile } = updateChartProjectionSourceRequestSchema.parse(req.body);
    res.json(savedTemplateSchema.parse(await service.edit(owner, credentials, projectionId, chartFile.content)));
  }));
  return router;
}

productProjectionsRouter.get("/:id", wrap(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const rendering = req.header(PANEL_MEMBER_RENDER_HEADER) === "1";
  const projection = await readCurrentProjectionRecord(c.owner, c.credentials, id, !rendering);
  const domainComponent = rendering
    ? await validateProjectionComponent(id, projection, undefined, { domainId: projection.domainId, credentials: c.credentials })
    : undefined;
  res.type("json").send(`{${renderProjectionFields(projection, domainComponent)}}`);
}));
productProjectionsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = domainProductIdParamsSchema.parse(req.params);
  const branch = req.body?.componentId === METRIC_CHART_COMPONENT ? 1 : 0;
  const request = parseRegistration(registerProductProjectionRequestSchema, req.body, `Projection '${id}'`, branch);
  const solePanelId = domainProductIdSchema.optional().parse(req.header(PROJECTION_REUSE_PANEL_HEADER));
  const projection = await saveCurrentProjection(c.owner, c.credentials, id, request, solePanelId);
  res.json({ projection });
}));
export const productPanelsInternalRouter = Router();
productPanelsInternalRouter.use(platformService);
productPanelsInternalRouter.post("/validate-references",
  (req, res, next) => req.body?.kind === "icon" ? next() : workbenchIdentity().authenticate(req, res, next),
  wrap(async (req, res) => {
    if (req.body?.kind === "icon") {
      parseRegistration(applicationIconValidationRequestSchema, req.body, "Application icon");
    } else {
      const request = parseRegistration(applicationPanelReferencesRequestSchema, req.body, "Application registration");
      const { owner, credentials } = context(req);
      if (!owner.userId || owner.userId !== req.header(APPLICATION_REGISTRANT_HEADER) || owner.domainId !== request.domainId)
        throw new HttpError(403, "Registration credentials must match the authenticated registrant and domain", "APPLICATION_REGISTRANT_MISMATCH");
      await validateApplicationPanelReferences({ ...request, registrant: credentials }, getLocaleFromRequest(req));
    }
    res.sendStatus(204);
  }),
);

export const panelOperationsRouter = Router();
panelOperationsRouter.get("/panel-operations/descriptor", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { memberPath, ...scope } = req.query;
  let path: unknown = memberPath;
  if (typeof memberPath === "string") {
    try { path = JSON.parse(memberPath); }
    catch { throw new HttpError(400, "Invalid member path JSON", "INVALID_REQUEST"); }
  }
  const query = panelOperationRefSchema.parse({ ...scope, memberPath: path });
  res.json(panelOperationDescriptorResponseSchema.parse(await readPanelOperationDescriptor(owner, credentials, query)));
}));
panelOperationsRouter.post("/panel-operations/read", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = readPanelOperationRequestSchema.parse(req.body);
  const preview = req.header(BUILD_TEST_HEADER);
  const reader = preview === undefined
    ? credentials : { ...credentials, headers: { ...credentials.headers, [BUILD_TEST_HEADER]: preview } };
  const result = await readPanelOperation(owner, reader, input);
  if (result.kind !== "file") {
    res.json(readPanelOperationResponseSchema.parse(result));
    return;
  }
  const { kind: _kind, ...data } = result;
  const file = panelDownloadFileSchema.safeParse(data);
  if (!file.success)
    throw new HttpError(502, `The operation returned an invalid file: ${file.error.issues[0]!.message}`, "PANEL_OPERATION_FILE_INVALID");
  const { bytes, mime, suggestedName } = file.data;
  const body = bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Buffer.from(bytes instanceof Blob ? await bytes.arrayBuffer() : bytes);
  res.set({
    "Content-Type": mime,
    "Content-Disposition": buildAttachmentContentDisposition(suggestedName),
    "Cache-Control": "no-store",
  }).send(body);
}));

// The owner's own limit is checked after the operation is known; this only bounds what is read into memory.
const pickedFile = multer({
  storage: multer.memoryStorage(), defParamCharset: "utf8", limits: { fileSize: PANEL_UPLOAD_MAX_BYTES, files: 1, fields: 1 },
}).single("file");
const readPickedFile: RequestHandler = (req, res, next) => pickedFile(req, res, error => {
  if (error instanceof multer.MulterError)
    next(error.code === "LIMIT_FILE_SIZE"
      ? new HttpError(413, tForLocale(context(req).credentials.locale, "panels.upload.tooLarge", { megabytes: PANEL_UPLOAD_MAX_BYTES / 1024 / 1024 }),
        "UPLOAD_TOO_LARGE", { maxBytes: PANEL_UPLOAD_MAX_BYTES })
      : new HttpError(400, error.message, "INVALID_REQUEST"));
  else next(error);
});
panelOperationsRouter.post(PANEL_UPLOADS_PATH, readPickedFile, wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  let operation: unknown;
  try { operation = JSON.parse(String(req.body?.operation)); }
  catch { throw new HttpError(400, "The operation field must be JSON", "INVALID_REQUEST"); }
  const request = panelUploadRequestSchema.parse({ operation });
  const picked = req.file && { name: req.file.originalname, bytes: req.file.buffer };
  res.json(panelUploadReceiptSchema.parse(await stagePanelUpload(owner, credentials, request.operation, picked)));
}));
panelOperationsRouter.post("/panel-operations/inspect-impact", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = inspectPanelOperationImpactRequestSchema.parse(req.body);
  res.json(await inspectPanelOperationImpact(owner, credentials, input));
}));
panelOperationsRouter.post("/panel-operations/intents", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = createPanelHumanOperationIntentRequestSchema.parse(req.body);
  res.json(await prepareHumanPanelOperation(owner, credentials, input, (req as AuthenticatedRequest).userName));
}));
panelOperationsRouter.get("/panel-operation-intents/:intentId", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { intentId } = panelHumanOperationIntentParamsSchema.parse(req.params);
  const use = Object.keys(req.query).length ? panelUseRefSchema.parse(req.query) : undefined;
  res.json(await projectPanelOperationIntent(owner, intentId, use, credentials));
}));
panelOperationsRouter.post("/panel-operations/intents/:intentId/dispatch", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { intentId } = panelHumanOperationIntentParamsSchema.parse(req.params);
  dispatchPanelHumanOperationIntentRequestSchema.parse(req.body);
  res.set("Cache-Control", "no-store").json(panelHumanOperationDispatchResponseSchema.parse(await dispatchHumanPanelOperation(owner, credentials, intentId)));
}));
panelOperationsRouter.post("/panel-operations/intents/:intentId/cancel", wrap(async (req, res) => {
  const { owner } = context(req);
  const { intentId } = panelHumanOperationIntentParamsSchema.parse(req.params);
  const reason = cancelPanelOperationIntentRequestSchema.parse(req.body);
  res.json(await cancelHumanPanelOperation(owner, intentId, reason));
}));
panelOperationsRouter.post("/panel-operations/questions/:questionId/cancel-if-pending", wrap(async (req, res) => {
  const { owner } = context(req);
  const questionId = z.string().uuid().parse(req.params.questionId);
  const reason = cancelPanelOperationIntentRequestSchema.parse(req.body);
  res.json(await cancelPendingAgentPageQuestion(owner, questionId, reason));
}));
panelOperationsRouter.post("/panel-operations/local-confirmations", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = localPanelConfirmationRequestSchema.parse(req.body);
  const run = await runForOwner(owner, input.agentRun.runId);
  if (!run.channel || run.status !== "running") throw new HttpError(409, "Execution is closed", "RUN_CLOSED");
  if (run.sessionId !== input.agentRun.sessionId) throw new HttpError(403, "Run session mismatch", "FORBIDDEN");
  const root = run.channel.userRecipient?.session;
  if (!root) {
    throw new HttpError(409, "Execution has no authenticated human session", "USER_SESSION_UNAVAILABLE");
  }
  const buildTest = run.channel.authority.executionKind === "build-test";
  if (buildTest && (!isLivePresentationEligibleRun({
    host: "workbench", owner, runId: input.agentRun.runId, sessionId: run.sessionId, channel: run.channel,
  }) || !hasActivePresentationForRun("workbench", owner, input.agentRun.runId))) {
    throw new HttpError(422, "Management operations do not support test data", "BUILD_TEST_UNSUPPORTED");
  }
  const settings = await panelOperationStore.settings(owner, root);
  const autoMode = !buildTest && !input.requireConfirmation && !settings.confirmBeforeExecute;
  const intentId = randomUUID();
  const questionId = autoMode ? null : randomUUID();
  if (!autoMode && questionId) {
    const questionPrompt = await panelConfirmation(credentials, {
      operation: input.operationLabel,
      target: input.targetLabel,
      ...(input.impactSummary ? { impactSummary: input.impactSummary } : {}),
      executionUserId: null,
      initiatorName: (req as AuthenticatedRequest).userName ?? owner.userId,
    });
    await new RuntimeClient(owner.domainId, undefined, owner.userId).request("/v1/channel/user-questions", "POST", {
      source: { session: { providerId: run.channel.agent.providerId, sessionId: run.sessionId }, runId: input.agentRun.runId },
      ...questionPrompt,
    }, questionId);
    registerPendingLocalConfirmation(owner, questionId, intentId);
  }
  res.json({ intentId, questionId, autoMode, label: input.operationLabel });
}));
panelOperationsRouter.post("/panel-operations/local-confirmations/:questionId/claim", wrap(async (req, res) => {
  const { owner } = context(req);
  const questionId = z.string().uuid().parse(req.params.questionId);
  res.json(claimPendingLocalConfirmation(owner, questionId));
}));
panelOperationsRouter.get("/panel-operation-settings/:providerId/:sessionId",wrap(async(req,res)=>{
  const c=context(req),root=agentSessionRefSchema.parse(req.params);
  await ownPanelSettings(c.owner,root);
  res.json(await panelOperationStore.settings(c.owner,root));
}));
panelOperationsRouter.put("/panel-operation-settings/:providerId/:sessionId",wrap(async(req,res)=>{
  const c=context(req),root=agentSessionRefSchema.parse(req.params);
  const input=updatePanelOperationSettingsRequestSchema.parse(req.body);
  await ownPanelSettings(c.owner,root);
  res.json(await panelOperationStore.setSettings(c.owner,root,input.confirmBeforeExecute));
}));
