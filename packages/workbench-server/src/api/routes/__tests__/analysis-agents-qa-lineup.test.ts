import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  getAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  saveAgentLineup: vi.fn(),
}));

vi.mock("../../../services/analysis-agent/runtime", () => ({
  getAnalysisAgentService: async () => service,
}));
vi.mock("../../../services/analysis-agent/config/agent-service", () => ({
  InvalidAgentSkillSelectionError: class extends Error {},
}));
vi.mock("../../../utils/request-identity", () => ({
  requireDomainId: (identity: { domainId?: string }) => identity.domainId,
}));

import router from "../analysis-agents";
import { errorHandler } from "../../middleware/error-handler";

let server: http.Server | null = null;

async function start(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { domainId: "domain-1" });
    next();
  });
  app.use("/api/analysis-agents", router);
  app.use(errorHandler);
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/analysis-agents`;
}

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("built-in Q&A agent in the analysis agent API", () => {
  it("refuses to edit, disable or delete the Q&A agent", async () => {
    const base = await start();
    for (const body of [{ name: "Renamed" }, { isEnabled: false }]) {
      const res = await fetch(`${base}/__qa__`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "QA_AGENT_READ_ONLY" });
    }
    const deleted = await fetch(`${base}/__qa__`, { method: "DELETE" });
    expect(deleted.status).toBe(403);
    expect(service.updateAgent).not.toHaveBeenCalled();
    expect(service.deleteAgent).not.toHaveBeenCalled();
  });

  it("saves order only through the lineup endpoint", async () => {
    const base = await start();
    const res = await fetch(`${base}/lineup`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ["a", "__qa__"] }),
    });
    expect(res.status).toBe(200);
    expect(service.saveAgentLineup).toHaveBeenCalledWith("domain-1", ["a", "__qa__"]);
    expect(service.updateAgent).not.toHaveBeenCalled();
  });
});
