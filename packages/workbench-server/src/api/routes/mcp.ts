import { Request, Response, Router } from "express";
import { publishedMcpCatalogue } from "../../services/mcp/catalog";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { requireManagement } from "../../identity/management";
import { asyncHandler } from "../utils/http";
import mcpServicesRouter from "./mcp-services";

const router: ReturnType<typeof Router> = Router();
router.use("/services", mcpServicesRouter);

router.get(
  "/system/tools",
  requireManagement(workbenchManagement.publishedMcpRead),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await publishedMcpCatalogue(req));
  })
);

export default router;
