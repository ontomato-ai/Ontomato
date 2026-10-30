import express, { Response as ExpressResponse, NextFunction, Request } from "express";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-contract-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.join(root, "public") });
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
vi.mock("../../../identity/installed", () => ({ requirePermission: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next() }));

const { default: skillsRouter } = await import("../skills");
const { sendError } = await import("../../utils/http");
const { skillManager } = await import("../../../services/skills/skill-manager");
const { readSkillMarkdown } = await import("../../../core/skills/manifest");
const { skillRegistryManager } = await import("../../../core/skills/index");
const { skillRuntime } = await import("../../../core/skills/index");

const realFetch = globalThis.fetch;

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));
const refsFake = vi.hoisted(() => ({
  list: async (): Promise<unknown[]> => [],
  remove: async (): Promise<number> => 0,
  restore: async (): Promise<void> => { },
}));

vi.mock("../../../services/analysis-agent/config/skill-references", () => ({
  listAnalysisAgentSkillReferences: () => refsFake.list(),
  removeAnalysisAgentSkillReferences: () => refsFake.remove(),
  restoreAnalysisAgentSkillReferences: () => refsFake.restore(),
}));

let server: http.Server;
let baseUrl: string;

function errorHandler(err: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) {
  sendError(res, err);
}

function attachAuth(req: Request, _res: ExpressResponse, next: NextFunction) {
  const authed = req as AuthenticatedRequest;
  authed.userId = "user-a";
  authed.userName = "User A";
  authed.roles = [];
  authed.token = "caller-token";
  authed.apiKey = "";
  authed.locale = "zh-CN";
  authed.domainId = "domain-a";
  next();
}

function postJson(url: string, body: unknown) {
  return realFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postZip(url: string, filename: string, zip: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(zip).buffer]), filename);
  return realFetch(url, { method: "POST", body: form });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(attachAuth);
  app.use("/api/skills", skillsRouter);
  app.use(errorHandler);

  server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refsFake.list = async () => [];
  refsFake.remove = async () => 0;
  refsFake.restore = async () => { };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  skillRegistryManager.dispose();
  fs.rmSync(root, { recursive: true, force: true });

});

