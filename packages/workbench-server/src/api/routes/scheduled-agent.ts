import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { environment } from "../../config/environment";
import { context, wrap } from "../utils/agent-host";
import { HttpError } from "../../utils/errors";
import { assistantService } from "../../services/assistant/service";
import { assistantStore } from "../../services/assistant/store";
import { withScheduledUserActivity } from "../../services/assistant/scheduled-activity";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runOutcome } from "../../platform/agent-runtime/projection";
import { messageText } from "../../platform/agent-runtime/runtime";
import type { Request } from "express";

function requirePlatform(req: Request) {
  const supplied = Buffer.from(
    req.header("X-Ontomato-Query-Service-Token") ?? "",
  );
  const expected = Buffer.from(environment.agentRuntime().queryServiceToken);
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new HttpError(403, "Platform credential required");
}

const target = z.object({ agentId: z.string().uuid() });
async function requireAgent(
  agentId: string,
  owner: { domainId: string; userId: string },
) {
  const agent = await assistantStore.agent(agentId, owner).catch((error) => {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(409, "Agent no longer exists", "AGENT_UNAVAILABLE");
    throw error;
  });
  if (!agent.enabled)
    throw new HttpError(409, "Agent disabled", "AGENT_UNAVAILABLE");
}

export const validateScheduledAgent = wrap(async (req, res) => {
  requirePlatform(req);
  await requireAgent(target.parse(req.body).agentId, context(req).owner);
  res.sendStatus(204);
});

export const startScheduledAgent = wrap(async (req, res) => {
  requirePlatform(req);
  const input = target
    .extend({
      runId: z.string().uuid(),
      sessionId: z.string().uuid(),
      prompt: z.string().trim().min(1).max(4000),
    })
    .strict()
    .parse(req.body);
  const { owner, credentials } = context(req);
  await withScheduledUserActivity(owner.userId, async () => {
    await requireAgent(input.agentId, owner);
    const created = await assistantService.create(
      input.sessionId,
      owner,
      { agentId: input.agentId },
      "scheduled",
    );
    try {
      await assistantService.start(
        input.sessionId,
        input.runId,
        input.prompt,
        owner,
        credentials,
      );
    } catch (error) {
      if (
        !created.replayed &&
        (await assistantStore.turns(input.sessionId)).length === 0
      )
        await assistantService.delete(input.sessionId, owner);
      throw error;
    }
  });
  res.sendStatus(202);
});

/** Only the platform may ask on behalf of a persisted task. Settlement reads do not admit or repair turns. */
export const scheduledAgentStatus = wrap(async (req, res) => {
  requirePlatform(req);
  const { owner, sessionId, runId } = z
    .object({
      owner: z.object({ userId: z.string(), domainId: z.string() }),
      sessionId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict()
    .parse(req.body);
  await assistantService.ownRun(sessionId, runId, owner);
  const client = new RuntimeClient(owner.domainId);
  const run = await client.status(runId);
  const status = runOutcome(run);
  const reply = status === "completed" ? await client.finalReply(runId) : null;
  res.json({
    status,
    answer: reply ? messageText(reply) : null,
    error: run.errorMessage ?? run.stopReason,
  });
});
