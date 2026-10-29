import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { readSkillPackage } from "../../../core/skills/package";
import { standardSkillFrontmatterSchema } from "@ontomato/contracts/agent-runtime-skills";
import { parse } from "yaml";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "domain-skills-contract-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.resolve("skills") });
const { skillManager } = await import("../skill-manager");
const { prepareAssistantSkills } = await import("../../assistant/skills");
const { skillRegistryManager } = await import("../../../core/skills/registry/manager");
const domain = "contract-domain";
const reference = { namespace: { kind: "domain" as const, domainId: domain }, name: "sample-skill" };
const files = {
  "SKILL.md": "---\r\nname: sample-skill\r\ndescription: A portable sample\r\nlicense: MIT\r\nmetadata:\r\n  author: example\r\n---\r\nRun scripts/main.mjs.\r\n",
  "scripts/main.mjs": "console.log('原始版本');\n",
  "references/guide.md": "# Shared method\n\nKeep this reference intact.\n",
};
const zip = () => {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(files)) archive.addFile(name, Buffer.from(content));
  return archive.toBuffer();
};
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("round-trips a standard package byte-for-byte and preserves its other files and metadata when editing", async () => {
  const imported = await skillManager.importSkill(domain, zip());
  expect(imported.skill).toEqual(reference);
  expect(imported.type).toBe("executable");
  const exported = new AdmZip(await skillManager.exportSkill(domain, reference.name));
  for (const [name, content] of Object.entries(files)) expect(exported.readFile(name)).toEqual(Buffer.from(content));
  await skillManager.updateSkill(domain, reference.name, { scriptCode: "console.log('新版');\n", title: "New title" });
  const updated = new AdmZip(await skillManager.exportSkill(domain, reference.name));
  expect(updated.readAsText("scripts/main.mjs")).toBe("console.log('新版');\n");
  expect(updated.readAsText("references/guide.md")).toBe(files["references/guide.md"]);
  const front = parse(updated.readAsText("SKILL.md").split("---")[1]);
  expect(standardSkillFrontmatterSchema.parse(front)).toMatchObject({ license: "MIT", metadata: { author: "example", "ontomato.title": "New title" } });
});

it("publishes only the selected current-domain package and keeps captured versions unchanged across edits", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const published: Array<{ skill: unknown; files: { path: string; content: string }[] }> = [];
  const digest = (files: { path: string; content: string }[]) => createHash("sha256").update(JSON.stringify([...files].sort((a,b) => a.path < b.path ? -1 : 1).map((f) => [f.path,f.content]))).digest("hex");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    expect(new Headers(init.headers).get("x-domain-id")).toBe(domain);
    const body = JSON.parse(String(init.body));
    published.push(body);
    return Response.json({ skill: body.skill, digest: digest(body.files), description: "A portable sample" }, { status: 201 });
  }));
  await skillManager.importSkill(domain, zip(), true);
  const provider = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "assistant-report" };
  const analyst = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "ontomato-analyst" };
  expect(await prepareAssistantSkills(domain, [analyst, provider, reference])).toEqual([analyst, provider, reference]);
  const oldDigest = digest(published[0].files);
  await skillManager.updateSkill(domain, reference.name, { scriptCode: "console.log('next run');\n" });
  await prepareAssistantSkills(domain, [reference]);
  expect(published.map((p) => p.skill)).toEqual([reference, reference]);
  expect(digest(published[0].files)).toBe(oldDigest);
  expect(digest(published[1].files)).not.toBe(oldDigest);
  await skillManager.toggleSkill(domain, reference.name);
  expect(await prepareAssistantSkills(domain, [provider, reference])).toEqual([provider]);
  expect(await prepareAssistantSkills(domain, [provider])).toEqual([provider]);
  expect(published).toHaveLength(2);
  await expect(prepareAssistantSkills("another-domain", [reference])).rejects.toThrow();
});

it("publishes every bundled public directory with the same standard package contract", async () => {
  const skills = await skillRegistryManager.publicSkills();
  expect(skills.length).toBeGreaterThan(0);
  for (const skill of skills) {
    const request = await readSkillPackage(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
    expect(request.files.some((file) => file.path === "scripts/index.mjs")).toBe(true);
  }
});
