import { requirePermission } from "../../identity/installed";
import { Router } from "express";
import { context, wrap } from "../utils/agent-host";
import { appBuilderBootstrap } from "../../services/app-builder/bootstrap";
import { currentAppSdk } from "../../services/app-builder/sdk";

export const appBuilderRouter = Router();
appBuilderRouter.get("/app-builder/bootstrap", requirePermission(["app-builder"]), wrap(async (req, res) => {
  res.json(await appBuilderBootstrap(context(req).owner));
}));
appBuilderRouter.get("/apps-sdk/current", wrap(async (_req, res) => {
  res.json(await currentAppSdk());
}));
