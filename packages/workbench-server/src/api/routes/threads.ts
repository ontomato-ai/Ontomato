import { Request, Response, Router } from "express";
import { getCheckpointer } from "../../infrastructure/connection";
import {
  deleteThread,
  getThreadDataDownload,
  getThreadDslDownload,
  getThreadMessagesPayload,
} from "../../services/chat/thread-service";
import { updateThreadTitle } from "../../services/chat/thread-store";
import { buildAttachmentContentDisposition, asyncHandler } from "../utils/http";
import { HttpError } from "../../utils/errors";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
const router: ReturnType<typeof Router> = Router();

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const threadType = (req.query.threadType as string) || "qa";

    const checkpointerInstance = getCheckpointer();
    if (checkpointerInstance) {
      const result = await checkpointerInstance.getThreadList({
        userId,
        domainId,
        limit,
        offset,
        threadType,
      });
      res.json(result);
    } else {
      res.json({ threads: [], total: 0 });
    }
  })
);

router.delete(
  "/:threadId",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const checkpointerInstance = getCheckpointer();

    if (checkpointerInstance) {
      await deleteThread(threadId, userId, domainId);
    }

    res.json({ success: true });
  })
);

router.put(
  "/:threadId/title",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const { title } = req.body;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);

    if (!title) {
      throw new HttpError(400, "title is required");
    }

    const checkpointerInstance = getCheckpointer();
    if (checkpointerInstance) {
      await checkpointerInstance.verifyThreadAccess(threadId, userId, domainId);
      await updateThreadTitle(threadId, title, userId, domainId, { lockTitle: true });
    }

    res.json({ success: true });
  })
);

router.get(
  "/:threadId/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    if (!getCheckpointer()) {
      res.json({ messages: [] });
      return;
    }

    res.json(await getThreadMessagesPayload(threadId, { userId, domainId }));
  })
);

router.get(
  "/:threadId/requests/:requestSeq/download/data",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, requestSeq } = req.params;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const download = await getThreadDataDownload(
      threadId,
      parseInt(requestSeq, 10),
      userId,
      domainId
    );
    res.setHeader("Content-Type", download.contentType);
    res.setHeader("Content-Disposition", buildAttachmentContentDisposition(download.fileName));
    res.send(download.body);
  })
);

router.get(
  "/:threadId/requests/:requestSeq/download/dsl",
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, requestSeq } = req.params;
    const userId = (req as AuthenticatedRequest).userId;
    const domainId = requireDomainId(req as AuthenticatedRequest);
    const download = await getThreadDslDownload(
      threadId,
      parseInt(requestSeq, 10),
      userId,
      domainId
    );
    res.setHeader("Content-Type", download.contentType);
    res.setHeader("Content-Disposition", buildAttachmentContentDisposition(download.fileName));
    res.send(download.body);
  })
);

export default router;
