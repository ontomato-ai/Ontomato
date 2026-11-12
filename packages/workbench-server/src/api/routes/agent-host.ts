import { sessionHistoryQuerySchema } from "@ontomato/contracts/session-history";
import { Router } from "express";
import { z } from "zod";
import { agentHostSessionPageQuerySchema, agentHostCreateSessionSchema, agentHostStartRunSchema, agentHostRenameSessionSchema, agentHostSessionStatusRequestSchema, agentHostSessionRunSnapshotSchema } from "@ontomato/contracts/agent-host";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { publicSnapshot, publicFrame, runStatusView } from "../../platform/agent-runtime/projection";
import { HttpError } from "../../utils/errors";
import { buildAttachmentContentDisposition } from "../utils/http";
import { context, id, wrap } from "../utils/agent-host";
import type { AgentHostService } from "../../services/agent-host/types";
export function createAgentHostRouter(service: AgentHostService, workspaces = false) {
const router: ReturnType<typeof Router> = Router(), uuid = z.string().uuid();
router.get(
  "/agents",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(await service.agents(c.owner, c.credentials.locale));
  }),
);
router.get(
  "/sessions",
  wrap(async (req, res) => {
    res.json(
      await service.list(
        context(req).owner,
        agentHostSessionPageQuerySchema.extend({ agentId: uuid })
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
        await service.create(
          uuid.parse(req.header("Idempotency-Key")),
          context(req).owner,
          (workspaces ? agentHostCreateSessionSchema : agentHostCreateSessionSchema.omit({ workspaceId: true })).parse(req.body),
        ),
      );
  }),
);
router.get(
  "/sessions/run-events",
  wrap(async (req, res) => {
    const c = context(req),
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
      await new RuntimeClient(c.owner.domainId).sessionRunEvents(
        async (frame) => {
          // `ready` is the upstream barrier and is always forwarded; notices are forwarded
          // only under this entry's own session read rule.
          if (
            frame.type !== "ready" &&
            !(await service.canReadSession(c.owner, frame.sessionId))
          )
            return;
          res.write(`event: session-run\ndata: ${JSON.stringify(frame)}\n\n`);
        },
        abort.signal,
      );
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }),
);
router.post(
  "/sessions/status",
  wrap(async (req, res) => {
    const c = context(req),
      { sessionIds } = agentHostSessionStatusRequestSchema.parse(req.body);
    // One unreadable ID rejects the whole read, before any runtime call.
    for (const sessionId of sessionIds)
      if (!(await service.canReadSession(c.owner, sessionId)))
        throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    const statuses = sessionIds.length
      ? await new RuntimeClient(c.owner.domainId).sessionStatuses(sessionIds)
      : [];
    res.json(
      agentHostSessionRunSnapshotSchema.parse({
        sessions: statuses.map((status) => ({
          sessionId: status.session.id,
          latestRun: status.latestRun ? runStatusView(status.latestRun) : null,
        })),
      }),
    );
  }),
);
router.get("/sessions/:sessionId/history", wrap(async (req, res) => {
  res.json(await service.history(id(req, "sessionId"), context(req).owner, sessionHistoryQuerySchema.parse(req.query)));
}));
router.get(
  "/sessions/:sessionId",
  wrap(async (req, res) => {
    res.json(
      await service.snapshot(id(req, "sessionId"), context(req).owner),
    );
  }),
);
router.delete(
  "/sessions/:sessionId",
  wrap(async (req, res) => {
    await service.delete(id(req, "sessionId"), context(req).owner);
    res.sendStatus(204);
  }),
);
router.patch("/sessions/:sessionId", wrap(async (req, res) => {
  await service.rename(id(req, "sessionId"), agentHostRenameSessionSchema.parse(req.body).title, context(req).owner);
  res.sendStatus(204);
}));
router.post(
  "/sessions/:sessionId/runs",
  wrap(async (req, res) => {
    const c = context(req);
    res
      .status(202)
      .json(
        await service.start(
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
        await service.readRun(
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
      await service.cancel(
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
    await service.ownRun(id(req, "sessionId"), runId, c.owner);
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
        async (raw) => {
          const frame = publicFrame(raw);
          if (!frame) return;
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
      await service.resolve(
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
      await service.artifact(
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
      a = await service.artifact(sessionId, artifactId, owner),
      bytes = await service.content(sessionId, artifactId, owner);
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

return router;
}
