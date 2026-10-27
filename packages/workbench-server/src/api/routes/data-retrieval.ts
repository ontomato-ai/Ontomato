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
  "/:id/runtime/:tool",
  asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req as AuthenticatedRequest),
      id = uuid.parse(req.params.id);
    const identity = z
      .object({
        runId: uuid,
        runtimeSessionId: uuid,
        toolCallId: z.string().min(1),
        invocationId: uuid,
      })
      .strict()
      .parse(req.body.identity);
    const record = await retrievalStore.get(id, owner);
    if (record.snapshot.runtimeSessionId !== identity.runtimeSessionId)
      throw new HttpError(409, "Wrong runtime session");
    if (req.params.tool === "submit_dataset")
      res.json(
        await retrievalService.submit(
          id,
          owner,
          credentials,
          identity,
          req.body.arguments,
          req.body.source,
        ),
      );
    else if (req.params.tool === "finish_retrieval")
      res.json(
        await retrievalService.finish(
          id,
          owner,
          identity.runId,
          req.body.arguments,
        ),
      );
    else throw new HttpError(404, "Retrieval tool not found");
  }),
);
export default router;
