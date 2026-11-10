import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuildInfo, HealthResponse } from "@ontomato/contracts/health";
import { installContentLayout } from "../../../content/layout";
import { createHealthRouter } from "../health";

let root: string;
let server: Server;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "health-build-"));
  installContentLayout({
    runtimeRoot: root,
    prompts: [],
    publicSkillsRoot: root,
    runtimeResources: [],
  });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function health(): Promise<HealthResponse> {
  const app = express();
  app.use("/api/health", createHealthRouter());
  // Health remains public even when later API routes require authentication.
  app.use("/api", (_req, res) => { res.sendStatus(401); });
  server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
  expect(response.status).toBe(200);
  return response.json() as Promise<HealthResponse>;
}

describe("public health build facts", () => {
  it.each([
    { sources: [{ id: "ontomato", revision: "a".repeat(40) }] },
    { sources: [{ id: "ontomato", revision: "a".repeat(40) }, { id: "enterprise", revision: "b".repeat(40) }] },
  ])("returns the image's exact version and source revisions: %j", async ({ sources }) => {
    const build: BuildInfo = { version: "5.0.0-dev-ci418456-g889fe1c6e27f", sources };
    writeFileSync(join(root, "build-info.json"), JSON.stringify(build));
    const result = await health();
    expect(result.build).toEqual(build);
    expect(result.status).toBe("ok");
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it("identifies a local build explicitly without inventing source revisions", async () => {
    expect((await health()).build).toEqual({ version: "local-build", sources: [] });
  });
});
