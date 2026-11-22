import { Router } from "express";
import { generalSettingsPatch, generalSettingsSavePath, saveGeneralSettings } from "../../services/admin/general-settings-panel";
import { operationHost } from "../../services/product-panels/operation-host";
import { context, wrap } from "../utils/agent-host";

export const systemConfigRouter = Router();
systemConfigRouter.post(generalSettingsSavePath, wrap(async (req, res) => {
  const actor = context(req);
  const outcome = await saveGeneralSettings(operationHost(actor), actor, generalSettingsPatch.parse(req.body));
  res.status(outcome.kind === "success" ? 200 : outcome.kind === "refusal" ? 422 : 500).json(outcome);
}));
