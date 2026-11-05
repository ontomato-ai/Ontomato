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
installContentLayout({ runtimeRoot: root, prompts: [{ from: path.resolve("prompts"), to: "." }], runtimeResources: [], publicSkillsRoot: path.join(root, "public") });
configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
vi.mock("../../../identity/installed", () => ({ requirePermission: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next() }));

const { syncDefaultPrompts } = await import("../../../core/prompts/loader");
syncDefaultPrompts();
const { default: skillsRouter } = await import("../../../api/routes/skills");
const { sendError } = await import("../../../api/utils/http");
const { skillRegistryManager } = await import("../index");
const { resolveSkillPackageFile } = await import("../discovery/loader");
const { executeSkill } = await import("../execution/executor");
const { skillRuntime } = await import("../execution/runtime");
const { AnalysisSkillExecutor } = await import("../../../services/analysis-agent/dimension/skill-executor");

const realFetch = globalThis.fetch;

const modelFake = vi.hoisted(() => ({
  prompts: [] as unknown[],
  calls: 0,
  mode: "invalid" as "invalid" | "valid" | "throw",
  validIds: ["k-one"],
}));

vi.mock("../../../config/model-factory", () => ({
  createModel: () => ({
    stream: async (messages: unknown) => {
      modelFake.calls += 1;
      modelFake.prompts.push(messages);
      if (modelFake.mode === "throw") throw new Error("fake-model-down");
      const content =
        modelFake.mode === "valid"
          ? JSON.stringify({ selectedSkills: modelFake.validIds })
          : "not json at all";
      return (async function*() {
        yield { content };
      })();
    },
  }),
}));

vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ error() { }, warn() { }, info() { }, debug() { } }) }));

const scratchDirs: string[] = [];
let server: http.Server;
let baseUrl: string;

function errorHandler(err: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) {
  sendError(res, err);
}
function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
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

async function seedDomain(domain: string, skills: Array<{ dir: string; md: string; files?: Record<string, string> }>) {
  const root = skillRegistryManager.getDomainSkillsRoot(domain);
  fs.mkdirSync(root, { recursive: true });
  for (const skill of skills) {
    const dir = path.join(root, skill.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill.md);
    for (const [name, content] of Object.entries(skill.files ?? {})) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  return skillRegistryManager.forDomain(domain);
}

const KNOWLEDGE_MD = (id: string, extra = "") =>
  `---\nname: ${id}\ndescription: desc-${id}\ntype: knowledge\ncategory: analysis${extra}\n---\nbody-${id}\n`;

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
  modelFake.prompts.length = 0;
  modelFake.calls = 0;
  modelFake.mode = "invalid";
  modelFake.validIds = ["k-one"];
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  skillRegistryManager.dispose();
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });

});

