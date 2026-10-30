import { Router } from "express";
import { z } from "zod";
import { scheduledTaskEnabledInputSchema, scheduledTaskInputSchema } from "@ontomato/contracts/scheduled-tasks";
import { scheduledTaskService } from "../../services/scheduled-tasks/service";
import { context, id, wrap } from "../utils/agent-host";

/** The caller's own scheduled tasks in the caller's domain. */
const router: ReturnType<typeof Router> = Router();
const uuid = z.string().uuid();

router.get(
  "/",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(await scheduledTaskService.list(c.owner, c.credentials));
  }),
);
router.post(
  "/",
  wrap(async (req, res) => {
    const c = context(req);
    const { task, created } = await scheduledTaskService.create(
      uuid.parse(req.header("Idempotency-Key")),
      c.owner,
      scheduledTaskInputSchema.parse(req.body),
      c.credentials,
    );
    res.status(created ? 201 : 200).json(task);
  }),
);
router.put(
  "/:taskId",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(await scheduledTaskService.update(id(req, "taskId"), c.owner, scheduledTaskInputSchema.parse(req.body), c.credentials));
  }),
);
router.put(
  "/:taskId/enabled",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(
      await scheduledTaskService.setEnabled(
        id(req, "taskId"),
        c.owner,
        scheduledTaskEnabledInputSchema.parse(req.body).enabled,
        c.credentials,
      ),
    );
  }),
);
router.delete(
  "/:taskId",
  wrap(async (req, res) => {
    await scheduledTaskService.delete(id(req, "taskId"), context(req).owner);
    res.sendStatus(204);
  }),
);
router.post(
  "/:taskId/runs",
  wrap(async (req, res) => {
    const c = context(req);
    res
      .status(202)
      .json(await scheduledTaskService.runNow(id(req, "taskId"), uuid.parse(req.header("Idempotency-Key")), c.owner, c.credentials));
  }),
);
router.get(
  "/:taskId/runs",
  wrap(async (req, res) => {
    res.json(
      await scheduledTaskService.runs(
        id(req, "taskId"),
        context(req).owner,
        z
          .object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) })
          .parse(req.query),
      ),
    );
  }),
);

export default router;
