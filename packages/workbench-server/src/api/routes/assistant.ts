import { modelSelectionSchema } from "@ontomato/contracts/model-settings";
import { readDiagnosisModel, saveDiagnosisModel } from "../../services/ops-diagnosis/model-settings";
import { exportConversationPpt } from "../../services/assistant/export";
import { safePptFileName } from "../../services/analysis-agent/delivery/ppt-artifacts";
import { requirePermission } from "../../identity/installed";
import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { assistantSkillCatalog } from "../../services/assistant/skills";
import { actionCard, confirmAction } from "../../services/assistant/actions";
import { readDecision, saveDecision, submitDecision } from "../../services/assistant/decisions";
import { clarificationValuesSchema } from "@ontomato/contracts/assistant-clarification";
import { adjustAnalysisScope, readAnalysisScope, scopeChangeSchema } from "../../services/assistant/analysis-scope";
import { drilldownInputSchema } from "@ontomato/contracts/assistant-drilldown";
import { readDrilldown, startDrilldown } from "../../services/assistant/drilldown";
import {
  readAgentDefinition,
  listAgentDefinitions,
  deleteAgentDefinition,
  saveAgentDefinition,
  createAgentDefinition,
} from "../../services/assistant/definitions";
import { Router, type RequestHandler } from "express";
import { agentHostCreateSessionSchema } from "@ontomato/contracts/agent-host";
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
const guardBuilder: RequestHandler = (req, res, next) => {
  wrap(async () => {
    const c = context(req);
    const input = req.params.sessionId
      ? { sessionId: id(req, "sessionId") }
      : agentHostCreateSessionSchema.parse(req.body);
    if (await assistantService.isAppBuilder(c.owner, input)) await assertAppBuilderAccess(c.credentials);
    next();
  })(req, res, next);
};
router.post("/sessions", guardBuilder);
router.post("/sessions/:sessionId/runs", guardBuilder);
router.use(createAgentHostRouter(assistantService, true));
router.get("/sessions/:sessionId/artifacts/:artifactId/drilldown", wrap(async (req, res) => {
  const rowIndex = z.coerce.number().int().nonnegative().safe().parse(req.query.rowIndex);
  res.json(await readDrilldown(id(req, "sessionId"), id(req, "artifactId"), context(req).owner, rowIndex));
}));
router.post("/sessions/:sessionId/artifacts/:artifactId/drilldown", wrap(async (req, res) => {
  const c = context(req);
  await startDrilldown(id(req, "sessionId"), id(req, "artifactId"), c.owner, c.credentials,
    drilldownInputSchema.parse(req.body).rowIndex, uuid.parse(req.header("Idempotency-Key")));
  res.sendStatus(202);
}));
router.get("/sessions/:sessionId/artifacts/:artifactId/analysis-scope", wrap(async (req, res) => {
  res.json(await readAnalysisScope(id(req, "sessionId"), id(req, "artifactId"), context(req).owner));
}));
router.post("/sessions/:sessionId/artifacts/:artifactId/analysis-scope", wrap(async (req, res) => {
  const c = context(req);
  await adjustAnalysisScope(id(req, "sessionId"), id(req, "artifactId"), c.owner, c.credentials, scopeChangeSchema.parse(req.body), uuid.parse(req.header("Idempotency-Key")));
  res.sendStatus(202);
}));
router.get("/sessions/:sessionId/artifacts/:artifactId/decision", wrap(async (req, res) => {
  res.json(await readDecision(id(req, "sessionId"), id(req, "artifactId"), context(req).owner));
}));
router.put("/sessions/:sessionId/artifacts/:artifactId/decision", wrap(async (req, res) => {
  res.json(await saveDecision(id(req, "sessionId"), id(req, "artifactId"), context(req).owner, clarificationValuesSchema.parse(req.body)));
}));
router.post("/sessions/:sessionId/artifacts/:artifactId/decision/submit", wrap(async (req, res) => {
  const c = context(req);
  res.json(await submitDecision(id(req, "sessionId"), id(req, "artifactId"), c.owner, c.credentials, clarificationValuesSchema.parse(req.body)));
}));
router.get("/sessions/:sessionId/artifacts/:artifactId/action", wrap(async (req, res) => {
  const c = context(req);
  res.json(await actionCard(id(req, "sessionId"), id(req, "artifactId"), c.owner, c.credentials));
}));
router.post("/sessions/:sessionId/artifacts/:artifactId/action/confirm", wrap(async (req, res) => {
  const c = context(req);
  const input = z.object({ parameters: z.record(z.unknown()) }).strict().parse(req.body);
  res.json(await confirmAction(id(req, "sessionId"), id(req, "artifactId"), c.owner, c.credentials, input.parameters));
}));
const agentAdmin = requirePermission(["analysis-agent"]);
router.get("/diagnosis-model", agentAdmin, wrap(async (req, res) => {
  res.json(await readDiagnosisModel(context(req).owner.domainId));
}));
router.put("/diagnosis-model", agentAdmin, wrap(async (req, res) => {
  const input = z.object({ modelSelection: modelSelectionSchema }).strict().parse(req.body);
  res.json(await saveDiagnosisModel(context(req).owner.domainId, input.modelSelection));
}));
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
    res.json(await listAgentDefinitions(context(req).owner, context(req).credentials.locale));
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
    res.json(await readAgentDefinition(id(req, "agentId"), context(req).owner, context(req).credentials.locale));
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
        context(req).credentials.locale,
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
