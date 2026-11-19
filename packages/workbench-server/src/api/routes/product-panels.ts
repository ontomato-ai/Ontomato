import { updatePanelOperationSettingsRequestSchema } from "@ontomato/contracts/panel-agent";
import { agentSessionRefSchema } from "@ontomato/contracts/agent-channel";
import { ownPanelSettings } from "../../services/product-panels/operations";
import { panelOperationStore } from "../../services/product-panels/operation-store";
import { Router } from "express";
import { z } from "zod";
import { productCurrentIdParamsSchema, registerProductPanelRequestSchema, registerProductProjectionRequestSchema } from "@ontomato/contracts/product-panels";
import { context, wrap } from "../utils/agent-host";
import { platformService } from "../middleware/platform-service";
import { readCurrentPanel, readCurrentProjection, requireCurrentPanels, saveCurrentPanel, saveCurrentProjection } from "../../services/product-panels/current";

import { requirePanelDefinitions } from "../../services/product-assets/subscriptions";

export const productPanelsRouter = Router();
productPanelsRouter.get("/:id/snapshot", wrap(async (req, res) => {
  const c = context(req), { id } = productCurrentIdParamsSchema.parse(req.params);
  res.json(await requirePanelDefinitions(c.owner, c.credentials, id));
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
  res.json(await panelOperationStore.get(c.owner,z.string().uuid().parse(req.params.intentId)));
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
