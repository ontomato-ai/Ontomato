import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { getServiceLogContext, LogQueryError } from "@ontomato/service-logging";
import { serviceLogQuerySchema } from "@ontomato/contracts/service-logging";
import { queryWorkbenchServiceLogs, queryRuntimeServiceLogs } from "../../platform/diagnosis/observe/service-logs";
import { HttpError } from "../../utils/errors";
import type { AuthenticatedRequest } from "../../utils/request-identity";

const router: ReturnType<typeof Router> = Router();
/** Keep the edition's authentication decision while exposing the new endpoint's error shape. */
export const serviceLogAuthResponse: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if ((res.statusCode === 401 || res.statusCode === 403) && typeof body?.error !== "object") {
      return json({ error: { code: res.statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
        message: typeof body?.error === "string" ? body.error : "Service log access denied" }, correlationId: getServiceLogContext().correlationId });
    }
    return json(body);
  };
  next();
};
for (const runtime of [false, true]) router.get(runtime ? "/runtime-logs" : "/logs", async (req, res) => {
  try {
    const query = serviceLogQuerySchema.parse(req.query);
    res.json(await (runtime ? queryRuntimeServiceLogs(query, (req as AuthenticatedRequest).domainId) : queryWorkbenchServiceLogs(query)));
  } catch (error) {
    const known = error instanceof HttpError || error instanceof LogQueryError;
    const status = known ? error.status : error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ error: { code: known ? error.code ?? "LOG_QUERY_FAILED" : status === 400 ? "INVALID_LOG_QUERY" : "LOG_QUERY_FAILED",
      message: known ? error.message : status === 400 ? "Invalid log query" : "Service log query failed" }, correlationId: getServiceLogContext().correlationId });
  }
});
export default router;
