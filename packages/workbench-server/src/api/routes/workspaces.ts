import { WorkspaceBuildTests } from "../../services/app-builder/build-tests";
import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { agentHostSessionPageQuerySchema } from "@ontomato/contracts/agent-host";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {readFile} from 'node:fs/promises';
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { workspaceIdSchema, workspacePathSchema, workspaceNameSchema, workspaceImportSchema, workspaceRestoreSchema, workspaceReadSchema, workspaceContentSchema, workspacePageSchema, workspaceDiffSchema, hostedPublishSchema, hostedRollbackSchema, hostedAppIdSchema } from "@ontomato/contracts/workspaces";
import { context, id } from "../utils/agent-host";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { panelCandidateQuerySchema, readPanelCandidate } from "../../services/workspaces/panel-candidate";
import { workspaceSessions } from "../../services/workspaces/sessions";
import { runtimeDataDir } from "../../content/layout";
import { HttpError } from "../../utils/errors";
import { assistantService } from "../../services/assistant/service";
import { publishWorkspace, rollbackWorkspace, workspaceReleases } from "../../services/workspaces/hosted-apps";
import {getApplicationProduct} from '../../services/product-assets/store';
import {backendGet,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {SOURCE_APPLICATION_CSP} from '../../services/workspaces/product-admission';
import { mountAppsSdkStatic } from "./apps-sdk";
import type { AssistantOwner } from "../../services/assistant/store";

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(error => next(error instanceof z.ZodError ? new HttpError(400, error.message, "INVALID_REQUEST") : error));
  };
