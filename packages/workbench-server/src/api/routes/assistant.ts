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
import { Router } from "express";
import { z } from "zod";
import {
  assistantAgentInputSchema,
  assistantFeedbackWriteSchema,
} from "@ontomato/contracts/assistant-chat";
import { assistantService } from "../../services/assistant/service";
import { retrievalActivityFrame } from "../../services/assistant/ontology-retrieval";
import { readRuntimeFrames } from "../../infrastructure/agent-runtime/client";
import { buildAttachmentContentDisposition } from "../utils/http";
const router: ReturnType<typeof Router> = Router(),
  uuid = z.string().uuid();

import { context, id, wrap } from "../utils/agent-host";
import { createAgentHostRouter } from "./agent-host";
router.use(createAgentHostRouter(assistantService));
const agentAdmin = requirePermission(["analysis-agent"]);
router.get("/agent-skills", agentAdmin, wrap(async (req, res) => {
  const c = context(req);
  res.json(await assistantSkillCatalog(c.owner.domainId, c.credentials.locale));
}));
// Business state stays lightweight; activity is read from the separately authorized child run.
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId",
  wrap(async (req, res) => {
    const c = context(req);
    const client = await assistantService.retrievalClient(id(req, "sessionId"), id(req, "runId"), c.owner);
    const snapshot = await client.readSnapshot(id(req, "retrievalId"), uuid.parse(req.query.retrievalRunId));
    res.json(snapshot);
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId/runs/:retrievalRunId",
  wrap(async (req, res) => {
    const client = await assistantService.retrievalClient(id(req, "sessionId"), id(req, "runId"), context(req).owner);
    res.json(await client.activityRun(id(req, "retrievalId"), id(req, "retrievalRunId")));
  }),
);
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId/runs/:retrievalRunId/events",
  wrap(async (req, res) => {
    const client = await assistantService.retrievalClient(id(req, "sessionId"), id(req, "runId"), context(req).owner);
    const after = {
      seq: z.coerce.number().int().nonnegative().parse(req.query.afterSeq),
      streamId: uuid.parse(req.query.streamId),
    };
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.on("close", onClose);
    try {
      const upstream = await client.events(id(req, "retrievalId"), id(req, "retrievalRunId"), after, abort.signal);
      res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      try {
        await readRuntimeFrames(upstream, async (raw) => {
          const frame = retrievalActivityFrame(raw);
          if (frame) res.write(
            `${frame.type === "event" ? `id: ${frame.envelope.cursor.seq}\n` : ""}event: runtime\ndata: ${JSON.stringify(frame)}\n\n`,
          );
        }, abort.signal, (comment) => { res.write(`${comment}\n\n`); });
      } catch {
        // As with the byte proxy, a body failure after headers closes this subscription.
      } finally {
        res.end();
      }
    } finally {
      res.off("close", onClose);
    }
  }),
);
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
export default router;
