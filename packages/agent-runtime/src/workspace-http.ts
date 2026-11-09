import path from "node:path";
import { RuntimeError } from "./errors";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { workspaceNameSchema, workspaceImportSchema, workspaceRestoreSchema, workspacePageSchema, workspaceReadSchema, workspaceContentSchema, workspaceDiffSchema, workspaceIdSchema } from "@ontomato/contracts/workspaces";
import type { AgentRuntime } from "./runtime";
import type { Scope } from "./store";
export const workspaceOwner = (req: Request) => z.string().min(1).parse(req.header("X-Workspace-Owner-Id"));
export function workspaceRouter(runtime: AgentRuntime, scope: (req: Request) => Scope) {
  const router = Router();
  const route = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(error => {
    next(["ENOENT", "ENOTDIR"].includes(error.code) ? new RuntimeError(404, "NOT_FOUND", "File not found") : error);
  }); };
  router.get("/", route(async (req, res) => {
    const page = workspacePageSchema.parse(req.query);
    res.json(await runtime.workspaces.list(scope(req), workspaceOwner(req), page.offset, page.limit));
  }));
  router.post("/", route(async (req, res) => {
    res.status(201).json(await runtime.workspaces.create(scope(req), workspaceOwner(req), workspaceNameSchema.parse(req.body).name));
  }));
  router.use("/:id", (req, _res, next) => {
    void runtime.workspaces.row(scope(req), workspaceOwner(req), workspaceIdSchema.parse(req.params.id)).then(() => next(), next);
  });
  const id = (req: Request) => workspaceIdSchema.parse(req.params.id);
  const git = (req: Request) => runtime.workspaces.git(scope(req), id(req));
  router.get("/:id", route(async (req, res) => { res.json(await runtime.workspaces.get(scope(req), workspaceOwner(req), id(req))); }));
  router.patch("/:id", route(async (req, res) => { res.json(await runtime.workspaces.rename(scope(req), workspaceOwner(req), id(req), workspaceNameSchema.parse(req.body).name)); }));
  router.delete("/:id", route(async (req, res) => {
    const current = scope(req);
    res.json(await runtime.workspaces.delete(current, workspaceOwner(req), id(req), sessionId => runtime.deleteSession(current, sessionId)));
  }));
  router.get("/:id/tree", route(async (req, res) => {
    const { commit } = workspaceReadSchema.parse(req.query);
    const files = commit ? await git(req).committedFiles(commit) : await git(req).files();
    res.json({ files: files.map(({ path, size }) => ({ path, size })) });
  }));
  router.get("/:id/files/content", route(async (req, res) => {
    const input = workspaceContentSchema.parse(req.query);
    res.type(path.extname(input.path)).set("Cache-Control", "no-store").send(await git(req).content(input.path, input.commit));
  }));
  router.get("/:id/commits", route(async (req, res) => {
    const page = workspacePageSchema.parse(req.query);
    res.json({ items: await git(req).history(page.offset, page.limit) });
  }));
  router.get("/:id/diff", route(async (req, res) => {
    const input = workspaceDiffSchema.parse(req.query);
    res.json({ patch: await git(req).diff(input.from, input.to) });
  }));
  router.post("/:id/import", route(async (req, res) => { res.json(await runtime.workspaces.replace(scope(req), workspaceOwner(req), id(req), workspaceImportSchema.parse(req.body).files)); }));
  router.post("/:id/restore", route(async (req, res) => { res.json(await runtime.workspaces.restore(scope(req), workspaceOwner(req), id(req), workspaceRestoreSchema.parse(req.body).commit)); }));
  router.post("/:id/export", route(async (req, res) => { res.json(await git(req).export(workspaceRestoreSchema.parse(req.body).commit)); }));
  return router;
}
