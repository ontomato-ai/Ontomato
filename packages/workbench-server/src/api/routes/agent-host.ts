import { sessionHistoryQuerySchema } from "@ontomato/contracts/session-history";
import { Router } from "express";
import { z } from "zod";
import { agentHostSessionPageQuerySchema, agentHostCreateSessionSchema, agentHostSendRequestSchema, agentHostRenameSessionSchema, agentHostSessionStatusRequestSchema, agentHostSessionRunSnapshotSchema, agentHostSessionRunEventsQuerySchema } from "@ontomato/contracts/agent-host";
import { presentationCallRequestSchema, presentationReceiptSchema } from "@ontomato/contracts/agent-presentation";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { publicSnapshot, publicFrame, runStatusView } from "../../platform/agent-runtime/projection";
import { buildAttachmentContentDisposition } from "../utils/http";
import { context, id, wrap } from "../utils/agent-host";
import type { AgentHostService } from "../../services/agent-host/types";
import { openPresentationView, PRESENTATION_CALL_PATH, receivePresentation, requestPresentation } from "../../services/agent-host/presentation";
import type { RuntimeCallback } from "../../services/agent-runtime/callback-credential";
import { HttpError } from "../../utils/errors";
import { publishBrowserEvents } from "./browser-events";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
export function createAgentHostRouter(service: AgentHostService<[AssistantCredentials]>, workspaces = false) {
const router: ReturnType<typeof Router> = Router(), uuid = z.string().uuid();
const host = service.presentationHost;
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
    const { owner, credentials } = context(req);
    res
      .status(201)
      .json(
        await service.create(
          uuid.parse(req.header("Idempotency-Key")),
          owner,
          (workspaces ? agentHostCreateSessionSchema : agentHostCreateSessionSchema.omit({ workspaceId: true })).parse(req.body),
          credentials,
        ),
      );
  }),
);
router.post(
  "/sessions/run-events",
  wrap(async (req, res) => {
    const { owner } = context(req);
    const { viewId } = agentHostSessionRunEventsQuerySchema.parse(req.query);
    await publishBrowserEvents(req, res, async ({ signal, open, send }) => {
      await new RuntimeClient(owner.domainId).sessionRunEvents(open, async frame => {
        if (frame.type !== "ready") {
          const readable = await service.readableSessions(owner, [frame.sessionId]);
          if (!readable.has(frame.sessionId)) return;
        }
        if (signal.aborted) return;
        const notice = frame.type === "ready" && host && viewId
          ? { ...frame, connectionId: openPresentationView(host, owner, viewId, send, signal) }
          : frame;
        send(notice);
      }, signal);
    });
  }),
);
if (host) {
  router.post(PRESENTATION_CALL_PATH, wrap(async (req, res) => {
    const runId = id(req, "runId");
    const callback = res.locals.runtimeCallback as RuntimeCallback | undefined;
    if (callback?.runId !== runId) throw new HttpError(403, "A presentation callback credential is required", "FORBIDDEN");
    const parsed = presentationCallRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map(({ path, message }) =>
        path.length ? `${path.join(".")}: ${message}` : message).join("\n");
      throw new HttpError(400, message, "INVALID_REQUEST");
    }
    const { input, toolCallId } = parsed.data;
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    res.json(await requestPresentation(service, host, context(req).owner, {
      viewId: id(req, "viewId"), sessionId: id(req, "sessionId"), runId, toolCallId, input,
    }, abort.signal));
  }));
  router.post("/sessions/:sessionId/runs/:runId/presentation-result", wrap(async (req, res) => {
    receivePresentation(host, context(req).owner, id(req, "sessionId"), id(req, "runId"),
      presentationReceiptSchema.parse(req.body));
    res.sendStatus(204);
  }));
}
router.post(
  "/sessions/status",
  wrap(async (req, res) => {
    const c = context(req),
      { sessionIds } = agentHostSessionStatusRequestSchema.parse(req.body);
    // One query for the page's whole loaded set; only its readable subset is read from
    // the runtime, in request order.
    const readable = sessionIds.length
      ? await service.readableSessions(c.owner, sessionIds)
      : new Set<string>();
    const permitted = sessionIds.filter((sessionId) => readable.has(sessionId));
    const statuses = permitted.length
      ? await new RuntimeClient(c.owner.domainId).sessionStatuses(permitted)
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
        await service.send(
          id(req, "sessionId"),
          uuid.parse(req.header("Idempotency-Key")),
          agentHostSendRequestSchema.parse(req.body),
          c.owner,
          c.credentials,
          "human",
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
router.post(
  "/sessions/:sessionId/runs/:runId/events",
  wrap(async (req, res) => {
    const { owner } = context(req), runId = id(req, "runId");
    const cursor = {
      runId,
      seq: z.coerce.number().int().nonnegative().parse(req.query.afterSeq),
      streamId: uuid.parse(req.query.streamId),
    };
    await publishBrowserEvents(req, res, async ({ signal, open, send }) => {
      await service.ownRun(id(req, "sessionId"), runId, owner);
      open();
      await new RuntimeClient(owner.domainId).stream(cursor, async raw => {
        const frame = publicFrame(raw);
        if (frame) send(frame);
      }, signal);
    });
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
