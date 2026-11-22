import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { AGENT_DEFINITION, DELETE_SKILL, IMPORT_SKILL, SKILL } from "@ontomato/contracts/panel-client-requests";
import { installContentLayout } from "../../../content/layout";
import { registerSkillProvider } from "../../../core/skills/providers";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const mocks = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  filterReadableAgentDefinitions: vi.fn(),
  listAnalysisAgentSkillReferences: vi.fn(),
  removeAnalysisAgentSkillReferences: vi.fn(),
  restoreAnalysisAgentSkillReferences: vi.fn(),
}));

vi.mock("../../../identity/installed", () => ({
  assertPermission: mocks.assertPermission,
}));
vi.mock("../../assistant/definitions", () => ({
  filterReadableAgentDefinitions: mocks.filterReadableAgentDefinitions,
}));
vi.mock("../../assistant/skill-references", () => ({
  listAnalysisAgentSkillReferences: mocks.listAnalysisAgentSkillReferences,
  removeAnalysisAgentSkillReferences: mocks.removeAnalysisAgentSkillReferences,
  restoreAnalysisAgentSkillReferences: mocks.restoreAnalysisAgentSkillReferences,
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

registerSkillProvider({
  id: "provider-demo",
  name: "Demo Studio",
  async list(context) {
    return [
      {
        skill: { namespace: { kind: "domain", domainId: context.domainId }, name: "studio-skill" },
        manifest: { name: "studio-skill", description: "Provided skill" },
        async provide() {
          return {
            skill: { namespace: { kind: "domain" as const, domainId: context.domainId }, name: "studio-skill" },
            files: [{ path: "SKILL.md", content: "---\nname: studio-skill\ndescription: Provided skill\n---\n" }],
          };
        },
      },
    ];
  },
});

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

beforeEach(() => {
  mocks.assertPermission.mockReset().mockResolvedValue(undefined);
  mocks.filterReadableAgentDefinitions.mockReset();
  mocks.listAnalysisAgentSkillReferences.mockReset().mockResolvedValue([]);
  mocks.removeAnalysisAgentSkillReferences.mockReset().mockResolvedValue(0);
  mocks.restoreAnalysisAgentSkillReferences.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    await installDomainSkill("custom-skill");
    const agent1 = "11111111-1111-4111-8111-111111111111";
    const agent2 = "22222222-2222-4222-8222-222222222222";
    mocks.listAnalysisAgentSkillReferences.mockResolvedValue([
      { id: agent1, name: "Readable agent", usesAnalysis: true, usesVisualization: false },
      { id: agent2, name: "Hidden agent", usesAnalysis: true, usesVisualization: false },
    ]);
    mocks.filterReadableAgentDefinitions.mockResolvedValue(new Set([agent1]));

    const target = { kind: "object" as const, objectType: SKILL, primaryKey: "custom-skill" };
    expect(await deleteOp.targetLabel(host, target)).toBe("custom-skill");
    expect(await deleteOp.inspectImpact!.inspect(host, [{ target, input: {} }])).toEqual({
      summary: "This deletes the selected skill and removes its references from 1 agent(s).",
      objects: [{ target: { objectType: AGENT_DEFINITION, primaryKey: agent1 }, label: "Readable agent" }],
      total: 1,
    });
    expect(mocks.filterReadableAgentDefinitions).toHaveBeenCalledWith(actor.owner, actor.credentials, [agent1, agent2]);
  });

  it("deletes a writable domain skill and returns affected skill and readable agents", async () => {
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

    expect(mocks.assertPermission).toHaveBeenCalledWith(actor.credentials, ["skill-management"]);
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

  it("refuses deletion without skill-management permission or for read-only public/provider packages", async () => {
    await installDomainSkill("protected-check");
    const pubDir = path.join(publicSkillsRoot, "builtin-skill");
    await fs.mkdir(pubDir, { recursive: true });
    await fs.writeFile(path.join(pubDir, "SKILL.md"), "---\nname: builtin-skill\ndescription: Builtin\n---\n");

    mocks.assertPermission.mockRejectedValueOnce(new HttpError(403, "Missing skill-management permission", "PERMISSION_DENIED"));
    expect(await deleteOp.execute(
      host,
      { kind: "object", objectType: SKILL, primaryKey: "protected-check" },
    )).toEqual({
      kind: "refusal",
      code: "PERMISSION_DENIED",
      message: "Missing skill-management permission",
    });

    const zhHost: PanelOperationHost = {
      ...host,
      locale: "zh-CN",
      executor: { owner: actor.owner, credentials: { token: "op-token", locale: "zh-CN" } },
    };

    expect(await deleteOp.execute(
      zhHost,
      { kind: "object", objectType: SKILL, primaryKey: "builtin-skill" },
    )).toEqual({
      kind: "refusal",
      code: "PUBLIC_SKILL_READ_ONLY",
      message: "内置技能随产品提供，不能删除",
    });

    expect(await deleteOp.execute(
      zhHost,
      { kind: "object", objectType: SKILL, primaryKey: "studio-skill" },
    )).toEqual({
      kind: "refusal",
      code: "SKILL_PROVIDER_READ_ONLY",
      message: "由 Demo Studio 提供，不能在这里删除",
    });

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
    const zip = (name: string, body = "Body") => {
      const archive = new AdmZip();
      archive.addFile(`${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: Imported\n---\n${body}\n`));
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
      const first = zip("imported-skill");
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: call(first, true) }])).toBeNull();
      expect(await importOp.execute(host, null, call(first))).toEqual({
        kind: "success", message: "Imported skill imported-skill.", data: { id: "imported-skill", title: "imported-skill" },
        affected: { objects: [{ objectType: SKILL, primaryKey: "imported-skill" }], objectTypes: [SKILL] },
      });
      expect(mocks.assertPermission).toHaveBeenCalledWith(actor.credentials, ["skill-management"]);

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
    });

    it("refuses an unreadable package and an import without permission", async () => {
      const broken = { name: "broken.zip", mime: "application/zip", size: 3, bytes: Buffer.from("zip") };
      expect(await importOp.inspectImpact!.inspect(host, [{ target: null, input: { file: broken, overwrite: true } }])).toBeNull();
      expect(await importOp.execute(host, null, { file: broken })).toEqual({
        kind: "refusal", code: "INVALID_SKILL_PACKAGE", message: "This file is not a valid skill package: Cannot read skill ZIP",
      });
      mocks.assertPermission.mockRejectedValueOnce(new HttpError(403, "Missing skill-management permission", "PERMISSION_DENIED"));
      expect(await importOp.execute(host, null, call(zip("denied-skill")))).toEqual({
        kind: "refusal", code: "PERMISSION_DENIED", message: "Missing skill-management permission",
      });
    });
  });
});
