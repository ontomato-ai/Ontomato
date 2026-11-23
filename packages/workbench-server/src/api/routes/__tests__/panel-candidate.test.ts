import { vuePanelContent } from "../../../__tests__/fixtures/vue-panel";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { BUILD_TEST_HEADER, BUILD_TEST_UNSUPPORTED } from "@ontomato/contracts/build-tests";
import { candidatePanelSourceSchema } from "@ontomato/contracts/panel-host";
import { WorkspaceGit } from "../../../../../agent-runtime/src/workspace-git";
import { buildTestAccess } from "../../build-test-access";
import { errorHandler } from "../../middleware";
import { installContentLayout } from "../../../content/layout";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { config } from "../../../config/application";

const { productQuery } = vi.hoisted(() => ({ productQuery: vi.fn() }));
vi.mock("../../../infrastructure/postgres", async (original) => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: productQuery }),
}));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const scope = { hostId: "workbench", domainId: "domain-a" };
const projectionId = "agent-form";
const manifest = {
  state: {},
  members: { form: { target: { projectionId } } },
};
const messages = {
  en: { "settings.title": "Settings for {name}" },
  "zh-CN": { "settings.title": "{name} 的设置" },
};
const currentTest = {
  contextId: "context-a", workspaceId, status: "READY", expiresAt: Date.now() + 60_000,
  classNames: [], sampleSummary: { name: "test-data/sample.json", classes: 0, sha256: null }, resources: [],
};
const calls: string[] = [];
let allowProjection: boolean;
let issuedTest: typeof currentTest | null;
let server: Server;
let root: string;
let base: string;
let commit: string;

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
  root = await mkdtemp(join(tmpdir(), "panel-candidate-"));
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  installWorkbenchIdentity({ requireDomainId: () => scope.domainId } as unknown as WorkbenchIdentity);
  const git = new WorkspaceGit(join(root, "author-workspace"));
  await git.initialize();
  const { html, module } = vuePanelContent("form");
  await git.replace(Object.entries({
    "panel.html": html,
    "panel.mjs": 'throw new Error("The server must not execute the module");',
    "panel.json": JSON.stringify({ manifest, content: { messages } }),
    "recipes.md": "Committed recipes",
  }).map(([path, content]) => ({ path, content, encoding: "utf8" })));
  commit = await git.commit("Panel candidate");
  await rm(join(git.tree, "recipes.md"));
  await writeFile(join(git.tree, "panel.mjs"), module);
  await writeFile(join(git.tree, "panel.json"), JSON.stringify({ manifest }));


  const { workspaceRouter } = await import("../workspaces");
  const { productPanelsRouter, productProjectionsRouter } = await import("../product-panels");
  const app = express();
  app.use(express.json());
  const runtime = express.Router();
  runtime.use((req, res, next) => {
    expect(req.header("authorization")).toBe("Bearer test-runtime-token");
    if (req.header("x-domain-id") !== scope.domainId || req.header("x-workspace-owner-id") !== "alice") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
      return;
    }
    next();
  });
  runtime.get("/", (_req, res) => res.json({ id: workspaceId }));
  runtime.get("/tree", (req, res) => {
    const ref = req.query.commit as string | undefined;
    void (ref ? git.committedFiles(ref) : git.files()).then(files => res.json({ files }), () => {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Could not resolve commit" } });
    });
  });
  runtime.get("/files/content", (req, res, next) => {
    void git.content(req.query.path as string, req.query.commit as string | undefined).then(bytes => res.send(bytes), next);
  });
  app.use(`/v1/workspaces/${workspaceId}`, runtime);
  app.get("/java/platform/applications", (_req, res) => res.json({ success: true, data: [{
    id: "app-builder", kind: "native", names: { en: "App Builder" }, descriptions: {},
    icon: "Hammer", rail: "apps", category: "build", sort: 1, entry: { path: "/app-builder" },
    entryAccess: ["app-builder"], scheduleAdapter: null, releaseId: null,
  }] }));
  app.get("/java/ontology/build-tests/current", (req, res) => {
    calls.push(`test:${req.header("tk")}:${req.query.workspaceId}`);
    res.json(issuedTest);
  });
  app.post("/java/product-governance/check", (req, res) => {
    calls.push(`grant:${req.header("tk")}:${req.body.verb}:${req.body.id}`);
    res.json({ allowed: allowProjection && req.header("tk") === "alice" && req.body.id === projectionId });
  });
  app.post("/java/product-governance/resources", (_req, res) => res.json({ ids: [] }));
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { userId: req.header("tk"), domainId: scope.domainId, token: req.header("tk") });
    next();
  });
  app.use("/api", buildTestAccess);
  app.use("/api/workspaces", workspaceRouter);
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use(errorHandler);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv("AGENT_RUNTIME_URL", base);
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "test-runtime-token");
  vi.stubEnv("DATA_QUERY_BASE_URL", base + "/java");
  config.dataQuery.baseUrl = base + "/java";
});

