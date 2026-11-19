import { Router } from "express";
import { z } from "zod";
import { context, wrap } from "../utils/agent-host";
import { HttpError } from "../../utils/errors";
import {readDefinition,executeDefinition,saveDefinition} from '../../services/business-definitions/definitions';
import {readDefinitionTrigger,saveDefinitionTrigger} from '../../services/business-definitions/triggers';

export const businessDefinitionsRouter = Router();
businessDefinitionsRouter.get('/:id',wrap(async(req,res)=>{res.json({definition:await readDefinition(context(req).owner,String(req.params.id))});}));
businessDefinitionsRouter.put('/:id',wrap(async(req,res)=>{const c=context(req);const input=z.object({definition:z.unknown(),revision:z.number().int().nonnegative()}).strict().parse(req.body);if((input.definition as {id?:string})?.id!==req.params.id)throw new HttpError(400,'Definition ID mismatch','INVALID_REQUEST');res.json({definition:await saveDefinition(c.owner,c.credentials,input.definition,input.revision)});}));
businessDefinitionsRouter.post('/:id/query',wrap(async(req,res)=>{const c=context(req);const input=z.object({parameters:z.record(z.unknown()),fields:z.array(z.string().min(1).max(200)).min(1).max(100),offset:z.number().int().nonnegative().default(0),projectionId:z.string().min(1).max(200).optional()}).strict().parse(req.body);res.json(await executeDefinition(c.owner,c.credentials,String(req.params.id),input.parameters,input.fields,input.offset,input.projectionId));}));

export const definitionTriggersRouter = Router();
definitionTriggersRouter.get('/:id',wrap(async(req,res)=>{res.json({trigger:await readDefinitionTrigger(context(req).owner,String(req.params.id))});}));
definitionTriggersRouter.put('/:id',wrap(async(req,res)=>{const c=context(req);const input=z.object({trigger:z.unknown(),revision:z.number().int().nonnegative()}).strict().parse(req.body);if((input.trigger as {id?:string})?.id!==req.params.id)throw new HttpError(400,'Trigger ID mismatch','INVALID_REQUEST');res.json({trigger:await saveDefinitionTrigger(c.owner,c.credentials,input.trigger,input.revision)});}));
