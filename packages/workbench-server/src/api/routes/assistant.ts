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
import { OntologyRetrievalClient } from "../../services/assistant/ontology-retrieval";
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
// Retrieval activity snapshot proxy: front-end polls this to render retrieval activity.
// The retrieval ID is the stable key across continuations; runId scopes the specific run.
router.get(
  "/sessions/:sessionId/runs/:runId/retrievals/:retrievalId",
  wrap(async (req, res) => {
    const c = context(req);
    const client = new OntologyRetrievalClient(c.owner, id(req, "runId"));
    const snapshot = await client.readSnapshot(id(req, "retrievalId"));
    res.json(snapshot);
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
