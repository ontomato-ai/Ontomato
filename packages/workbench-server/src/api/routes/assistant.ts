import { exportConversationPpt } from "../../services/assistant/export";
import { safePptFileName } from "../../services/analysis-agent/delivery/ppt-artifacts";
import { requirePermission } from "../../identity/installed";
import { assistantSkillCatalog } from "../../services/assistant/skills";
import {
  readAgentDefinition,
  listAgentDefinitions,
  deleteAgentDefinition,
  saveAgentDefinition,
  createAgentDefinition,
} from "../../services/assistant/definitions";
import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { z } from "zod";
import {
  assistantAgentInputSchema,
  assistantFeedbackWriteSchema,
} from "@ontomato/contracts/assistant-chat";
import {
  agentHostCreateSessionSchema,
  agentHostStartRunSchema,
} from "@ontomato/contracts/agent-host";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  assistantService,
  publicSnapshot,
} from "../../services/assistant/service";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
import { HttpError } from "../../utils/errors";
import { getRequestId } from "../../logging/log-context";
import { buildAttachmentContentDisposition } from "../utils/http";
const router: ReturnType<typeof Router> = Router(),
  uuid = z.string().uuid();
function context(req: Request) {
  const r = req as AuthenticatedRequest;
  return {
    owner: { domainId: requireDomainId(r), userId: r.userId },
    credentials: { token: r.token, apiKey: r.apiKey, locale: r.locale },
  };
}
const id = (r: Request, key: string) => uuid.parse(r.params[key]);
const wrap =
  (fn: (r: Request, s: Response) => Promise<void>): RequestHandler =>
  (r, s) => {
    void fn(r, s).catch((e) => {
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
router.get(
  "/agents",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(await assistantService.agents(c.owner, c.credentials.locale));
  }),
);
const agentAdmin = requirePermission(["analysis-agent"]);
router.get("/agent-skills", agentAdmin, wrap(async (req, res) => {
  const c = context(req);
  res.json(await assistantSkillCatalog(c.owner.domainId, c.credentials.locale));
}));
router.get(
  "/agent-definitions",
  agentAdmin,
  wrap(async (req, res) => {
    res.json(await listAgentDefinitions(context(req).owner));
  }),
);
router.delete(
  "/agent-definitions/:agentId",
  agentAdmin,
  wrap(async (req, res) => {
    await deleteAgentDefinition(id(req, "agentId"), context(req).owner);
    res.sendStatus(204);
  }),
);
router.get(
  "/agent-definitions/:agentId",
  agentAdmin,
  wrap(async (req, res) => {
    res.json(await readAgentDefinition(id(req, "agentId"), context(req).owner));
  }),
);
router.post(
  "/agent-definitions",
  agentAdmin,
  wrap(async (req, res) => {
    res
      .status(201)
      .json(
        await createAgentDefinition(
          uuid.parse(req.header("Idempotency-Key")),
          assistantAgentInputSchema.parse(req.body),
          context(req).owner,
        ),
      );
  }),
);
router.put(
  "/agent-definitions/:agentId",
  agentAdmin,
  wrap(async (req, res) => {
    res.json(
      await saveAgentDefinition(
        id(req, "agentId"),
        assistantAgentInputSchema.parse(req.body),
        context(req).owner,
      ),
    );
  }),
);
router.get(
  "/sessions",
  wrap(async (req, res) => {
    res.json(
      await assistantService.list(
        context(req).owner,
        z
          .object({
            agentId: uuid,
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
          })
          .parse(req.query),
      ),
    );
  }),
);
router.post(
  "/sessions",
  wrap(async (req, res) => {
    res
      .status(201)
      .json(
        await assistantService.create(
          uuid.parse(req.header("Idempotency-Key")),
          context(req).owner,
          agentHostCreateSessionSchema.parse(req.body),
        ),
      );
  }),
);
router.get(
  "/sessions/:sessionId",
  wrap(async (req, res) => {
    res.json(
      await assistantService.snapshot(id(req, "sessionId"), context(req).owner),
    );
  }),
);
router.delete(
  "/sessions/:sessionId",
  wrap(async (req, res) => {
    await assistantService.delete(id(req, "sessionId"), context(req).owner);
    res.sendStatus(204);
  }),
);
router.post(
  "/sessions/:sessionId/export/ppt",
  wrap(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const { buffer } = await exportConversationPpt(
      id(req, "sessionId"),
      context(req).owner,
      controller.signal,
    );
    res
      .set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": buildAttachmentContentDisposition(
          safePptFileName("conversation"),
        ),
      })
      .send(buffer);
  }),
);
router.post(
  "/sessions/:sessionId/runs",
  wrap(async (req, res) => {
    const c = context(req);
    res
      .status(202)
      .json(
        await assistantService.start(
          id(req, "sessionId"),
          uuid.parse(req.header("Idempotency-Key")),
          agentHostStartRunSchema.parse(req.body).message,
          c.owner,
          c.credentials,
        ),
      );
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId",
  wrap(async (req, res) => {
    res.json(
      publicSnapshot(
        await assistantService.readRun(
          id(req, "sessionId"),
          id(req, "runId"),
          context(req).owner,
        ),
      ),
    );
  }),
);
router.post(
  "/sessions/:sessionId/runs/:runId/cancel",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(
      await assistantService.cancel(
        id(req, "sessionId"),
        id(req, "runId"),
        c.owner,
        c.credentials,
      ),
    );
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/events",
  wrap(async (req, res) => {
    const c = context(req),
      runId = id(req, "runId");
    await assistantService.readRun(id(req, "sessionId"), runId, c.owner);
    const cursor = {
        runId,
        seq: z.coerce.number().int().nonnegative().parse(req.query.afterSeq),
        streamId: uuid.parse(req.query.streamId),
      },
      abort = new AbortController();
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.on("close", () => abort.abort());
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    try {
      await new RuntimeClient(c.owner.domainId).stream(
        cursor,
        async (frame) => {
          res.write(
            `${frame.type === "event" ? `id: ${frame.envelope.cursor.seq}\n` : ""}event: runtime\ndata: ${JSON.stringify(frame)}\n\n`,
          );
        },
        abort.signal,
      );
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/artifacts/resolve",
  wrap(async (req, res) => {
    res.json(
      await assistantService.resolve(
        id(req, "sessionId"),
        id(req, "runId"),
        runtimeRelativePathSchema.parse(req.query.path),
        context(req).owner,
      ),
    );
  }),
);
router.get(
  "/sessions/:sessionId/artifacts/:artifactId",
  wrap(async (req, res) => {
    res.json(
      await assistantService.artifact(
        id(req, "sessionId"),
        id(req, "artifactId"),
        context(req).owner,
      ),
    );
  }),
);
router.get(
  "/sessions/:sessionId/artifacts/:artifactId/content",
  wrap(async (req, res) => {
    const { owner } = context(req),
      sessionId = id(req, "sessionId"),
      artifactId = id(req, "artifactId"),
      a = await assistantService.artifact(sessionId, artifactId, owner),
      bytes = await assistantService.content(sessionId, artifactId, owner);
    res.set({
      "Content-Type": a.mediaType,
      "Content-Length": String(bytes.length),
      ETag: `"${a.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    });
    if (req.query.download === "1" || a.path.endsWith(".html"))
      res.set(
        "Content-Disposition",
        buildAttachmentContentDisposition(a.path.split("/").at(-1)!),
      );
    res.send(bytes);
  }),
);
router.get(
  "/sessions/:sessionId/artifacts/:artifactId/dataset-source",
  wrap(async (req, res) => {
    res.json(
      await assistantService.datasetSource(
        id(req, "sessionId"),
        id(req, "artifactId"),
        context(req).owner,
      ),
    );
  }),
);
router.get(
  "/sessions/:sessionId/feedback",
  wrap(async (req, res) => {
    res.json(
      await assistantService.feedback(
        id(req, "sessionId"),
        context(req).owner,
        req.query.runId ? uuid.parse(req.query.runId) : undefined,
      ),
    );
  }),
);
router.put(
  "/sessions/:sessionId/feedback",
  wrap(async (req, res) => {
    res.json(
      await assistantService.saveFeedback(
        id(req, "sessionId"),
        context(req).owner,
        assistantFeedbackWriteSchema.parse(req.body),
      ),
    );
  }),
);
router.delete(
  "/sessions/:sessionId/feedback/:feedbackId",
  wrap(async (req, res) => {
    await assistantService.deleteFeedback(
      id(req, "sessionId"),
      id(req, "feedbackId"),
      context(req).owner,
    );
    res.sendStatus(204);
  }),
);
router.use("/sessions/:sessionId/runs/:runId/retrievals", (req, res, next) => {
  if (req.header("X-Ontomato-Run-Id") !== req.params.runId) {
    res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "Run identity mismatch" },
      correlationId: getRequestId() ?? "assistant",
    });
    return;
  }
  next();
});
router.post(
  "/sessions/:sessionId/runs/:runId/retrievals",
  wrap(async (req, res) => {
    const c = context(req);
    res
      .status(202)
      .json(
        await assistantService.retrieve(
          id(req, "sessionId"),
          id(req, "runId"),
          uuid.parse(req.header("Idempotency-Key")),
          req.body,
          c.owner,
          c.credentials,
        ),
      );
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(
      await assistantService.child(
        id(req, "sessionId"),
        id(req, "runId"),
        id(req, "retrievalId"),
        c.owner,
        c.credentials,
      ),
    );
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId/artifacts/:artifactId/content",
  wrap(async (req, res) => {
    const c = context(req);
    res
      .type("application/json")
      .send(
        await assistantService.childContent(
          id(req, "sessionId"),
          id(req, "runId"),
          id(req, "retrievalId"),
          id(req, "artifactId"),
          c.owner,
          c.credentials,
        ),
      );
  }),
);
export default router;
