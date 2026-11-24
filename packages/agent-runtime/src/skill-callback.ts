import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { correlationId, withServiceLogContext } from "@ontomato/service-logging";
import { businessCallbackRoute, forwardBusinessCallback, type BusinessCallbackDispatcher } from "./business-callback";
import { RuntimeError } from "./errors";
import { runtimeDiagnostic, runtimeLogger } from "./logging";
import { registerSkillCallbackRoutes, type SessionSkillCallbackDispatcher } from "./platform-tools";

const businessMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function openSkillCallback(dispatcher: SessionSkillCallbackDispatcher & BusinessCallbackDispatcher) {
  const app = express();
  const host = "127.0.0.1";
  app.disable("x-powered-by");
  app.use((req, _res, next) => withServiceLogContext({ correlationId: correlationId(req.header("X-Correlation-Id")) }, next));
  const paths = [businessCallbackRoute, businessCallbackRoute + "/*"];
  const forward = (req: Request, res: Response, next: NextFunction) => {
    void forwardBusinessCallback(dispatcher, req, res).catch(next);
  };
  app.all(paths, (req, _res, next) => {
    if (!businessMethods.has(req.method)) {
      next(new RuntimeError(405, "METHOD_NOT_ALLOWED", "Unsupported skill callback method"));
      return;
    }
    next();
  }, express.raw({ type: () => true, limit: "32mb" }), forward);
  app.use(express.json({ limit: "32mb" }));
  registerSkillCallbackRoutes(app, { sessionChannelCommand: (...args) => dispatcher.sessionChannelCommand(...args) });
  app.use((_req, _res, next) => next(new RuntimeError(404, "NOT_FOUND", "Skill callback endpoint not found")));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent || res.destroyed) { res.end(); return; }
    if (error instanceof RuntimeError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
    } else if (error instanceof z.ZodError || error instanceof SyntaxError) {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Invalid skill command" } });
    } else {
      runtimeLogger.error("Skill callback failed", runtimeDiagnostic(error));
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Skill command failed" } });
    }
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, host, () => resolve(listening));
    listening.once("error", reject);
  });
  return {
    endpoint: { host, port: (server.address() as AddressInfo).port },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
