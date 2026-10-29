import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { MODEL_ROLES } from "@ontomato/contracts/model-settings";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
import router from "../model-settings";
const calls = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), test: vi.fn() }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    constructor(readonly domain: string) {}
    modelSettings() { return calls.get(this.domain); }
    saveModelSettings(body: unknown) { return calls.save(this.domain, body); }
    testModel(body: unknown, signal: AbortSignal) { return calls.test(this.domain, body, signal); }
  },
}));
const model = { name: "m", displayName: "Model", baseUrl: "https://model.invalid/v1", modelName: "model", apiKeys: ["******1234"], maxTokens: 4096, contextWindow: 32000 };
const settings = { models: [model], agents: Object.fromEntries(MODEL_ROLES.map(role => [role, { model: "m" }])) };
const write = { models: [model], agents: Object.fromEntries(MODEL_ROLES.map(role => [role, "m"])) };
let server: Server, url: string;
beforeAll(async () => {
  installWorkbenchIdentity({ requirePermission(keys) {
    return (req, res, next) => {
      if (!keys.includes("system-config") || req.header("fixture-permission") !== "system-config") {
        res.status(403).json({ success: false }); return;
      }
      next();
    };
  } } as WorkbenchIdentity);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    // The authentication boundary, not the requested query/body domain, supplies identity.
    if (req.header("fixture-auth") === "yes") (req as AuthenticatedRequest).domainId = "verified-domain";
    next();
  });
  app.use("/api/model-settings", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/model-settings`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => { vi.clearAllMocks(); calls.get.mockResolvedValue({ ...settings, sealedApiKeys: { m: ["enc:v1:fixture"] } }); });
it("requires identity and projects only the page view using the verified domain", async () => {
  expect((await fetch(url)).status).toBe(403);
  const response = await fetch(url + "?domainId=foreign", { headers: { "fixture-auth": "yes" } });
  expect(await response.json()).toEqual({ success: true, data: settings });
  expect(calls.get).toHaveBeenCalledWith("verified-domain");
});
it("requires system-config for both saves and connection tests", async () => {
  for (const suffix of ["/save", "/test"]) {
    const response = await fetch(url + suffix, { method: "POST", headers: { "fixture-auth": "yes", "content-type": "application/json" }, body: JSON.stringify(write) });
    expect(response.status).toBe(403);
  }
  expect(calls.save).not.toHaveBeenCalled(); expect(calls.test).not.toHaveBeenCalled();
  calls.save.mockResolvedValue(settings);
  const response = await fetch(url + "/save", { method: "POST", headers: { "fixture-auth": "yes", "fixture-permission": "system-config", "content-type": "application/json" }, body: JSON.stringify(write) });
  expect(await response.json()).toEqual({ success: true, data: settings });
  expect(calls.save).toHaveBeenCalledWith("verified-domain", write);
});
it("does not turn unavailable configuration into an editable empty library", async () => {
  calls.get.mockRejectedValue(new Error("Runtime unavailable"));
  const response = await fetch(url, { headers: { "fixture-auth": "yes" } });
  expect(response.status).toBe(500);
  expect((await response.json()).success).toBe(false);
});

it("rejects a malformed upstream view instead of exposing plaintext keys", async () => {
  calls.get.mockResolvedValue({ ...settings, models: [{ ...model, apiKeys: ["plaintext-fixture-key"] }] });
  const response = await fetch(url, { headers: { "fixture-auth": "yes" } });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("plaintext-fixture-key");
});
