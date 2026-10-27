import { Router } from "express";
import { z } from "zod";
import {
  governanceMessageInputSchema,
  governanceSkillCallIdentitySchema,
  governanceRuntimeToolNameSchema,
} from "@ontomato/contracts/knowledge-governance";
import { governanceRuntime } from "../../services/knowledge-governance/runtime";
import { governanceStore } from "../../services/knowledge-governance/store";
import {
  readGovernanceSource,
  executeGovernanceAction,
} from "../../services/knowledge-governance/tools";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
import { HttpError } from "../../utils/errors";
import { requirePermission } from "../../identity/installed";
import { asyncHandler } from "../utils/http";
import { renderPrompt } from "../../core/prompts/loader";
import { getLogContext, runWithLogContext } from "../../logging/log-context";

const router: ReturnType<typeof Router> = Router();
router.use(requirePermission(["business-knowledge"]));
function context(req: AuthenticatedRequest) {
  const domainId = requireDomainId(req);
  return {
    owner: { domainId, userId: req.userId },
    credentials: { domainId, token: req.token, apiKey: req.apiKey },
    locale: req.locale,
  };
}
function messageInput(body: unknown) {
  const input = governanceMessageInputSchema.safeParse(body);
  if (!input.success)
    throw new HttpError(
      400,
      "A non-empty message up to 20000 characters is required",
    );
  return input.data.message;
}
function sessionId(value: string) {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new HttpError(400, "Invalid session id");
  return result.data;
}
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(
      await governanceRuntime.list(context(req as AuthenticatedRequest).owner),
    );
  }),
);
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const message = messageInput(req.body);
    const { owner, credentials, locale } = context(req as AuthenticatedRequest);
    res
      .status(201)
      .json(await governanceRuntime.start(owner, credentials, locale, message));
  }),
);
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(
      await governanceRuntime.get(
        sessionId(req.params.id!),
        context(req as AuthenticatedRequest).owner,
      ),
    );
  }),
);
router.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const message = messageInput(req.body);
    const { owner, credentials, locale } = context(req as AuthenticatedRequest);
    res.json(
      await governanceRuntime.respond(
        sessionId(req.params.id!),
        owner,
        credentials,
        locale,
        message,
      ),
    );
  }),
);
// The turn id comes from the snapshot, so a resumed cursor only ever applies to its own turn.
// Closing this subscription only detaches the page; Stop is the explicit cancel.
router.get(
  "/:id/turns/:turnId/stream",
  asyncHandler(async (req, res) => {
    await governanceRuntime.stream(
      sessionId(req.params.id!),
      context(req as AuthenticatedRequest).owner,
      sessionId(req.params.turnId!),
      res,
    );
  }),
);
router.post(
  "/:id/stop",
  asyncHandler(async (req, res) => {
    res.json(
      await governanceRuntime.stop(
        sessionId(req.params.id!),
        context(req as AuthenticatedRequest).owner,
      ),
    );
  }),
);
router.get(
  "/:id/sources/:sourceId",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    const offset = z.coerce
      .number()
      .int()
      .nonnegative()
      .safeParse(req.query.offset || 0);
    if (!offset.success) throw new HttpError(400, "Invalid source offset");
    const record = await governanceStore.get(sessionId(req.params.id!), owner);
    res.json(
      await readGovernanceSource(
        record,
        credentials,
        req.params.sourceId!,
        offset.data,
      ),
    );
  }),
);
router.post(
  "/:id/runtime/:operation/:tool?",
  asyncHandler(async (req, res) => {
    const { owner, credentials, locale } = context(req as AuthenticatedRequest);
    const identity = governanceSkillCallIdentitySchema.parse(
      req.body?.identity,
    );
    if (identity.governanceSessionId !== sessionId(req.params.id!))
      throw new HttpError(
        400,
        "Governance session identity does not match the route",
      );
    const current = await governanceStore.runWork(identity, owner);
    if (!current.open) {
      res
        .status(409)
        .json({
          code: "GOVERNANCE_RUN_CLOSED",
          runId: identity.runId,
          error: "Governance run is closed",
        });
      return;
    }
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (req.params.operation === "context" && !req.params.tool) {
        const work = current.work;
        res.json({
          systemContext: renderPrompt(
            "knowledge-governance.main.system",
            {
              progress: JSON.stringify({
                summary: work.summary,
                notes: work.notes,
                reviewed: work.reviewedKnowledgeIds.length,
                knowledgeTotal: work.knowledgeTotal,
                issues: work.issues.map((issue) => ({
                  id: issue.id,
                  title: issue.title,
                  status: issue.status,
                })),
              }),
            },
            locale,
          ),
        });
      } else if (req.params.operation === "tools") {
        const name = governanceRuntimeToolNameSchema.parse(req.params.tool);
        const result = await runWithLogContext(
          { ...getLogContext(), correlationId: req.header("x-correlation-id") },
          () =>
            executeGovernanceAction(
              name,
              req.body.arguments,
              identity,
              owner,
              credentials,
              controller.signal,
            ),
        );
        res.json({ result });
      } else throw new HttpError(404, "Governance callback not found");
    } catch (error) {
      if ((error as { code?: string })?.code === "GOVERNANCE_RUN_CLOSED") {
        res
          .status(409)
          .json({
            code: "GOVERNANCE_RUN_CLOSED",
            runId: identity.runId,
            error: "Governance run is closed",
          });
        return;
      }
      throw error;
    }
  }),
);
export default router;
