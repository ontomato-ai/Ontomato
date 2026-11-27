import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { AGENT_DEFINITION, DELETE_SKILL, IMPORT_SKILL, SKILL } from "@ontomato/contracts/panel-client-requests";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const mocks = vi.hoisted(() => ({
  filterReadableAgentDefinitions: vi.fn(),
  listAnalysisAgentSkillReferences: vi.fn(),
  removeAnalysisAgentSkillReferences: vi.fn(),
}));

vi.mock("../../assistant/definitions", () => ({
  filterReadableAgentDefinitions: mocks.filterReadableAgentDefinitions,
}));
vi.mock("../../assistant/skill-references", () => ({
  listAnalysisAgentSkillReferences: mocks.listAnalysisAgentSkillReferences,
  removeAnalysisAgentSkillReferences: mocks.removeAnalysisAgentSkillReferences,
}));

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: {
    en: { messages: en, ...enLocaleMeta },
    "zh-CN": {
      ...enLocaleMeta,
      messages: {
        ...en,
        "panels.skill.readOnlyPublic": "内置技能随产品提供，不能删除",
        "panels.skill.readOnlyProvider": "由 {provider} 提供，不能在这里删除",
        "panels.confirmation.deleteSkillImpact": "此操作将删除所选技能，并清理 {count} 个智能体对它的引用。",
      } as typeof en,
    },
  },
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-panel-ops-"));
const publicSkillsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-panel-ops-pub-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot });

const { skillServerOperations } = await import("../panel-operations");
const deleteOp = skillServerOperations.find((op): op is Extract<typeof op, { targetInput: string }> => op.handlerRef === DELETE_SKILL)!;
if (deleteOp.kind !== "action") throw new Error("Expected action operation");
const importOp = skillServerOperations.find((op): op is Extract<typeof op, { upload: object }> => op.handlerRef === IMPORT_SKILL)!;

const domain = "skill-ops-domain";
const actor = { owner: { domainId: domain, userId: "operator" }, credentials: { token: "op-token", locale: "en" } };
const host: PanelOperationHost = {
  locale: "en",
  initiator: actor,
  executor: actor,
  async request() {
    throw new Error("Skill delete does not call data-query");
  },
  async requestWorkbench() {
    throw new Error("Skill delete does not call workbench HTTP");
  },
};

