import { Router } from "express";
import { z } from "zod";
import { retrievalInputSchema } from "@ontomato/contracts/data-retrieval";
import { asyncHandler } from "../utils/http";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
import { retrievalService } from "../../services/data-retrieval/service";
import { retrievalStore } from "../../services/data-retrieval/store";
import { HttpError } from "../../utils/errors";

const router: ReturnType<typeof Router> = Router(),
  uuid = z.string().uuid();
function context(req: AuthenticatedRequest) {
  return {
    owner: { domainId: requireDomainId(req), userId: req.userId },
    credentials: { token: req.token, apiKey: req.apiKey, locale: req.locale },
  };
}
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    res
      .status(202)
      .json(
        await retrievalService.start(
          uuid.parse(req.header("Idempotency-Key")),
          owner,
          credentials,
          retrievalInputSchema.parse(req.body),
        ),
      );
  }),
);
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    res.json(
      await retrievalService.get(uuid.parse(req.params.id), owner, credentials),
    );
  }),
);
router.post(
  "/:id/answers",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    res
      .status(202)
      .json(
        await retrievalService.answer(
          uuid.parse(req.params.id),
          owner,
          credentials,
          uuid.parse(req.header("Idempotency-Key")),
          req.body,
        ),
      );
  }),
);
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest);
    res.json(
      await retrievalService.cancel(
        uuid.parse(req.params.id),
        owner,
        credentials,
      ),
    );
  }),
);
router.get(
  "/:id/datasets/:artifactId",
  asyncHandler(async (req, res) => {
    const { owner } = context(req as AuthenticatedRequest),
      record = await retrievalStore.get(uuid.parse(req.params.id), owner);
    const artifactId = uuid.parse(req.params.artifactId);
    res.json(
      await retrievalService.dataset(owner, artifactId, record.snapshot.id),
    );
  }),
);
router.post(
  "/skill-runs",
  asyncHandler(async (req, res) => {
    const { owner } = context(req as AuthenticatedRequest);
    const { retrievalId, ...body } = req.body ?? {};
    res
      .status(201)
      .json(
        await retrievalService.begin(
          uuid.parse(req.header("Idempotency-Key")),
          owner,
          retrievalInputSchema.parse(body),
          retrievalId === undefined ? undefined : uuid.parse(retrievalId),
        ),
      );
  }),
);
router.post(
  "/:id/skill-runs/:runId/close",
  asyncHandler(async (req, res) => {
    await retrievalStore.close(
      uuid.parse(req.params.id),
      context(req as AuthenticatedRequest).owner,
      uuid.parse(req.params.runId),
    );
    res.status(204).end();
  }),
);
router.post(
  "/:id/runs/:runId/outputs",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest),
      runId = uuid.parse(req.params.runId);
    if (req.header("X-Ontomato-Run-Id") !== runId)
      throw new HttpError(400, "Run identity mismatch");
    res
      .status(202)
      .json(
        await retrievalService.prepareOutput(
          uuid.parse(req.params.id),
          owner,
          credentials,
          runId,
          uuid.parse(req.header("Idempotency-Key")),
          req.body,
        ),
      );
  }),
);
router.get(
  "/:id/runs/:runId/outputs/:outputId",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest),
      runId = uuid.parse(req.params.runId);
    if (req.header("X-Ontomato-Run-Id") !== runId)
      throw new HttpError(400, "Run identity mismatch");
    res.json(
      await retrievalService.output(
        uuid.parse(req.params.id),
        owner,
        credentials,
        runId,
        uuid.parse(req.params.outputId),
      ),
    );
  }),
);
export default router;
