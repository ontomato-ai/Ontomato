import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";

/** A workspace and its conversations are deleted by their owner, from a preview as from anywhere: deleting is not a business write. */
const mocks = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("../../../services/assistant/service", () => ({ assistantService: { delete: mocks.remove } }));
vi.mock("../../../services/workspaces/panel-candidate", () => ({ panelCandidateQuerySchema: {}, readPanelCandidate: vi.fn() }));
vi.mock("../../../services/workspaces/sessions", () => ({ workspaceSessions: vi.fn() }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(), requireDomainId: (req: { domainId: string }) => req.domainId,
}));
const { workspaceRouter } = await import("../workspaces");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { userId: "U", domainId: "domain", token: "tk", locale: "en" }); next(); });
  app.use("/api/workspaces", workspaceRouter);
  app.use((error: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message } });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspaces`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.restoreAllMocks(); mocks.remove.mockReset(); });

it("deletes a workspace and the conversations the runtime deleted with it, for a preview as for anyone", async () => {
  const request = vi.spyOn(RuntimeClient.prototype, "request").mockResolvedValue({ sessionIds: [sessionId] });
  const callers: Record<string, string>[] = [{ [EXECUTION_CONTEXT_HEADER]: previewExecutionContextHeader }, {}];
  for (const headers of callers) {
    request.mockClear(); mocks.remove.mockClear();
    expect((await fetch(`${base}/${workspaceId}`, { method: "DELETE", headers })).status).toBe(204);
    expect(request).toHaveBeenCalledWith(`/v1/workspaces/${workspaceId}`, "DELETE");
    expect(mocks.remove).toHaveBeenCalledWith(sessionId, { domainId: "domain", userId: "U" });
  }
});
