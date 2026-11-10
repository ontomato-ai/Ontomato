import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { Router } from "express";
import { context, wrap } from "../utils/agent-host";
import { appBuilderBootstrap } from "../../services/app-builder/bootstrap";
import { currentAppSdk } from "../../services/app-builder/sdk";

export const appBuilderRouter = Router();
appBuilderRouter.get("/app-builder/bootstrap", wrap(async (req, res) => {
  const c = context(req);
  await assertAppBuilderAccess(c.credentials);
  res.json(await appBuilderBootstrap(c.owner));
}));
appBuilderRouter.get("/apps-sdk/current", wrap(async (_req, res) => {
  res.json(await currentAppSdk());
}));
