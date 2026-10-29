import { type Request, type Response, type NextFunction } from "express";
import { getServiceLogContext, withServiceLogContext } from "@ontomato/service-logging";
import { createLogger } from "../../logging/logger";
import type { AuthenticatedRequest } from "../../utils/request-identity";
const logger = createLogger("http");
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now(), context = { ...getServiceLogContext() };
  const requestPath = req.originalUrl.split(/[?#]/u, 1)[0];
  res.once("close", () => {
    if (/^\/api\/(health|observe\/(logs|runtime-logs|backend-logs|live-logs))(?:\/|$)/u.test(requestPath)) return;
    const authenticated = req as AuthenticatedRequest;
    withServiceLogContext({ ...context, domainId: authenticated.domainId, userId: authenticated.userId }, () => {
      logger.log({ level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        message: "request completed", kind: "http", method: req.method, path: requestPath,
        status: res.headersSent ? res.statusCode : null, durationMs: Math.floor(performance.now() - started),
        outcome: !res.writableFinished ? "cancelled" : res.statusCode >= 400 ? "failure" : "success" });
    });
  });
  next();
}
