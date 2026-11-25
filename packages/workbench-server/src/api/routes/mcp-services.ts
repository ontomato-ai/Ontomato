import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { requireManagement } from "../../identity/management";
import { Router, type Request, type Response } from "express";
import { validateBody } from "../middleware/validate";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { mcpServiceWriteSchema } from "@ontomato/contracts/agent-runtime-mcp";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { HttpError } from "../../utils/errors";

const router: ReturnType<typeof Router> = Router();
const domain = (req: Request) => (req as AuthenticatedRequest).domainId!;
const client = (req: Request) => new RuntimeClient(domain(req));

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

function mcpAdmission(operation: { id: string }) {
  return requireManagement(operation, (res, error) => {
    const status = error instanceof HttpError ? error.status : 502;
    res.status(status).json({
      success: false,
      error: status === 403 ? "MCP management permission required"
        : status === 401 ? "MCP management credentials rejected"
        : "Unable to verify MCP management permission",
    });
  });
}

router.get("/", mcpAdmission(workbenchManagement.mcpServicesRead), async (req, res) => {
  try {
    res.json(await client(req).mcpServices());
  } catch (error) {
    fail(res, error);
  }
});

router.post("/", mcpAdmission(workbenchManagement.mcpServicesCreate), validateBody(mcpServiceWriteSchema), async (req, res) => {
  try {
    await client(req).saveMcpService(req.body);
    res.status(201).json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.put("/:id", mcpAdmission(workbenchManagement.mcpServicesChange), validateBody(mcpServiceWriteSchema), async (req, res) => {
  try {
    await client(req).saveMcpService(req.body, req.params.id);
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/:id", mcpAdmission(workbenchManagement.mcpServicesDelete), async (req, res) => {
  try {
    await client(req).deleteMcpService(req.params.id);
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.get("/:id/tools", mcpAdmission(workbenchManagement.mcpServicesRead), async (req, res) => {
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
