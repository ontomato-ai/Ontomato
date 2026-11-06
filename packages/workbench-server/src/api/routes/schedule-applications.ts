import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  platformScheduleApplicationSchema,
  platformScheduleDeclarationsSchema,
  platformScheduleErrorSchema,
  platformScheduleExecutionRequestSchema,
  platformScheduleExecutionStateSchema,
  platformScheduleExecutionStatusRequestSchema,
  platformScheduleFormRequestSchema,
  platformScheduleFormSchema,
  platformScheduleHttpErrorCodeSchema,
  platformScheduleValidationRequestSchema,
  platformScheduleValidationSchema,
} from "@ontomato/contracts/platform-schedules";
import { environment } from "../../config/environment";
import { getRequestId } from "../../logging/log-context";
import { createLogger } from "../../logging/logger";
import { context } from "../utils/agent-host";
import { HttpError } from "../../utils/errors";
import { describeScheduleApplication, scheduleApplication, scheduleApplicationIds } from "../../services/scheduling/applications";

const logger = createLogger("schedule-applications");
function requirePlatform(req: Request) {
  const supplied = Buffer.from(req.header("X-Ontomato-Query-Service-Token") ?? "");
  const expected = Buffer.from(environment.agentRuntime().queryServiceToken);
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(supplied, expected))
    throw new HttpError(403, "Platform credential required", "PERMISSION_DENIED");
}
function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res) => {
    void (async () => { requirePlatform(req); await handler(req, res); })().catch((error: unknown) => {
      let status = error instanceof z.ZodError ? 400 : error instanceof HttpError ? error.status : 503;
      const defaults: Record<number, string> = { 400: "INVALID_REQUEST", 401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: "TASK_NOT_FOUND", 409: "TASK_RUNNING", 422: "FIELD_VALIDATION_FAILED" };
      const known = platformScheduleHttpErrorCodeSchema.safeParse(error instanceof HttpError ? error.code : undefined);
      const code = known.success ? known.data : defaults[status] ?? "DEPENDENCY_UNAVAILABLE";
      if (status >= 500) { status = 503; logger.error("Scheduled application request failed", error instanceof Error ? error : new Error(String(error))); }
      const details = error instanceof HttpError && error.details && typeof error.details === "object" ? error.details : {};
      const body = platformScheduleErrorSchema.parse({
        error: { code, message: error instanceof HttpError ? error.message : status === 400 ? "Invalid request" : "Application unavailable", ...details },
        correlationId: getRequestId() ?? "schedule",
      });
      res.status(status).json(body);
    });
  };
}

export const scheduleDeclarations = route(async (_req, res) => {
  res.json(platformScheduleDeclarationsSchema.parse({ appIds: scheduleApplicationIds() }));
});
export const scheduleExecutionStatus = route(async (req, res) => {
  const application = scheduleApplication(req.params.appId);
  const state = await application.status(platformScheduleExecutionStatusRequestSchema.parse(req.body));
  res.json(platformScheduleExecutionStateSchema.parse(state));
});

export const scheduleApplicationsRouter = Router();
scheduleApplicationsRouter.get("/:appId", route(async (req, res) => {
  res.json(platformScheduleApplicationSchema.parse(await describeScheduleApplication(req.params.appId, context(req))));
}));
scheduleApplicationsRouter.post("/:appId/form", route(async (req, res) => {
  const application = scheduleApplication(req.params.appId), caller = context(req);
  await application.authorize(caller);
  res.json(platformScheduleFormSchema.parse(await application.form(platformScheduleFormRequestSchema.parse(req.body), caller)));
}));
scheduleApplicationsRouter.post("/:appId/validate", route(async (req, res) => {
  const application = scheduleApplication(req.params.appId), caller = context(req);
  await application.authorize(caller);
  res.json(platformScheduleValidationSchema.parse(await application.validate(platformScheduleValidationRequestSchema.parse(req.body), caller)));
}));
scheduleApplicationsRouter.post("/:appId/runs", route(async (req, res) => {
  const application = scheduleApplication(req.params.appId), caller = context(req);
  const input = platformScheduleExecutionRequestSchema.parse(req.body);
  if (input.appId !== application.id) throw new HttpError(400, "Application does not match the execution", "INVALID_REQUEST");
  await application.authorize(caller);
  const state = platformScheduleExecutionStateSchema.parse(await application.start(input, caller));
  res.status(state.status === "running" ? 202 : 200).json(state);
}));
