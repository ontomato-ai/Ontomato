import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import { appBuilderRouter } from "../app-builder";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const fixture = vi.hoisted(() => ({
  builderAgent: "11111111-1111-4111-8111-111111111111",
  builderSession: "22222222-2222-4222-8222-222222222222",
  regularAgent: "33333333-3333-4333-8333-333333333333",
  regularSession: "44444444-4444-4444-8444-444444444444",
}));
vi.mock("../../../services/app-builder/bootstrap", () => ({
  appBuilderBootstrap: async () => ({ agentId: fixture.builderAgent }),
}));
vi.mock("../../../services/assistant/service", () => ({
  assistantService: {
    isAppBuilder: async (_owner: unknown, input: { agentId?: string; sessionId?: string }) =>
      input.agentId === fixture.builderAgent || input.sessionId === fixture.builderSession,
    create: async (_id: string, _owner: unknown, input: { agentId: string }) => ({ agentId: input.agentId }),
    start: async (sessionId: string) => ({ sessionId }),
  },
}));

const realFetch = globalThis.fetch;
let server: Server;
let base: string;
let runtimeRoot: string;
const builder: CatalogApplication = {
  id: "app-builder", kind: "native", names: { en: "App Builder" }, descriptions: {},
  icon: "Hammer", rail: "apps", category: "build", sort: 1, entry: { path: "/app-builder" },
  entryAccess: ["app-builder"], scheduleAdapter: null, releaseId: null,
};

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
  runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "app-builder-access-"));
  installContentLayout({ runtimeRoot, publicSkillsRoot: runtimeRoot, prompts: [], runtimeResources: [] });
  const { default: assistantRouter } = await import("../assistant");
  installWorkbenchIdentity({
    requireDomainId: () => "domain-a",
    requirePermission: () => {
      throw new Error("App Builder must use application entry authorization");
    },
  } as unknown as WorkbenchIdentity);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      userId: "alice", domainId: "domain-a", token: req.header("tk"), apiKey: req.header("x-api-key"),
    });
    next();
  });
  app.use("/api", appBuilderRouter);
  app.use("/api/assistant", assistantRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(runtimeRoot, { recursive: true, force: true });
});

function request(entry: string, headers: Record<string, string> = { tk: "synthetic-token" }, regular = false) {
  const sessionId = regular ? fixture.regularSession : fixture.builderSession;
  const agentId = regular ? fixture.regularAgent : fixture.builderAgent;
  return realFetch(base + (entry === "bootstrap" ? "/api/app-builder/bootstrap"
    : `/api/assistant/sessions${entry === "run" ? `/${sessionId}/runs` : ""}`), {
    method: entry === "bootstrap" ? "GET" : "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": fixture.builderSession },
    body: entry === "bootstrap" ? undefined : JSON.stringify(entry === "run" ? { message: "Build an app" } : { agentId }),
  });
}

for (const [entry, allowedStatus] of [["bootstrap", 200], ["session", 201], ["run", 202]] as const) {
  describe(entry, () => {
    it.each([
      ["token", { tk: "synthetic-token" }],
      ["API key", { "x-api-key": "synthetic-key" }],
      ["open source", {}],
    ] as const)("allows an application present in the navigation catalog with %s credentials", async (_kind, credentials) => {
      vi.stubGlobal("fetch", vi.fn(async (url, options) => {
        expect(new URL(String(url)).pathname + new URL(String(url)).search)
          .toBe("/platform/applications?purpose=navigation");
        const headers = new Headers(options?.headers);
        expect(headers.get("tk")).toBe("tk" in credentials ? credentials.tk : null);
        expect(headers.get("x-api-key")).toBe("x-api-key" in credentials ? credentials["x-api-key"] : null);
        return Response.json({ success: true, data: [builder] });
      }));
      expect((await request(entry, credentials)).status).toBe(allowedStatus);
    });

    it.each([
      ["empty", []],
      ["another application", [{ ...builder, id: "other-app" }]],
    ])("denies access when the successful catalog contains %s", async (_label, catalog) => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data: catalog })));
      const response = await request(entry);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it.each(["http", "network", "business", "malformed"])("reports a %s catalog failure as upstream unavailable", async (failure) => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (failure === "network") throw new Error("connection refused");
        if (failure === "http") return new Response(null, { status: 503 });
        if (failure === "business") return Response.json({ success: false, code: 200, message: "upstream error" });
        return Response.json({ success: true, data: {} });
      }));
      const response = await request(entry);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
    });
  });
}

it.each([["session", 201], ["run", 202]] as const)("keeps regular assistant %s access independent of the App Builder catalog", async (entry, status) => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("catalog unavailable"); }));
  expect((await request(entry, {}, true)).status).toBe(status);
});