const previews = new Map<string, { workspaceId: string; owner: AssistantOwner; expiresAt: number }>();
const runtime = (owner: AssistantOwner) => new RuntimeClient(owner.domainId, undefined, owner.userId);
export const workspacePreviewRouter = Router();
workspacePreviewRouter.get("/:id/preview/:token/*", wrap(async (req, res) => {
  const preview = previews.get(req.params.token);
  if (!preview || preview.workspaceId !== workspaceIdSchema.parse(req.params.id) || preview.expiresAt <= Date.now())
    throw new HttpError(404, "Preview expired", "NOT_FOUND");
  const file = workspacePathSchema.parse(req.params[0] || "index.html");
  if(path.extname(file).toLowerCase()===".html") await new WorkspaceBuildTests(preview.owner,{},preview.workspaceId).requirePreviewSdk();
  res.type(path.extname(file)).set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" })
    .send(await runtime(preview.owner).bytes(`/v1/workspaces/${preview.workspaceId}/files/content?${new URLSearchParams({ path: file })}`));
}));
export const workspaceRouter = Router();
workspaceRouter.get('/applications/:appId/policy',wrap(async(req,res)=>{
  const {owner,credentials}=context(req),appId=hostedAppIdSchema.parse(req.params.appId);
  const headers=buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey);
  const catalog=JSON.parse((await backendGet('application-policy-admission',config.dataQuery.baseUrl+'/platform/applications?purpose=navigation',{headers,retries:1})).text);
  const listed=catalog.success&&Array.isArray(catalog.data)?catalog.data.find((entry:{id:string;kind?:string})=>entry.id===appId):undefined;
  if(!listed)throw new HttpError(403,'Application use permission required','PRODUCT_FORBIDDEN');
  if(listed.kind==='connected'){res.json({messageBridge:0});return;}
  await getApplicationProduct(owner,appId);
  const response=await backendGet('application-network-policy',config.dataQuery.baseUrl+'/platform/applications/'+encodeURIComponent(appId),{headers,retries:1});
  const application=JSON.parse(response.text);
  if(!application.success||!application.data?.releaseId)throw new HttpError(404,'Application release unavailable','NOT_FOUND');
  let policy;try{policy=JSON.parse(await readFile(runtimeDataDir('hosted-apps',appId,workspaceIdSchema.parse(application.data.releaseId),'.ontomato-network-policy.json'),'utf8'));}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
  if(![undefined,2].includes(policy?.messageBridge))throw new HttpError(409,'Unsupported application message bridge','PRODUCT_SDK_UPGRADE_REQUIRED');
  res.json({messageBridge:policy?.messageBridge??0});
}));
for (const method of ["get", "post", "delete"] as const) {
  workspaceRouter[method]("/:id/build-tests", wrap(async (req,res) => {
    const c=context(req);await assertAppBuilderAccess(c.credentials);
    const tests=new WorkspaceBuildTests(c.owner,c.credentials,id(req,"id"));
    const result=method==="get" ? await tests.current() : method==="delete" ? await tests.stop()
      : await tests.start(z.object({samplePath:z.string().optional()}).strict().parse(req.body).samplePath);
    res.json(result);
  }));
}
workspaceRouter.get("/:id/panel-candidate", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { ref } = panelCandidateQuerySchema.parse(req.query);
  const source = await readPanelCandidate(owner, credentials, { id: id(req, "id"), ref });
  res.set("Cache-Control", "no-store").json(source);
}));
workspaceRouter.post("/:id/preview-token", wrap(async (req, res) => {
  const owner = context(req).owner, workspaceId = id(req, "id");
  const tests=new WorkspaceBuildTests(owner,context(req).credentials,workspaceId);
  await tests.requirePreviewSdk();
  const token = randomBytes(32).toString("base64url"), expiresAt = Date.now() + 10 * 60_000;
  previews.set(token, { workspaceId, owner, expiresAt });
  setTimeout(() => previews.delete(token), 10 * 60_000).unref();
  res.json({ token, expiresAt: new Date(expiresAt).toISOString() });
}));
workspaceRouter.get("/:id/sessions", wrap(async (req, res) => {
  res.json(await workspaceSessions(context(req).owner, id(req, "id"), agentHostSessionPageQuerySchema.parse(req.query)));
}));
workspaceRouter.post("/:id/publish", wrap(async (req, res) => {
  const c = context(req), input = hostedPublishSchema.parse(req.body);
  res.json(await publishWorkspace(c.owner, id(req, "id"), input.commit, input.declaration, c.credentials));
}));
workspaceRouter.get("/:id/releases", wrap(async (req, res) => {
  res.json({ items: await workspaceReleases(context(req).owner, id(req, "id")) });
}));
workspaceRouter.post("/:id/rollback", wrap(async (req, res) => {
  const c = context(req), input = hostedRollbackSchema.parse(req.body);
  res.json(await rollbackWorkspace(c.owner, id(req, "id"), input.releaseId, input.declaration, c.credentials));
}));
workspaceRouter.delete("/:id", wrap(async (req, res) => {
  const c=context(req), owner = c.owner;
  await new WorkspaceBuildTests(owner,c.credentials,id(req,"id")).stop();
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
export function mountHostedStatic(app: express.Express) {
  app.get("/internal/hosted-apps/:appId/:releaseId/*", wrap(async(req, res) => {
    const appId = hostedAppIdSchema.parse(req.params.appId), releaseId = workspaceIdSchema.parse(req.params.releaseId);
    const file = workspacePathSchema.parse(req.params[0] || "index.html");
    if(['.ontomato-network-policy.json','.ontomato-source-function.json'].includes(file))throw new HttpError(404,'File unavailable','NOT_FOUND');
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",'Access-Control-Allow-Origin':'*' });
    let policy;
    try{policy=JSON.parse(await readFile(runtimeDataDir('hosted-apps',appId,releaseId,'.ontomato-network-policy.json'),'utf8'));}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;}
    if(policy?.messageBridge===2)res.set('Content-Security-Policy',SOURCE_APPLICATION_CSP);
    else if(policy?.hostTransport===1)res.set('Content-Security-Policy',"connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'");
    await new Promise<void>((resolve,reject)=>{res.sendFile(file, { root: runtimeDataDir("hosted-apps", appId, releaseId), dotfiles: "allow", cacheControl: false, lastModified: false, etag: false },error=>error?reject(error):resolve());});
  }));
  mountAppsSdkStatic(app);
}
