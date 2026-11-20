import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { Router } from "express";
import { context, wrap } from "../utils/agent-host";
import { appBuilderBootstrap } from "../../services/app-builder/bootstrap";
import { currentAppSdk } from "../../services/app-builder/sdk";
import {modelSelectionSchema} from '@ontomato/contracts/model-settings';
import {z} from 'zod';
import {listBuilderAgents,createBuilderAgent,saveBuilderModel} from '../../services/app-builder/agents';

export const appBuilderRouter = Router();
appBuilderRouter.post('/app-builder/agents',wrap(async(req,res)=>{const c=context(req);await assertAppBuilderAccess(c.credentials);const input=z.object({name:z.string().trim().min(1).max(200),modelSelection:modelSelectionSchema}).strict().parse(req.body);res.status(201).json(await createBuilderAgent(c.owner,input));}));
appBuilderRouter.get('/app-builder/agents',wrap(async(req,res)=>{const c=context(req);await assertAppBuilderAccess(c.credentials);res.json({agents:await listBuilderAgents(c.owner)});}));
appBuilderRouter.put('/app-builder/agents/:id/model',wrap(async(req,res)=>{const c=context(req);await assertAppBuilderAccess(c.credentials);res.json(await saveBuilderModel(c.owner,z.string().uuid().parse(req.params.id),modelSelectionSchema.parse(req.body.modelSelection)));}));
appBuilderRouter.get("/app-builder/bootstrap", wrap(async (req, res) => {
  const c = context(req);
  await assertAppBuilderAccess(c.credentials);
  res.json(await appBuilderBootstrap(c.owner));
}));
appBuilderRouter.get("/app-builder/type-table", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  await assertAppBuilderAccess(credentials);
  const { readPanelTypeTable } = await import("../../services/product-panels/type-table");
  res.json(await readPanelTypeTable(owner, credentials));
}));
appBuilderRouter.get("/apps-sdk/current", wrap(async (_req, res) => {
  res.json(await currentAppSdk());
}));
