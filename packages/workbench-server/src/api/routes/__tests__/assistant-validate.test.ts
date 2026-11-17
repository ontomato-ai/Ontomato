import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";

const mocks = vi.hoisted(() => ({ model: vi.fn(), skills: vi.fn(), references: vi.fn() }));
vi.mock("../../../platform/agent-runtime/model-selection", () => ({ validateModelSelection: mocks.model }));
vi.mock("../../../services/assistant/skills", () => ({ validateAssistantSkills: mocks.skills }));
vi.mock("../../../services/assistant/skill-references", () => ({ resolveAssistantSkillReferences: mocks.references }));
vi.mock("../../../services/skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import assistantRouter from "../assistant";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.clearAllMocks();
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

async function app() {
  const router = express();
  router.use(express.json());
  router.use((req, _res, next) => {
    Object.assign(req, { userId: req.header("x-user") ?? "alice", domainId: "domain", token: "tk", apiKey: "", locale: "en" });
    next();
  });
  router.use("/api/assistant", assistantRouter);
  const server = createServer(router);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return (user = "alice") => fetch(`http://127.0.0.1:${address.port}/api/assistant/agent-definitions/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user": user },
    body: JSON.stringify({ name: "Agent", description: "", icon: null, enabled: true, systemPrompt: "Prompt", skills: [] }),
  });
}

it("validates a definition with the save checks and changes nothing", async () => {
  mocks.references.mockReturnValue([]);
  const request = await app();
  const response = await request();
  expect(response.status).toBe(204);
  expect(mocks.model.mock.calls[0]).toEqual(["domain", { modelId: null }]);
  expect(mocks.references.mock.calls[0]).toEqual([[], "domain"]);
  expect(mocks.skills.mock.calls[0][0]).toBe("domain");
  expect(mocks.skills.mock.calls[0][1]).toEqual([]);
});

it("requires the same analysis-agent permission as a save", async () => {
  const request = await app();
  expect((await request("bob")).status).toBe(403);
  expect(mocks.model).not.toHaveBeenCalled();
});
