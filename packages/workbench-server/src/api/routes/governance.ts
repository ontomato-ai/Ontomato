import { Router } from "express";
import { z } from "zod";
import { context, id, wrap } from "../utils/agent-host";
import { platformService } from "../middleware/platform-service";
import { governanceRunStatus, openGovernanceWindow } from "../../services/assistant/governance";
import { HttpError } from "../../utils/errors";

export const governanceWindowsRouter = Router();
governanceWindowsRouter.post("/:sessionId/governance-window", wrap(async (req, res) => {
  const callback = res.locals.runtimeCallback as { runId: string } | undefined;
  if (!callback) throw new HttpError(403, "A runtime callback credential is required", "FORBIDDEN");
  const body = z.object({ recordId: z.string().uuid().optional() }).strict().parse(req.body);
  const caller = context(req);
  res.json(await openGovernanceWindow(id(req, "sessionId"), callback.runId, body.recordId, caller.owner, caller.credentials));
}));
export const assistantInternalRouter = Router();
assistantInternalRouter.use(platformService);
assistantInternalRouter.get("/sessions/:sessionId/runs/:runId/status", wrap(async (req, res) => {
  const domain = z.string().min(1).parse(req.header("X-Domain-Id"));
  res.json(await governanceRunStatus(id(req, "sessionId"), id(req, "runId"), domain));
}));
