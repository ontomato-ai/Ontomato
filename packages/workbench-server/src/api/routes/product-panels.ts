import {
  createPanelHumanOperationIntentRequestSchema, dispatchPanelHumanOperationIntentRequestSchema,
  inspectPanelOperationImpactRequestSchema, panelHumanOperationDispatchResponseSchema, panelHumanOperationIntentParamsSchema,
  panelOperationDescriptorResponseSchema, panelOperationRefSchema, panelUseRefSchema,
  readPanelOperationRequestSchema, readPanelOperationResponseSchema, updatePanelOperationSettingsRequestSchema,
} from "@ontomato/contracts/panel-agent";
import { agentSessionRefSchema } from "@ontomato/contracts/agent-channel";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { productPanelReadRequestSchema } from "@ontomato/contracts/panel-host";
import {
  dispatchHumanPanelOperation, inspectPanelOperationImpact, ownPanelSettings, prepareHumanPanelOperation,
  projectPanelOperationIntent, readPanelOperation, readPanelOperationDescriptor,
} from "../../services/product-panels/operations";
import { panelOperationStore } from "../../services/product-panels/operation-store";
import { Router } from "express";
import { z } from "zod";
import {
  applicationPanelReferencesRequestSchema, chartProjectionLookupResponseSchema, chartProjectionTemplateSchema, METRIC_CHART_COMPONENT,
  productCurrentIdParamsSchema, productPanelReadQuerySchema,
  type ProductPanelReadQuery,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema,
  registerProductPanelRequestSchema,
  registerProductProjectionRequestSchema, updateChartProjectionSourceRequestSchema,
} from "@ontomato/contracts/product-panels";
import { CHART_PROJECTION_SOURCES_PATH, chartProjectionSourceRead } from "@ontomato/contracts/panel-client-requests";
import { mountProductCatalog } from "./product-catalog";
import { mountPanelPersonalState } from "./panel-personal-state";
import { context, wrap } from "../utils/agent-host";
import { platformService } from "../middleware/platform-service";
import {
  readCurrentPanelRecord, readCurrentProjectionRecord, saveCurrentPanel, saveCurrentProjection, validateApplicationPanelReferences,
} from "../../services/product-panels/current";
import { HttpError } from "../../utils/errors";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { readProductPanelData } from "../../services/product-panels/data-reads";
import { productDefinitionStreamRequestSchema, type ProductDefinitionStreamFrame } from "@ontomato/contracts/product-subscriptions";
import { authorizeDefinitionStream, requirePanelDefinitions } from "../../services/product-panels/definition-stream";
import type { createChartProjectionService } from "../../services/product-panels/chart-sources";
import { pageSkillMemberContext, readSkillView } from "../../services/skills/view";

async function withPageSkillContext<T extends { panel: { id: string } }>(
  response: T, query: ProductPanelReadQuery, caller: ReturnType<typeof context>,
) {
  if (!("applicationId" in query)) return response;
  const { applicationId, useId, ...entrance } = query;
  const view = await readSkillView(caller.owner.domainId, caller.credentials);
  const pageSkillContext = await pageSkillMemberContext(
    view, entrance, { kind: "application-use", applicationId, useId }, response.panel,
  );
  return { ...response, pageSkillContext };
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
productPanelsRouter.post("/read", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const request = productPanelReadRequestSchema.parse(req.body);
  const preview = req.header(BUILD_TEST_HEADER);
  const viewer = preview === undefined
    ? credentials : { ...credentials, headers: { ...credentials.headers, [BUILD_TEST_HEADER]: preview } };
  res.json(await readProductPanelData(owner, viewer, request, (req as AuthenticatedRequest).userName));
}));
productPanelsRouter.get("/:id/snapshot", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const query = productPanelReadQuerySchema.parse(req.query);
  const snapshot = await requirePanelDefinitions(c.owner, c.credentials, id);
  res.json(await withPageSkillContext(snapshot, query, c));
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
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const query = productPanelReadQuerySchema.parse(req.query);
  const panel = await readCurrentPanelRecord(c.owner, c.credentials, id);
  res.json(await withPageSkillContext({ panel }, query, c));
}));
productPanelsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const { revision, ...input } = parseRegistration(registerProductPanelRequestSchema, req.body, `Panel '${id}'`);
  const panel = await saveCurrentPanel(c.owner, c.credentials, id, input, revision);
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
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  res.json({ projection: await readCurrentProjectionRecord(c.owner, c.credentials, id) });
}));
productProjectionsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const branch = req.body?.componentId === METRIC_CHART_COMPONENT ? 1 : 0;
  const request = parseRegistration(registerProductProjectionRequestSchema, req.body, `Projection '${id}'`, branch);
  const projection = await saveCurrentProjection(c.owner, c.credentials, id, request);
  res.json({ projection });
}));
export const productPanelsInternalRouter = Router();
productPanelsInternalRouter.use(platformService);
productPanelsInternalRouter.post("/validate-references", wrap(async (req, res) => {
  await validateApplicationPanelReferences(applicationPanelReferencesRequestSchema.parse(req.body));
  res.sendStatus(204);
}));

export const panelOperationsRouter = Router();
panelOperationsRouter.get("/panel-operations/descriptor", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const query = panelOperationRefSchema.parse(req.query);
  res.json(panelOperationDescriptorResponseSchema.parse(await readPanelOperationDescriptor(owner, credentials, query)));
}));
panelOperationsRouter.post("/panel-operations/read", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = readPanelOperationRequestSchema.parse(req.body);
  const preview = req.header(BUILD_TEST_HEADER);
  const reader = preview === undefined
    ? credentials : { ...credentials, headers: { ...credentials.headers, [BUILD_TEST_HEADER]: preview } };
  res.json(readPanelOperationResponseSchema.parse(await readPanelOperation(owner, reader, input)));
}));

panelOperationsRouter.post("/panel-operations/inspect-impact", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = inspectPanelOperationImpactRequestSchema.parse(req.body);
  res.json(await inspectPanelOperationImpact(owner, credentials, input));
}));
panelOperationsRouter.post("/panel-operations/intents", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const input = createPanelHumanOperationIntentRequestSchema.parse(req.body);
  res.json(await prepareHumanPanelOperation(owner, credentials, input));
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
  res.json(panelHumanOperationDispatchResponseSchema.parse(await dispatchHumanPanelOperation(owner, credentials, intentId)));
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
