import { panelFormRequestSchema } from "@ontomato/contracts/panel-projection";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../utils/http";
import { describeAgentDefinitionForm } from "../../services/assistant/definition-form";
import { modelSelectionSchema } from "@ontomato/contracts/model-settings";
import { assistantAgentsQuerySchema } from "@ontomato/contracts/page-skills";
import { readDiagnosisModel, saveDiagnosisModel } from "../../services/ops-diagnosis/model-settings";
import { requirePermission } from "../../identity/installed";
import { assertAppBuilderAccess } from "../../services/app-builder/access";
import { assistantSkillCatalog } from "../../services/assistant/skills";
import { readAnalysisScope } from "../../services/assistant/analysis-scope";
import { readDrilldown } from "../../services/assistant/drilldown";
import {
  readAgentDefinition,
  listAgentDefinitions,
  deleteAgentDefinition,
  saveAgentDefinition,
  createAgentDefinition,
  validateAgentDefinition,
} from "../../services/assistant/definitions";
import { Router, type RequestHandler } from "express";
import { agentHostCreateSessionSchema } from "@ontomato/contracts/agent-host";
import { z } from "zod";
import {
  assistantAgentInputSchema,
  assistantAgentUpdateInputSchema,
  assistantAgentValidationSchema,
  assistantFeedbackWriteSchema,
} from "@ontomato/contracts/assistant-chat";
import { assistantService } from "../../services/assistant/service";
import { agentTasksFrameSchema } from "@ontomato/contracts/agent-tasks";
import { pageDraftCreatedSchema, pageDraftPathSchema } from "@ontomato/contracts/page-draft";
import { authoringKindSchema, authoringTestRecordSchema } from "@ontomato/contracts/authoring";
import { executeAuthoring } from "../../services/assistant/authoring";
import { publicFrame, publicSnapshot } from "../../platform/agent-runtime/projection";
import { RuntimeClient, readSseFrames, readRuntimeFrames } from "../../infrastructure/agent-runtime/client";
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
router.get("/agents", wrap(async (req, res) => {
  const c = context(req);
  res.json(await assistantService.agents(c.owner, c.credentials, assistantAgentsQuerySchema.parse(req.query)));
}));
router.use(createAgentHostRouter(assistantService, true));
/** The page draft a run wrote, at the run's own path: only the drafts directory, parsed as the shared envelope. */
router.get("/sessions/:sessionId/runs/:runId/page-draft", wrap(async (req, res) => {
  const path = pageDraftPathSchema.parse(req.query.path);
  const { owner, credentials } = context(req);
  res.json(await assistantService.acceptPageDraft(id(req, "sessionId"), id(req, "runId"), path, owner, credentials));
}));
router.get("/sessions/:sessionId/runs/:runId/authoring/:kind/tests/:executionId", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const kind = authoringKindSchema.parse(req.params.kind);
  const result = await executeAuthoring(owner, credentials, id(req, "runId"), kind, "read-test",
    { executionId: id(req, "executionId") }, id(req, "sessionId"));
  res.json(authoringTestRecordSchema.parse(result));
}));
/** What a create draft's first save created, recorded by the page that saved it; the same reader who may read the draft. */
router.post("/sessions/:sessionId/runs/:runId/page-draft/created", wrap(async (req, res) => {
  const created = pageDraftCreatedSchema.parse(req.body);
  await assistantService.recordPageDraftCreated(id(req, "sessionId"), id(req, "runId"), created.path, created.id, context(req).owner);
  res.sendStatus(204);
}));
router.get("/sessions/:sessionId/artifacts/:artifactId/drilldown", wrap(async (req, res) => {
  const rowIndex = z.coerce.number().int().nonnegative().safe().parse(req.query.rowIndex);
  res.json(await readDrilldown(id(req, "sessionId"), id(req, "artifactId"), context(req).owner, rowIndex));
}));
router.get("/sessions/:sessionId/artifacts/:artifactId/analysis-scope", wrap(async (req, res) => {
  res.json(await readAnalysisScope(id(req, "sessionId"), id(req, "artifactId"), context(req).owner, z.string().max(35).optional().parse(req.query.locale)));
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
  res.json(await assistantSkillCatalog(c.owner.domainId, c.credentials));
}));
/** The conversation's delegated work, read whole: rounds and their quality checks under the reply that asked for them. */
router.get("/sessions/:sessionId/tasks", wrap(async (req, res) => {
  res.json((await assistantService.tasks(id(req, "sessionId"), context(req).owner)).snapshot);
}));
/** Subscribe before reading the snapshot; runtime changes trigger projections without a polling loop. */
router.get("/sessions/:sessionId/tasks/events", wrap(async (req, res) => {
  const sessionId = id(req, "sessionId"), owner = context(req).owner;
  await assistantService.snapshot(sessionId, owner);
  const abort = new AbortController(); res.on("close", () => abort.abort());
  const upstream = await new RuntimeClient(owner.domainId, undefined, owner.userId).channelStream(`/v1/channel/sessions/${sessionId}/events`, abort.signal);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" }); res.flushHeaders();
  const frameSchema = z.union([z.object({ type: z.literal("ready") }).strict(), agentTasksFrameSchema]);
  try {
    await readSseFrames(upstream, value => frameSchema.parse(value), async frame => {
      if (frame.type === "ready") return;
      const current = await assistantService.tasks(sessionId, owner, frame);
      res.write(`event: tasks\ndata: ${JSON.stringify({ type: "tasks_snapshot", ...current.snapshot, settled: false })}\n\n`);
    }, abort.signal, comment => { res.write(`${comment}\n\n`); });
  } finally { res.end(); }
}));
router.get("/sessions/:sessionId/tasks/:taskId/process", wrap(async (req, res) => {
  const { client, process } = await assistantService.taskProcess(id(req, "sessionId"), id(req, "taskId"), context(req).owner);
  res.json(publicSnapshot(await client.run(process.runtimeSessionId, process.runtimeRunId)));
}));
/** The retrieval task's own run events under the same public projection as the conversation's, on its own cursor. */
router.get("/sessions/:sessionId/tasks/:taskId/process/events", wrap(async (req, res) => {
  const { client, process } = await assistantService.taskProcess(id(req, "sessionId"), id(req, "taskId"), context(req).owner);
  const after = {
    seq: z.coerce.number().int().nonnegative().parse(req.query.afterSeq),
    streamId: uuid.parse(req.query.streamId),
  };
  const abort = new AbortController();
  const onClose = () => abort.abort();
  res.on("close", onClose);
  try {
    const upstream = await client.events(process.runtimeSessionId, process.runtimeRunId, after, abort.signal);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    try {
      await readRuntimeFrames(upstream, async (raw) => {
        const frame = publicFrame(raw);
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
}));
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
          context(req).credentials,
        ),
      );
  }),
);
router.post(
  "/agent-definitions/form",
  agentAdmin,
  validateBody(panelFormRequestSchema),
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req);
    res.json(await describeAgentDefinitionForm(req.body, owner, credentials));
  }),
);
router.post(
  "/agent-definitions/validate",
  agentAdmin,
  wrap(async (req, res) => {
    const c = context(req);
    await validateAgentDefinition(assistantAgentValidationSchema.parse(req.body), c.owner, c.credentials);
    res.sendStatus(204);
  }),
);
router.put(
  "/agent-definitions/:agentId",
  agentAdmin,
  wrap(async (req, res) => {
    res.json(
      await saveAgentDefinition(
        id(req, "agentId"),
        assistantAgentUpdateInputSchema.parse(req.body),
        context(req).owner,
        context(req).credentials,
      ),
    );
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