describe("skill management lifecycle", () => {

  it("renders through the current domain runtime with visualization constraints and strips injected services", async () => {
    const execute = vi.spyOn(skillRuntime, "execute").mockResolvedValue({ html: "<html>chart</html>" });
    const response = await postJson(`${baseUrl}/api/skills/echarts/render`, {
      input: { data: [{ name: "A", count: 7 }], chartType: "donut", title: "Distribution", services: { injected: true } },
      domainId: "forged",
    });
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith("domain-a", "echarts", { data: [{ name: "A", count: 7 }], chartType: "donut", title: "Distribution", locale: "*" }, { type: "executable", category: "visualization" });
    expect(await response.json()).toEqual({ success: true, result: { html: "<html>chart</html>" } });
  });

  it("rejects failed visualization output rather than embedding an error as a chart", async () => {
    vi.spyOn(skillRuntime, "execute").mockResolvedValue({ html: "<p>error</p>", meta: { error: true } });
    const response = await postJson(`${baseUrl}/api/skills/echarts/render`, { input: { data: [], chartType: "donut", title: "Distribution" } });
    expect(response.status).toBe(422);
  });

  it("runs the full create/update/export/import/overwrite scenario", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s1w",
      type: "executable",
      category: "analysis",
      description: "中文描述一",
    });
    expect(created.status).toBe(200);
    const dir = path.join(
      skillRegistryManager.getDomainSkillsRoot("domain-a"),
      "executable",
      "analysis",
      "s1w"
    );

    const renamed = await realFetch(`${baseUrl}/api/skills/s1w`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "中文标题",
        description: "中文描述二",
        skillContent: "中文正文体\n第二行\n",
      }),
    });
    expect(renamed.status).toBe(200);
    expect(readSkillMarkdown(path.join(dir, "SKILL.md"))?.content).toBe("中文正文体\n第二行\n");

    const exported = await realFetch(`${baseUrl}/api/skills/s1w/export`);
    expect(exported.status).toBe(200);
    const zip = Buffer.from(await exported.arrayBuffer());

    const deleted = await realFetch(`${baseUrl}/api/skills/s1w`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const imported = await postZip(`${baseUrl}/api/skills/import`, "s1w.zip", zip);
    expect(imported.status).toBe(200);

    const conflict = await postZip(`${baseUrl}/api/skills/import`, "s1w.zip", zip);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      success: false,
      code: "SKILL_EXISTS",

    });

    const overwrite = await postZip(`${baseUrl}/api/skills/import?overwrite=true`, "s1w.zip", zip);
    expect(overwrite.status).toBe(200);
  });

  it("records duplicate and frontmatter failures on its own skill", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s1f",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(created.status).toBe(200);
    try {
      const duplicate = await postJson(`${baseUrl}/api/skills/`, {
        id: "s1f",
        type: "executable",
        category: "analysis",
        description: "d",
      });
      expect(duplicate.status).toBe(500);
      expect(await duplicate.json()).toMatchObject({ success: false, });

      const mdPath = path.join(
        skillRegistryManager.getDomainSkillsRoot("domain-a"),
        "executable",
        "analysis",
        "s1f",
        "SKILL.md"
      );
      const saved = fs.readFileSync(mdPath, "utf-8");
      fs.writeFileSync(mdPath, "plain body without frontmatter\n");
      try {
        const broken = await realFetch(`${baseUrl}/api/skills/s1f`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "y" }),
        });
        expect(broken.status).toBe(500);
      } finally {
        fs.writeFileSync(mdPath, saved);
      }
    } finally {
      await realFetch(`${baseUrl}/api/skills/s1f`, { method: "DELETE" });
    }
  });

  it("records original 400/500 mapping on import and direct update failures", async () => {

    const garbage = await postZip(
      `${baseUrl}/api/skills/import`,
      "bad.zip",
      Buffer.from("not-a-zip")
    );
    expect(garbage.status).toBe(400);

    const unknownUpdate = await realFetch(`${baseUrl}/api/skills/nope`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(unknownUpdate.status).toBe(500);
    expect(await unknownUpdate.json()).toMatchObject({
      success: false,

    });

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s1g",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(created.status).toBe(200);
    try {
      const badUpdate = await skillManager
        .updateSkill("domain-a", "s1g", { description: "" })
        .then(
          () => null,
          (error: unknown) => error as Error
        );
      expect(badUpdate).toBeInstanceOf(Error);
    } finally {
      await realFetch(`${baseUrl}/api/skills/s1g`, { method: "DELETE" });
    }
  });

  it("records the unregistered-directory exit on its own skill", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s1u",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(created.status).toBe(200);
    const exported = await realFetch(`${baseUrl}/api/skills/s1u/export`);
    const zip = Buffer.from(await exported.arrayBuffer());

    const deleted = await realFetch(`${baseUrl}/api/skills/s1u`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const ghostDir = path.join(
      skillRegistryManager.getDomainSkillsRoot("domain-a"),
      "executable",
      "analysis",
      "s1u"
    );
    fs.mkdirSync(ghostDir, { recursive: true });
    try {
      const ghost = await postZip(`${baseUrl}/api/skills/import`, "s1u.zip", zip);
      expect(ghost.status).toBe(400);
    } finally {
      fs.rmSync(ghostDir, { recursive: true, force: true });
    }

    const recreated = await postZip(`${baseUrl}/api/skills/import`, "s1u.zip", zip);
    expect(recreated.status).toBe(200);
    await realFetch(`${baseUrl}/api/skills/s1u`, { method: "DELETE" });
  });
});

