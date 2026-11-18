import { Router } from "express";
import { z } from "zod";
import { productCurrentIdParamsSchema, registerProductPanelRequestSchema, registerProductProjectionRequestSchema } from "@ontomato/contracts/product-panels";
import { context, wrap } from "../utils/agent-host";
import { platformService } from "../middleware/platform-service";
import { readCurrentPanel, readCurrentProjection, requireCurrentPanels, saveCurrentPanel, saveCurrentProjection } from "../../services/product-panels/current";

export const productPanelsRouter = Router();
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
