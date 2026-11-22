import { Request, Response, Router } from "express";
import { publishedMcpCatalogue } from "../../services/mcp/catalog";
import { asyncHandler } from "../utils/http";
import mcpServicesRouter from "./mcp-services";

const router: ReturnType<typeof Router> = Router();
router.use("/services", mcpServicesRouter);

router.get(
  "/system/tools",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await publishedMcpCatalogue(req));
  })
);

export default router;
