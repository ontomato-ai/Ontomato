import { createLogger } from "../../logging/logger";
const logger = createLogger("agent-host");
import type { Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { HttpError } from "../../utils/errors";
import { getRequestId } from "../../logging/log-context";
const uuid = z.string().uuid();
export function context(req: Request) {
  const r = req as AuthenticatedRequest;
  return {
    owner: { domainId: requireDomainId(r), userId: r.userId },
    credentials: { token: r.token, apiKey: r.apiKey, locale: r.locale },
  };
}
export const id = (r: Request, key: string) => uuid.parse(r.params[key]);
export const wrap =
  (fn: (r: Request, s: Response) => Promise<void>): RequestHandler =>
  (r, s) => {
    void fn(r, s).catch((e) => {
      if (!(e instanceof HttpError) && !(e instanceof z.ZodError)) logger.error("Agent host request failed", e instanceof Error ? e : undefined);
      if (s.headersSent) {
        s.end();
        return;
      }
      const status =
        e instanceof z.ZodError ? 400 : e instanceof HttpError ? e.status : 503;
      const codes: Record<number, string> = {
        400: "INVALID_REQUEST",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "SESSION_BUSY",
      };
      s.status(status).json({
        error: {
          code:
            e instanceof HttpError && e.code
              ? e.code
              : (codes[status] ?? "DEPENDENCY_UNAVAILABLE"),
          message:
            e instanceof HttpError
              ? e.message
              : e instanceof z.ZodError
                ? "Invalid request"
                : "Service unavailable",
        },
        correlationId: getRequestId() ?? "assistant",
      });
    });
  };
