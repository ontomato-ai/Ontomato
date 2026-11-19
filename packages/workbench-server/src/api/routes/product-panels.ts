import { updatePanelOperationSettingsRequestSchema } from "@ontomato/contracts/panel-agent";
import { agentSessionRefSchema } from "@ontomato/contracts/agent-channel";
import { ownPanelSettings } from "../../services/product-panels/operations";
import { panelOperationStore } from "../../services/product-panels/operation-store";
import { Router } from "express";
import { z } from "zod";
import {
  chartProjectionLookupResponseSchema, chartProjectionTemplateSchema, productCurrentIdParamsSchema,
  registerChartProjectionRequestSchema, registerChartProjectionResponseSchema, registerProductPanelRequestSchema,
  registerProductProjectionRequestSchema, updateChartProjectionSourceRequestSchema,
} from "@ontomato/contracts/product-panels";
import { CHART_PROJECTION_SOURCES_PATH, chartProjectionSourceRead } from "@ontomato/contracts/panel-client-requests";
import { mountProductCatalog } from "./product-catalog";
import { context, wrap } from "../utils/agent-host";
import { platformService } from "../middleware/platform-service";
import { readCurrentPanel, readCurrentProjection, requireCurrentPanels, saveCurrentPanel, saveCurrentProjection } from "../../services/product-panels/current";
import { productDefinitionStreamRequestSchema, type ProductDefinitionStreamFrame } from "@ontomato/contracts/product-subscriptions";
import { authorizeDefinitionStream, requirePanelDefinitions } from "../../services/product-panels/definition-stream";
import type { createChartProjectionService } from "../../services/product-panels/chart-sources";

export const productPanelsRouter = Router();
mountProductCatalog(productPanelsRouter, "panel");
productPanelsRouter.get("/:id/snapshot", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
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
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  res.json({ panel: await readCurrentPanel(c.owner, c.credentials, id) });
}));
productPanelsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const { revision, ...input } = registerProductPanelRequestSchema.parse(req.body);
  res.json({ panel: await saveCurrentPanel(c.owner, c.credentials, id, input, revision) });
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
  res.json({ projection: await readCurrentProjection(c.owner, c.credentials, id) });
}));
productProjectionsRouter.put("/:id", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  const { revision, ...input } = registerProductProjectionRequestSchema.parse(req.body);
  res.json({ projection: await saveCurrentProjection(c.owner, c.credentials, id, input, revision) });
}));
export const productPanelsInternalRouter = Router();
productPanelsInternalRouter.use(platformService);
productPanelsInternalRouter.post("/validate-references", wrap(async (req, res) => {
  const { domainId, ids } = z.object({ domainId: z.string().min(1), ids: z.array(z.string().min(1)) }).strict().parse(req.body);
  await requireCurrentPanels(domainId, ids);
  res.sendStatus(204);
}));

export const panelOperationsRouter = Router();
panelOperationsRouter.get("/panel-operation-intents/:intentId",wrap(async(req,res)=>{
  const c=context(req);
  const record = await panelOperationStore.get(c.owner,z.string().uuid().parse(req.params.intentId));
  res.json(record.kind === "confirmation-expired" ? record : record.intent);
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