async function installDomainSkill(name: string, description = "Domain skill") {
  const dir = path.join(root, "data", "domain-skills", domain, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`);
  return dir;
}

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(publicSkillsRoot, { recursive: true, force: true });
});

const { skillLibraryRead, skillLibraryChange } = workbenchManagement;
let refused: string | undefined;
beforeEach(() => {
  refused = undefined;
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "test-service-token");
  mocks.filterReadableAgentDefinitions.mockReset();
  mocks.listAnalysisAgentSkillReferences.mockReset().mockResolvedValue([]);
  mocks.removeAnalysisAgentSkillReferences.mockReset().mockResolvedValue(0);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (url.endsWith("/internal/workbench-management/require")) {
      const { operationId, domainId } = JSON.parse(String(init.body));
      expect(domainId).toBe(domain);
      expect([skillLibraryRead.id, skillLibraryChange.id]).toContain(operationId);
      return operationId === refused
        ? Response.json({ message: "Skill operation denied" }, { status: 403 })
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected upstream: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("skill panel server operations", () => {
  it("declares skills.delete metadata and target schema", () => {
    expect(deleteOp).toMatchObject({
      handlerRef: DELETE_SKILL,
      labelKey: "panels.skill.delete",
      kind: "action",
      binding: { kind: "PlatformOperation", id: DELETE_SKILL },
      effect: "write",
      batch: false,
      targetType: SKILL,
      targetInput: "skill",
    });
    expect(deleteOp.inspectImpact?.handlerRef).toBe(`${DELETE_SKILL}.inspect-impact`);
    expect(deleteOp.targetSchema.safeParse({ kind: "object", objectType: SKILL, primaryKey: "my-skill" }).success).toBe(true);
    expect(deleteOp.targetSchema.safeParse({ kind: "draft" }).success).toBe(false);
  });

  it("inspects readable agent references and reads the skill title", async () => {
    refused = skillLibraryRead.id;
    await installDomainSkill("custom-skill");
    const agent1 = "11111111-1111-4111-8111-111111111111";
    const agent2 = "22222222-2222-4222-8222-222222222222";
    mocks.listAnalysisAgentSkillReferences.mockResolvedValue([
      { id: agent1, name: "Readable agent", usesAnalysis: true, usesVisualization: false },
      { id: agent2, name: "Hidden agent", usesAnalysis: true, usesVisualization: false },
    ]);
    mocks.filterReadableAgentDefinitions.mockResolvedValue(new Set([agent1]));

    const target = { kind: "object" as const, objectType: SKILL, primaryKey: "custom-skill" };
    await expect(deleteOp.unavailable(host, target)).resolves.toBeUndefined();
    expect(await deleteOp.targetLabel(host, target)).toBe("custom-skill");
    expect(await deleteOp.inspectImpact!.inspect(host, [{ target, input: {} }])).toEqual({
      summary: "This deletes the selected skill and removes its references from 1 agent(s).",
      objects: [{ target: { objectType: AGENT_DEFINITION, primaryKey: agent1 }, label: "Readable agent" }],
      total: 1,
    });
    expect(mocks.filterReadableAgentDefinitions).toHaveBeenCalledWith(actor.owner, actor.credentials, [agent1, agent2]);
  });

  it("deletes a writable domain skill and returns affected skill and readable agents", async () => {
    refused = skillLibraryRead.id;
    const dir = await installDomainSkill("removable-skill");
    const agent1 = "11111111-1111-4111-8111-111111111111";
    mocks.listAnalysisAgentSkillReferences.mockResolvedValue([
      { id: agent1, name: "Sales agent", usesAnalysis: true, usesVisualization: false },
    ]);
    mocks.filterReadableAgentDefinitions.mockResolvedValue(new Set([agent1]));

    const outcome = await deleteOp.execute(
      host,
      { kind: "object", objectType: SKILL, primaryKey: "removable-skill" },
    );

    expect(mocks.removeAnalysisAgentSkillReferences).toHaveBeenCalledWith(domain, "removable-skill");
    expect(outcome).toEqual({
      kind: "success",
      data: {},
      affected: {
        objects: [
          { objectType: SKILL, primaryKey: "removable-skill" },
          { objectType: AGENT_DEFINITION, primaryKey: agent1 },
        ],
        objectTypes: [SKILL, AGENT_DEFINITION],
        removed: [{ objectType: SKILL, primaryKey: "removable-skill" }],
      },
    });
    await expect(fs.stat(dir)).rejects.toThrow();
  });

  it("restores the package directory if cleaning agent references fails", async () => {
    const dir = await installDomainSkill("delete-failed-skill");
    mocks.filterReadableAgentDefinitions.mockResolvedValue(new Set());
    const failure = new Error("Reference update failed");
    mocks.removeAnalysisAgentSkillReferences.mockRejectedValue(failure);
    await expect(deleteOp.execute(host, { kind: "object", objectType: SKILL, primaryKey: "delete-failed-skill" }))
      .rejects.toBe(failure);
    await expect(fs.readFile(path.join(dir, "SKILL.md"), "utf8")).resolves.toContain("name: delete-failed-skill");
  });

  it("refuses deletion without change permission or for read-only public/provider packages", async () => {
    const domainSkill = await installDomainSkill("protected-check");
    const pubDir = path.join(publicSkillsRoot, "builtin-skill");
    await fs.mkdir(pubDir, { recursive: true });
    await fs.writeFile(path.join(pubDir, "SKILL.md"), "---\nname: builtin-skill\ndescription: Builtin\n---\n");

    refused = skillLibraryChange.id;
    const target = { kind: "object" as const, objectType: SKILL, primaryKey: "protected-check" };
    await expect(deleteOp.inspectImpact.inspect(host, [{ target, input: {} }]))
      .rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    await expect(deleteOp.unavailable(host, target)).resolves.toHaveProperty("reason");
    expect(await deleteOp.execute(host, target)).toEqual({
      kind: "refusal",
      code: "PERMISSION_DENIED",
      message: "Skill operation denied",
    });
    await expect(fs.stat(domainSkill)).resolves.toBeDefined();
    refused = undefined;

    const zhHost: PanelOperationHost = {
      ...host,
      locale: "zh-CN",
      executor: { owner: actor.owner, credentials: { token: "op-token", locale: "zh-CN" } },
    };

    expect(await deleteOp.unavailable!(zhHost, { kind: "object", objectType: SKILL, primaryKey: "protected-check" })).toBeUndefined();
    expect(await deleteOp.unavailable!(zhHost, { kind: "object", objectType: SKILL, primaryKey: "builtin-skill" })).toEqual({
      reason: "内置技能随产品提供，不能删除",
    });
    expect(await deleteOp.unavailable!(zhHost, { kind: "object", objectType: SKILL, primaryKey: "knowledge-governance" })).toEqual({
      reason: "内置技能随产品提供，不能删除",
    });
    expect(await deleteOp.unavailable!(host, { kind: "object", objectType: SKILL, primaryKey: "missing-skill" })).toBeUndefined();

    for (const primaryKey of ["builtin-skill", "knowledge-governance", "ops-diagnosis"]) {
      expect(await deleteOp.execute(
        zhHost,
        { kind: "object", objectType: SKILL, primaryKey },
      )).toEqual({
        kind: "refusal",
        code: "PUBLIC_SKILL_READ_ONLY",
        message: "内置技能随产品提供，不能删除",
      });
    }

    expect(await deleteOp.execute(
      host,
      { kind: "object", objectType: SKILL, primaryKey: "missing-skill" },
    )).toEqual({
      kind: "refusal",
      code: "SKILL_NOT_FOUND",
      message: "Skill not found",
    });
  });

  describe("skills.import", () => {
    const zip = (name: string, body = "Body", files: Record<string, string> = {}) => {
      const archive = new AdmZip();
      archive.addFile(`${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: Imported\n---\n${body}\n`));
      for (const [file, content] of Object.entries(files)) archive.addFile(`${name}/${file}`, Buffer.from(content));
      const bytes = archive.toBuffer();
      return { name: `${name}.zip`, mime: "application/zip", size: bytes.length, bytes };
    };
    const call = (file: ReturnType<typeof zip>, overwrite?: boolean) => ({ file, ...(overwrite !== undefined && { overwrite }) });

    it("takes a staged skill ZIP of at most 20 MB and acts on no selected skill", () => {
      expect(importOp).toMatchObject({
        kind: "action", effect: "write", batch: false, targetType: SKILL,
        upload: { input: "file", accept: [{ mime: "application/zip", extension: ".zip" }], maxBytes: 20 * 1024 * 1024 },
      });
      expect("targetInput" in importOp).toBe(false);
      expect(importOp.targetSchema.safeParse(null).success).toBe(true);
      expect(importOp.inputSchema.safeParse({ file: { kind: "upload", uploadId: "00000000-0000-4000-8000-000000000001" } }).success).toBe(true);
      expect(importOp.inputSchema.safeParse({ file: { uploadId: "00000000-0000-4000-8000-000000000001" } }).success).toBe(false);
    });

    it("imports a new skill, refuses an existing name with its id, and overwrites only after the named confirmation", async () => {
      refused = skillLibraryRead.id;
      const first = zip("imported-skill", "Body", { "references/old.md": "Old reference" });
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: call(first, true) }])).toBeNull();
      expect(await importOp.execute(host, null, call(first))).toEqual({
        kind: "success", message: "Imported skill imported-skill.", data: { id: "imported-skill", title: "imported-skill" },
        affected: { objects: [{ objectType: SKILL, primaryKey: "imported-skill" }], objectTypes: [SKILL] },
      });

      const second = zip("imported-skill", "Revised");
      expect(await importOp.execute(host, null, call(second))).toEqual({
        kind: "refusal", code: "SKILL_EXISTS", message: "A skill named imported-skill already exists.", details: { skillId: "imported-skill" },
      });
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: call(second) }])).toBeNull();
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: call(second, true) }])).toEqual({
        summary: "This replaces the existing skill imported-skill with the uploaded package.",
        objects: [{ target: { objectType: SKILL, primaryKey: "imported-skill" }, label: "imported-skill" }],
        total: 1,
      });
      expect(await importOp.execute(host, null, call(second, true))).toMatchObject({ kind: "success" });
      const installed = path.join(root, "data", "domain-skills", domain, "imported-skill", "SKILL.md");
      expect(await fs.readFile(installed, "utf8")).toContain("Revised");
      await expect(fs.stat(path.join(path.dirname(installed), "references", "old.md"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("refuses to overwrite generated and file-backed platform skills with a same-named upload", async () => {
      for (const name of ["knowledge-governance", "ontomato-page-operator"]) {
        const uploaded = zip(name, "Replacement");
        expect(await importOp.execute(host, null, call(uploaded, true))).toEqual({
          kind: "refusal",
          code: "PUBLIC_SKILL_READ_ONLY",
          message: "Built-in skills come with the product and cannot be deleted",
        });
      }
    });

    it("refuses an unreadable package and an import without permission", async () => {
      const broken = { name: "broken.zip", mime: "application/zip", size: 3, bytes: Buffer.from("zip") };
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: { file: broken, overwrite: true } }])).toBeNull();
      expect(await importOp.execute(host, null, { file: broken })).toEqual({
        kind: "refusal", code: "INVALID_SKILL_PACKAGE", message: "This file is not a valid skill package: Cannot read skill ZIP",
      });
      refused = skillLibraryChange.id;
      const uploaded = zip("denied-skill");
      for (const overwrite of [false, true]) {
        await expect(importOp.inspectImpact.inspect(host, [{ target: null, input: call(uploaded, overwrite) }]))
          .rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
      }
      expect(await importOp.execute(host, null, call(uploaded))).toEqual({
        kind: "refusal", code: "PERMISSION_DENIED", message: "Skill operation denied",
      });
    });
  });
});
