import { randomBytes } from "node:crypto";
import path from "node:path";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { workspaceIdSchema, workspacePathSchema, workspaceNameSchema, workspaceImportSchema, workspaceRestoreSchema, workspaceReadSchema, workspaceContentSchema, workspacePageSchema, workspaceDiffSchema, hostedPublishSchema, hostedRollbackSchema, hostedAppIdSchema } from "@ontomato/contracts/workspaces";
import { context, id } from "../utils/agent-host";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { workspaceSessions } from "../../services/workspaces/sessions";
import { runtimeDataDir } from "../../content/layout";
import { HttpError } from "../../utils/errors";
import { assistantService } from "../../services/assistant/service";
import { publishWorkspace, rollbackWorkspace, workspaceReleases } from "../../services/workspaces/hosted-apps";
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
  res.type(path.extname(file)).set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" })
    .send(await runtime(preview.owner).bytes(`/v1/workspaces/${preview.workspaceId}/files/content?${new URLSearchParams({ path: file })}`));
}));
export const workspaceRouter = Router();
workspaceRouter.post("/:id/preview-token", wrap(async (req, res) => {
  const owner = context(req).owner, workspaceId = id(req, "id");
  await runtime(owner).request(`/v1/workspaces/${workspaceId}`);
  const token = randomBytes(32).toString("base64url"), expiresAt = Date.now() + 10 * 60_000;
  previews.set(token, { workspaceId, owner, expiresAt });
  setTimeout(() => previews.delete(token), 10 * 60_000).unref();
  res.json({ token, expiresAt: new Date(expiresAt).toISOString() });
}));
workspaceRouter.get("/:id/sessions", wrap(async (req, res) => {
  res.json(await workspaceSessions(context(req).owner, id(req, "id")));
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
  const owner = context(req).owner;
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
  app.get("/internal/hosted-apps/:appId/:releaseId/*", (req: Request, res: Response, next: NextFunction) => {
    const appId = hostedAppIdSchema.parse(req.params.appId), releaseId = workspaceIdSchema.parse(req.params.releaseId);
    const file = workspacePathSchema.parse(req.params[0] || "index.html");
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.sendFile(file, { root: runtimeDataDir("hosted-apps", appId, releaseId), dotfiles: "allow", cacheControl: false, lastModified: false, etag: false }, next);
  });
  app.use("/apps-sdk", express.static(runtimeDataDir("apps-sdk"), { fallthrough: false, redirect: false, index: "index.js" }));
}
