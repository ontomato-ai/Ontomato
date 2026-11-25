import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { Router } from "express";
import { context, wrap } from "../utils/agent-host";
import { currentAppSdk } from "../../services/app-builder/sdk";

export const appBuilderRouter = Router();
appBuilderRouter.get("/app-builder/type-table", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  await assertAppBuilderAccess(credentials);
  const { readPanelTypeTable } = await import("../../services/product-panels/type-table");
  res.json(await readPanelTypeTable(owner, credentials));
}));
appBuilderRouter.get("/apps-sdk/current", wrap(async (_req, res) => {
  res.json(await currentAppSdk());
}));
