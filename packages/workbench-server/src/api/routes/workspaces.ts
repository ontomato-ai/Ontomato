import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { agentHostSessionPageQuerySchema } from "@ontomato/contracts/agent-host";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { workspaceIdSchema, workspacePathSchema, workspaceNameSchema, workspaceImportSchema, workspaceRestoreSchema, workspaceReadSchema, workspaceContentSchema, workspacePageSchema, workspaceDiffSchema, hostedAppIdSchema } from "@ontomato/contracts/workspaces";
import { context, id } from "../utils/agent-host";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { panelCandidateQuerySchema, readPanelCandidate } from "../../services/workspaces/panel-candidate";
import { workspaceSessions } from "../../services/workspaces/sessions";
import { HttpError } from "../../utils/errors";
import { assistantService } from "../../services/assistant/service";
import {backendGet,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import type { AssistantOwner } from "../../services/assistant/store";

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(error => next(error instanceof z.ZodError ? new HttpError(400, error.message, "INVALID_REQUEST") : error));
  };
const runtime = (owner: AssistantOwner, workspaceOwnerId?: string) =>
  new RuntimeClient(owner.domainId, undefined, owner.userId, workspaceOwnerId ?? owner.userId);

export const workspaceRouter = Router();
workspaceRouter.get('/applications/:appId/policy',wrap(async(req,res)=>{
  const {credentials}=context(req),appId=hostedAppIdSchema.parse(req.params.appId);
  const headers=buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey);
  const catalog=JSON.parse((await backendGet('application-policy-admission',config.dataQuery.baseUrl+'/platform/applications?purpose=navigation',{headers,retries:1})).text);
  const listed=catalog.success&&Array.isArray(catalog.data)?catalog.data.find((entry:{id:string;kind?:string})=>entry.id===appId):undefined;
  if(listed?.kind!=='connected')throw new HttpError(403,'Application use permission required','PRODUCT_FORBIDDEN');
  res.json({messageBridge:0});
}));
workspaceRouter.get("/:id/panel-candidate", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { ref } = panelCandidateQuerySchema.parse(req.query);
  const source = await readPanelCandidate(owner, credentials, { id: id(req, "id"), ref });
  res.set("Cache-Control", "no-store").json(source);
}));
workspaceRouter.get("/:id/sessions", wrap(async (req, res) => {
  res.json(await workspaceSessions(context(req).owner, id(req, "id"), agentHostSessionPageQuerySchema.parse(req.query)));
}));
workspaceRouter.delete("/:id", wrap(async (req, res) => {
  const c=context(req), owner = c.owner;
  const deleted = z.object({ sessionIds: z.array(workspaceIdSchema) }).parse(await runtime(owner).request(`/v1/workspaces/${id(req, "id")}`, "DELETE"));
  for (const sessionId of deleted.sessionIds) await assistantService.delete(sessionId, owner);
  res.sendStatus(204);
}));
workspaceRouter.get("/:id/files/content", wrap(async (req, res) => {
  const input = workspaceContentSchema.parse(req.query);
  res.set({ "Content-Disposition": "attachment", "Cache-Control": "no-store" }).type(path.extname(input.path))
    .send(await runtime(context(req).owner).bytes(`/v1/workspaces/${id(req, "id")}/files/content?${new URLSearchParams(input)}`));
}));
for (const [suffix, schema] of [["", workspacePageSchema], ["/:id", z.object({}).strict()], ["/:id/tree", workspaceReadSchema], ["/:id/commits", workspacePageSchema], ["/:id/diff", workspaceDiffSchema]] as const) {
  workspaceRouter.get(suffix || "/", wrap(async (req, res) => {
    const query = schema.parse(req.query);
    const route = suffix.replace(":id", req.params.id ? id(req, "id") : "");
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    res.json(await runtime(context(req).owner).request(`/v1/workspaces${route}?${params}`));
  }));
}
for (const [method, suffix, schema] of [["post", "", workspaceNameSchema], ["patch", "/:id", workspaceNameSchema], ["post", "/:id/import", workspaceImportSchema], ["post", "/:id/restore", workspaceRestoreSchema], ["post", "/:id/export", workspaceRestoreSchema]] as const) {
  workspaceRouter[method](suffix || "/", wrap(async (req, res) => {
    const body = schema.parse(req.body);
    const route = suffix.replace(":id", req.params.id ? id(req, "id") : "");
    res.status(suffix ? 200 : 201).json(await runtime(context(req).owner).request(`/v1/workspaces${route}`, method.toUpperCase(), body));
  }));
}