beforeEach(() => {
  calls.length = 0;
  allowProjection = true;
  issuedTest = currentTest;
  productQuery.mockReset().mockResolvedValue({ rows: [{
    id: projectionId, domainId: scope.domainId, ownerId: "settings-owner", revision: 1,
    definition: {
      name: "Agent form", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectForm",
      inputs: {}, outputs: {}, data: {}, config: {},
    },
    createdAt: new Date(), updatedAt: new Date(),
  }] });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

function preview(ref: string, user = "alice") {
  return fetch(`${base}/api/workspaces/${workspaceId}/panel-candidate?${new URLSearchParams({ ref })}`, {
    headers: { tk: user, [BUILD_TEST_HEADER]: JSON.stringify({ kind: "build-test", contextId: "client-context" }) },
  });
}

it("loads a commit under the author, uses the workspace's current test context and only reads the registered projection", async () => {
  const response = await preview(commit);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(candidatePanelSourceSchema.parse(await response.json())).toEqual({
    kind: "candidate", workspace: { id: workspaceId, ref: commit },
    panel: {
      content: { html: vuePanelContent("form").html, module: 'throw new Error("The server must not execute the module");', recipes: "Committed recipes", messages },
      manifest,
    },
    previewContext: { kind: "build-test", test: currentTest },
  });
  expect(calls).toEqual(expect.arrayContaining([`test:alice:${workspaceId}`, `grant:alice:use:${projectionId}`]));
  expect(productQuery.mock.calls).toEqual([[expect.stringMatching(/^SELECT .*product_projections/), [scope.domainId, projectionId]]]);
});

it("reads the Vue panel from the working tree and preserves NONE as build-test", async () => {
  issuedTest = null;
  const response = await preview("working");
  expect(response.status).toBe(200);
  const source = candidatePanelSourceSchema.parse(await response.json());
  expect(source.workspace.ref).toBe("working");
  expect(source.panel.content).toMatchObject(vuePanelContent("form"));
  expect(source.panel.content).not.toHaveProperty("recipes");
  expect(source.panel.content).not.toHaveProperty("messages");
  expect(source.previewContext).toEqual({ kind: "build-test", test: null });
});

it("rejects a non-author before any context or projection read", async () => {
  const response = await preview(commit, "bob");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(calls).toEqual([]);
  expect(productQuery).not.toHaveBeenCalled();
});

it("rejects a commit outside workspace history before reading the context or product", async () => {
  const response = await preview("b".repeat(40));
  expect(response.ok).toBe(false);
  expect(calls).toEqual([]);
  expect(productQuery).not.toHaveBeenCalled();
});

it("rejects a referenced projection when the author has no use Grant", async () => {
  allowProjection = false;
  const response = await preview(commit);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(productQuery).not.toHaveBeenCalled();
});

async function candidateMember(ref: string, member = "form", userId = "alice") {
  const { resolvePanelCandidateMember } = await import("../../../services/workspaces/panel-candidate");
  return resolvePanelCandidateMember({ domainId: scope.domainId, userId }, { token: userId },
    { id: workspaceId, ref }, [{ member }]);
}

it("resolves a coded candidate's member from its commit and scopes the projection read to the author", async () => {
  const result = await candidateMember(commit);
  expect(result.panel.content.module).toBe('throw new Error("The server must not execute the module");');
  expect(result.member).toEqual(manifest.members.form);
  expect(result.projection).toMatchObject({ id: projectionId, ownerId: "settings-owner" });
  expect(result.previewContext).toEqual({ kind: "build-test", test: currentTest });
  expect(calls).toEqual([`grant:alice:use:${projectionId}`, `test:alice:${workspaceId}`]);
  expect(productQuery.mock.calls).toEqual([[expect.stringMatching(/^SELECT .*product_projections/), [scope.domainId, projectionId]]]);
});

it("resolves a working candidate without a test as build-test NONE", async () => {
  issuedTest = null;
  const result = await candidateMember("working");
  expect(result.panel.content.module).toBe(vuePanelContent("form").module);
  expect(result.previewContext).toEqual({ kind: "build-test", test: null });
});

it.each([
  ["an undeclared member", "missing", "alice", "FORBIDDEN"],
  ["another user's workspace", "form", "bob", "NOT_FOUND"],
] as const)("refuses %s before checking the projection or test context", async (_name, member, user, code) => {
  await expect(candidateMember(commit, member, user)).rejects.toMatchObject({ code });
  expect(calls).toEqual([]);
  expect(productQuery).not.toHaveBeenCalled();
});

it("requires the author's use Grant before loading a candidate member's projection", async () => {
  allowProjection = false;
  await expect(candidateMember(commit)).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  expect(calls).toEqual([`grant:alice:use:${projectionId}`]);
  expect(productQuery).not.toHaveBeenCalled();
});

it.each(["product-panels", "product-projections"])("refuses a build-test management write at %s before changing product records", async (collection) => {
  const response = await fetch(`${base}/api/${collection}/${projectionId}`, {
    method: "PUT", headers: { tk: "alice", [BUILD_TEST_HEADER]: JSON.stringify({ kind: "build-test", contextId: null }) },
  });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ code: BUILD_TEST_UNSUPPORTED });
  expect(calls).toEqual([]);
  expect(productQuery).not.toHaveBeenCalled();
});