describe("skill registry boundaries", () => {
  it("rejects missing, incompatible, unselected and disabled skills", async () => {
    const registry = await seedDomain("t5d-resolve", [
      { dir: "knowledge/analysis/k-one", md: KNOWLEDGE_MD("k-one") },
      {
        dir: "executable/analysis/e-one",
        md: `---\nname: e-one\ndescription: d\ntype: executable\ncategory: analysis\nentries: ["scripts/index.mjs"]\n---\nbody\n`,
        files: { "scripts/index.mjs": "export {};\n" },
      },
    ]);

    const notFound = captureThrow(() => registry.resolveSkill("nope", {})) as
      | (Error & { code: string })
      | null;
    expect(notFound?.code).toBe("SKILL_NOT_FOUND");

    const typeMismatch = captureThrow(() =>
      registry.resolveSkill("k-one", { type: "executable" })
    ) as (Error & { code: string }) | null;
    expect(typeMismatch?.code).toBe("SKILL_TYPE_MISMATCH");

    const categoryMismatch = captureThrow(() =>
      registry.resolveSkill("k-one", { category: "visualization" })
    ) as (Error & { code: string }) | null;
    expect(categoryMismatch?.code).toBe("SKILL_CATEGORY_MISMATCH");

    const notSelected = captureThrow(() =>
      registry.resolveSkill("k-one", { selectedSkillIds: ["other"] })
    ) as (Error & { code: string }) | null;
    expect(notSelected?.code).toBe("SKILL_NOT_SELECTED");

    registry.setSkillEnabled("k-one", false);
    const disabled = captureThrow(() => registry.resolveSkill("k-one", {})) as
      | (Error & { code: string })
      | null;
    expect(disabled?.code).toBe("SKILL_DISABLED");

    registry.setSkillEnabled("k-one", true);
  });

  it("records the debug-route exit for an unknown skill without redesigning it", async () => {

    const response = await realFetch(`${baseUrl}/api/skills/nope/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "SKILL_NOT_FOUND",
    });
  });

  it("returns a failed dimension result for an unresolved skill", async () => {
    const executor = new AnalysisSkillExecutor();
    const result = await executor.executeSkill("t5d-dimension", "nope", {}, []);
    expect(result).toMatchObject({ success: false, skillId: "nope" });

  });

  it("returns selected skills and no matches for absent or invalid model results", async () => {
    const empty = await seedDomain("t5d-empty", []);
    const emptyEvents: Array<{ type: string; content: string }> = [];
    const emptyMatches = await empty.matchKnowledgeSkillsWithLLM("q", "analysis", [], (event) =>
      emptyEvents.push(event)
    );
    expect(emptyMatches).toEqual([]);
    expect(modelFake.calls).toBe(0);

    const registry = await seedDomain("t5d-match", [
      { dir: "knowledge/analysis/k-one", md: KNOWLEDGE_MD("k-one") },
    ]);
    modelFake.mode = "invalid";
    expect(await registry.matchKnowledgeSkillsWithLLM("q", "analysis", [])).toEqual([]);

    modelFake.mode = "valid";
    const matchedEvents: Array<{ type: string; content: string }> = [];
    const matched = await registry.matchKnowledgeSkillsWithLLM("q", "analysis", [], (event) =>
      matchedEvents.push(event)
    );
    expect(matched.map((m) => m.skill.id)).toEqual(["k-one"]);

    modelFake.mode = "throw";
    expect(await registry.matchKnowledgeSkillsWithLLM("q", "analysis", [])).toEqual([]);

  });

  it("rejects the three package boundaries through the real loader", async () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "t5d-pkg-"));
    scratchDirs.push(pkg);
    fs.writeFileSync(path.join(pkg, "ok.txt"), "ok");
    fs.mkdirSync(path.join(pkg, "sub"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "t5d-outside-"));
    scratchDirs.push(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(pkg, "link.txt"));
    const skill = { path: pkg } as never;

    const relative = await resolveSkillPackageFile(skill, "../escape").then(
      () => null,
      (error: unknown) => error as Error
    );

    const traversed = await resolveSkillPackageFile(skill, "link.txt").then(
      () => null,
      (error: unknown) => error as Error
    );

    const directory = await resolveSkillPackageFile(skill, "sub").then(
      () => null,
      (error: unknown) => error as Error
    );

    for (const failure of [relative, traversed, directory]) expect(failure).toBeInstanceOf(Error);
    await expect(resolveSkillPackageFile(skill, "ok.txt")).resolves.toBe(
      await fs.promises.realpath(path.join(pkg, "ok.txt"))
    );
  });

  it("rejects undeclared entries before any backend IO", async () => {
    const meta = {
      id: "e-entry",
      manifest: { type: "executable", entries: ["scripts/index.mjs"] },
    } as never;
    const direct = await executeSkill(meta, {}, undefined, { entry: "scripts/other.mjs" }).then(
      () => null,
      (error: unknown) => error as Error
    );

    await seedDomain("t5d-entry", [
      {
        dir: "executable/analysis/e-entry",
        md: `---\nname: e-entry\ndescription: d\ntype: executable\ncategory: analysis\nentries: ["scripts/index.mjs"]\n---\nbody\n`,
        files: { "scripts/index.mjs": "export {};\n" },
      },
    ]);
    expect(direct).toBeInstanceOf(Error);
    const viaRuntime = await skillRuntime
      .execute("t5d-entry", "e-entry", {}, {}, { entry: "scripts/other.mjs" })
      .then(
        () => null,
        (error: unknown) => error as Error
      );

    expect(viaRuntime).toBeInstanceOf(Error);
  });
});
