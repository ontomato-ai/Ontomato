import { assistantStore } from "../../services/assistant/store";
import { exportMarkdown } from "../../services/assistant/export";
import { Router } from "express";
import { asyncHandler, buildAttachmentContentDisposition } from "../utils/http";
import {
  requireDomainId,
  type AuthenticatedRequest,
} from "../../utils/request-identity";
import { analysisTask } from "../../services/assistant/mcp";
import { exportAnalysisReportPdf } from "../../services/analysis-agent/delivery/report-pdf";
import { HttpError } from "../../utils/errors";
const router: ReturnType<typeof Router> = Router();
router.get(
  "/:id/report/pdf",
  asyncHandler(async (req, res) => {
    const r = req as AuthenticatedRequest,
      task = await analysisTask(req.params.id, {
        domainId: requireDomainId(r),
        userId: r.userId,
      });
    if (!task.resultReport) throw new HttpError(404, "Report not found");
    const { bytes, fileName } = await exportAnalysisReportPdf(
      {
        title: task.name,
        markdown: await exportMarkdown(
          (
            await assistantStore.turn(task.id, {
              domainId: requireDomainId(r),
              userId: r.userId,
            })
          ).session_id,
          task.id,
          task.resultReport,
          { domainId: requireDomainId(r), userId: r.userId },
        ),
      },
      new Date(),
    );
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": buildAttachmentContentDisposition(fileName),
      })
      .send(bytes);
  }),
);
router.use((_req, res) => {
  res.status(503).json({
    error: {
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Temporarily unavailable",
    },
  });
});
export default router;
