import { guardMcpServiceManagement } from "../../identity/installed";
import { Router, type Request, type Response } from "express";
import { validateBody } from "../middleware/validate";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { mcpServiceWriteSchema } from "@ontomato/contracts/agent-runtime-mcp";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";

const router: ReturnType<typeof Router> = Router();
const domain = (req: Request) => (req as AuthenticatedRequest).domainId!;
const client = (req: Request) => new RuntimeClient(domain(req), req.header("x-correlation-id"));

function fail(res: Response, error: unknown): void {
  res.status(error instanceof HttpError ? error.status : 500).json({
    success: false,
    code: error instanceof HttpError ? error.code : "MCP_CONFIG_FAILED",
    error: error instanceof HttpError ? error.message : "Unable to access MCP configuration",
  });
}

router.use((req, res, next) => {
  if (!domain(req)) {
    res.status(403).json({ success: false, error: "Domain required" });
    return;
  }
  next();
});

// Agent selection only needs names; connection credentials remain in the management boundary.
router.get("/names", async (req, res) => {
  try {
    res.json(await client(req).mcpOptions());
  } catch (error) {
    fail(res, error);
  }
});

router.use(guardMcpServiceManagement);

router.get("/", async (req, res) => {
  try {
    res.json(await client(req).mcpServices());
  } catch (error) {
    fail(res, error);
  }
});

router.post("/", validateBody(mcpServiceWriteSchema), async (req, res) => {
  try {
    await client(req).saveMcpService(req.body);
    res.status(201).json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.put("/:id", validateBody(mcpServiceWriteSchema), async (req, res) => {
  try {
    await client(req).saveMcpService(req.body, req.params.id);
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await client(req).deleteMcpService(req.params.id);
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.get("/:id/tools", async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const result = await client(req).mcpTools(req.params.id, controller.signal);
    if (!controller.signal.aborted) res.json(result);
  } catch (error) {
    if (!controller.signal.aborted) fail(res, error);
  }
});

export default router;
