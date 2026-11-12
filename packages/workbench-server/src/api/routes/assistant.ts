import { modelSelectionSchema } from "@ontomato/contracts/model-settings";
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
} from "../../services/assistant/definitions";
import { Router, type RequestHandler } from "express";
import { agentHostCreateSessionSchema } from "@ontomato/contracts/agent-host";
import { z } from "zod";
import {
  assistantAgentInputSchema,
  assistantFeedbackWriteSchema,
} from "@ontomato/contracts/assistant-chat";
import { assistantService } from "../../services/assistant/service";
import { agentTasksFrameSchema } from "@ontomato/contracts/agent-tasks";
import { setTimeout as delay } from "node:timers/promises";
import { publicFrame, publicSnapshot } from "../../platform/agent-runtime/projection";
import { readRuntimeFrames } from "../../infrastructure/agent-runtime/client";
const router: ReturnType<typeof Router> = Router(),
  uuid = z.string().uuid(),
  TASK_READ_MS = 2000;

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
  res.json(await assistantSkillCatalog(c.owner.domainId, c.credentials.locale));
}));
/** The conversation's delegated work, read whole: rounds and their quality checks under the reply that asked for them. */
router.get("/sessions/:sessionId/tasks", wrap(async (req, res) => {
  res.json((await assistantService.tasks(id(req, "sessionId"), context(req).owner)).snapshot);
}));
/**
 * Every change to the conversation's tasks as a complete snapshot. The ontology service's projection is the only source
 * of change, read again every TASK_READ_MS while anything can still change; once settled the stream ends, and the shell
 * opens it again when the conversation's next run starts. A reconnect simply reads the whole snapshot again.
 */
router.get("/sessions/:sessionId/tasks/events", wrap(async (req, res) => {
  const sessionId = id(req, "sessionId"), owner = context(req).owner;
  let current = await assistantService.tasks(sessionId, owner);
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let sent = "";
  try {
    for (;;) {
      const frame = JSON.stringify(agentTasksFrameSchema.parse({ type: "tasks_snapshot", ...current.snapshot, settled: current.settled }));
      res.write(frame === sent ? ": unchanged\n\n" : `event: tasks\ndata: ${frame}\n\n`);
      sent = frame;
      if (current.settled) return;
      await delay(TASK_READ_MS);
      if (abort.signal.aborted) return;
      current = await assistantService.tasks(sessionId, owner);
    }
  } finally {
    res.end();
  }
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
