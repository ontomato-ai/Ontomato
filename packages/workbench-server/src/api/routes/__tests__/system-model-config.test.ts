import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import router from "../system-model-config";
import { installContentLayout } from "../../../content/layout";
import { getSystemModelConfig, saveSystemModelConfig } from "../../../config/system-model";
import type { AuthenticatedRequest } from "../../../utils/request-identity";

vi.mock("../../../identity/installed", () => ({
  requirePermission: (keys: readonly string[]) => (req: Request, res: Response, next: NextFunction) => {
    if (keys.length === 1 && keys[0] === "system-config" && req.get("x-fixture-role") === "admin") {
      next();
    } else {
      res.status(403).json({ success: false, message: "forbidden" });
    }
  },
}));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error() {}, warn() {} }) }));
vi.mock("../../../i18n", () => ({ t: (key: string) => key, tApp: (key: string) => key }));

let runtimeRoot: string;
let server: Server;
let endpoint: string;
beforeAll(async () => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "node-runtime-api-test-"));
  installContentLayout({ runtimeRoot, prompts: [], publicSkillsRoot: path.join(runtimeRoot, "skills"), runtimeResources: [] });
  saveSystemModelConfig("domain-a", { abcQuestionMode: "tool_fixed", queryTimeoutSeconds: 90 });
  const app = express();
  app.use(express.json());
  // Model the domain established by authentication, independently of the request body.
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).domainId = "domain-a";
    next();
  });
  app.use("/api/system-model-config", router);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/system-model-config`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

it("keeps reads available but requires system configuration permission for partial writes", async () => {
  const read = await fetch(endpoint);
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ data: { nodeModelStreamingEnabled: true } });

  const denied = await fetch(`${endpoint}/save`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ nodeModelStreamingEnabled: false }),
  });
  expect(denied.status).toBe(403);
  await denied.json();
  expect(getSystemModelConfig("domain-a").nodeModelStreamingEnabled).toBe(true);

  const saved = await fetch(`${endpoint}/save`, {
    method: "POST", headers: { "content-type": "application/json", "x-fixture-role": "admin" },
    body: JSON.stringify({ nodeModelStreamingEnabled: false, domainId: "domain-b" }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ success: true, data: {
    abcQuestionMode: "tool_fixed", queryTimeoutSeconds: 90, nodeModelStreamingEnabled: false,
  } });
  expect(getSystemModelConfig("domain-a").nodeModelStreamingEnabled).toBe(false);
  expect(getSystemModelConfig("domain-b").nodeModelStreamingEnabled).toBe(true);
});
