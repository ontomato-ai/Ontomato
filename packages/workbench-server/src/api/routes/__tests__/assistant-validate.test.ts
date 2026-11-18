import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({ model: vi.fn(), skills: vi.fn(), references: vi.fn(),
  setting: vi.fn(), prepare: vi.fn(), agent: vi.fn(), pool: vi.fn() }));
vi.mock("../../../platform/agent-runtime/model-selection", () => ({ validateModelSelection: mocks.model }));
vi.mock("../../../services/assistant/skills", () => ({ validateAssistantSkills: mocks.skills }));
vi.mock("../../../services/assistant/skill-references", () => ({ resolveAssistantSkillReferences: mocks.references }));
vi.mock("../../../services/assistant/execution-setting", () => ({ validateExecutionSetting: mocks.setting, prepareExecutionSetting: mocks.prepare }));
vi.mock("../../../services/assistant/store", () => ({ assistantStore: { agent: mocks.agent } }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: mocks.pool }));
vi.mock("../../../services/skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import assistantRouter from "../assistant";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.resetAllMocks();
});
installWorkbenchIdentity({
  requireDomainId: (identity: { domainId?: string | null }) => identity.domainId ?? "domain",
  requirePermission: () => (req: Request, res: Response, next: NextFunction) => {
    if ((req as { userId?: string }).userId !== "alice") {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Denied" } });
      return;
    }
    next();
  },
} as unknown as WorkbenchIdentity);
const form = { name: "Agent", description: "", icon: null, enabled: true, systemPrompt: "Prompt", skills: [] };
async function app() {
  const router = express();
  router.use(express.json());
  router.use((req, _res, next) => {
    Object.assign(req, { userId: req.header("x-user") ?? "alice", domainId: "domain", token: "original", apiKey: "", locale: "en" });
    next();
  });
  router.use("/api/assistant", assistantRouter);
  const server = createServer(router);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return (body: object, user = "alice") => fetch(`http://127.0.0.1:${address.port}/api/assistant/agent-definitions/validate`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify(body),
  });
}
it("validates the full creation form without preparing a Key or touching storage", async () => {
  mocks.references.mockReturnValue([]);
  const request = await app();
  expect((await request({ target: {}, form })).status).toBe(204);
  expect(mocks.setting).toHaveBeenCalledWith({ domainId: "domain", userId: "alice" }, null, null,
    expect.objectContaining({ token: "original" }));
  expect(mocks.model).toHaveBeenCalledWith("domain", { modelId: null });
  expect(mocks.skills).toHaveBeenCalled();
  expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("loads the actual stored reference and preserves it when the update omits the field", async () => {
  mocks.agent.mockResolvedValue({ kind: "custom", execution_user_id: "selected" });
  const request = await app();
  expect((await request({ target: { id: "8f5df4a4-e30b-48cb-831a-33b759144f76" }, form })).status).toBe(204);
  expect(mocks.setting).toHaveBeenCalledWith(expect.anything(), "selected", "selected", expect.anything());
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("cannot forge the old reference or bypass a setting rejection", async () => {
  mocks.agent.mockResolvedValue({ kind: "custom", execution_user_id: "selected" });
  mocks.setting.mockRejectedValue(new HttpError(403, "Denied", "FORBIDDEN"));
  const request = await app();
  expect((await request({ target: { id: "8f5df4a4-e30b-48cb-831a-33b759144f76" }, form: { ...form, executionUserId: "other" } })).status).toBe(403);
  expect(mocks.setting).toHaveBeenCalledWith(expect.anything(), "selected", "other", expect.anything());
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.pool).not.toHaveBeenCalled();
  expect((await request({ target: {}, form, oldExecutionUserId: "other" })).status).toBe(400);
});
it("requires the same analysis-agent permission as a save", async () => {
  const request = await app();
  expect((await request({ target: {}, form }, "bob")).status).toBe(403);
  expect(mocks.model).not.toHaveBeenCalled();
  expect(mocks.setting).not.toHaveBeenCalled();
});