describe("skill management lifecycle", () => {
  it("persists enablement and returns skill content", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s2t",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(created.status).toBe(200);
    try {
      const off = await realFetch(`${baseUrl}/api/skills/s2t/toggle`, { method: "PUT" });
      expect(off.status).toBe(200);
      expect(await off.json()).toMatchObject({ success: true, enabled: false });
      const on = await realFetch(`${baseUrl}/api/skills/s2t/toggle`, { method: "PUT" });
      expect(await on.json()).toMatchObject({ success: true, enabled: true });

      const script = await realFetch(`${baseUrl}/api/skills/s2t/script`);
      expect(script.status).toBe(200);
      expect(((await script.json()) as { scriptCode: string }).scriptCode).toContain("s2t");
      const content = await realFetch(`${baseUrl}/api/skills/s2t/content`);
      expect(content.status).toBe(200);
    } finally {
      await realFetch(`${baseUrl}/api/skills/s2t`, { method: "DELETE" });
    }
  });

  it("rejects unknown skills on read paths", async () => {

    const paths: Array<[string, string]> = [
      ["PUT", "/api/skills/nope/toggle"],
      ["GET", "/api/skills/nope/references"],
      ["GET", "/api/skills/nope/script"],
      ["GET", "/api/skills/nope/content"],
      ["GET", "/api/skills/nope/export"],
    ];
    for (const [method, route] of paths) {
      const response = await realFetch(`${baseUrl}${route}`, { method });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ success: false });
    }
  });

  it("deletes skills and reports reference cleanup failures", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s2d",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(created.status).toBe(200);
    const deleted = await realFetch(`${baseUrl}/api/skills/s2d`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const doomed = await postJson(`${baseUrl}/api/skills/`, {
      id: "s2f",
      type: "executable",
      category: "analysis",
      description: "d",
    });
    expect(doomed.status).toBe(200);
    refsFake.remove = async () => {
      throw new Error("fake-refs-down");
    };
    try {
      const failed = await realFetch(`${baseUrl}/api/skills/s2f`, { method: "DELETE" });
      expect(failed.status).toBe(500);

    } finally {
      refsFake.remove = async () => 0;
      await realFetch(`${baseUrl}/api/skills/s2f`, { method: "DELETE" });
    }
  });

  it("fails debug on throwing scripts and stale entries", async () => {

    const created = await postJson(`${baseUrl}/api/skills/`, {
      id: "s2x",
      type: "executable",
      category: "analysis",
      description: "d",
      scriptCode: "throw new Error('boom-debug');",
    });
    expect(created.status).toBe(200);
    try {
      const failed = await realFetch(`${baseUrl}/api/skills/s2x/debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      expect(failed.status).toBe(500);

      const forDomain = vi
        .spyOn(skillRegistryManager, "forDomain")
        .mockResolvedValue({ resolveSkill: () => ({ id: "stale", manifest: {} }) } as never);
      try {
        const stale = await realFetch(`${baseUrl}/api/skills/stale/debug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: {} }),
        });
        expect(stale.status).toBe(500);
        expect(await stale.json()).toMatchObject({
          success: false,

        });

      } finally {
        forDomain.mockRestore();
      }
    } finally {
      await realFetch(`${baseUrl}/api/skills/s2x`, { method: "DELETE" });
    }
  });

  it("records the missing export directory exit", async () => {

    const owned = fs.mkdtempSync(path.join(os.tmpdir(), "t5s-ghost-"));
    const ghostDir = path.join(owned, "s2e");
    fs.rmSync(owned, { recursive: true, force: true });
    const forDomain = vi
      .spyOn(skillRegistryManager, "forDomain")
      .mockResolvedValue({
        getSkillById: () => ({ id: "s2e", path: ghostDir, manifest: {} }),
      } as never);
    try {
      const missing = await realFetch(`${baseUrl}/api/skills/s2e/export`);
      expect(missing.status).toBe(500);
      expect(await missing.json()).toMatchObject({
        success: false,
      });

    } finally {
      forDomain.mockRestore();
    }
  });
});
