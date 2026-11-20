import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { readSkillPackage } from "../../../core/skills/package";
import { standardSkillFrontmatterSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { parse } from "yaml";
import type { ProtectedSkillOffering } from "../../../core/skills/providers";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const referenceQuery = vi.hoisted(() => vi.fn());
vi.mock("../../../infrastructure/postgres", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: referenceQuery }),
}));

configureI18n({ defaultLocale: "en", packs: { en: { messages: en, ...enLocaleMeta } },
  languageSwitchEnabled: false, appTextLocale: "en" });

const root = await fs.mkdtemp(path.join(os.tmpdir(), "domain-skills-contract-"));
installContentLayout({ runtimeRoot: root, prompts: [], runtimeResources: [], publicSkillsRoot: path.resolve("skills") });
const { skillManager } = await import("../skill-manager");
const { assistantSkillCatalog, hasHiddenAssistantSkillRefs, loadedPageSkillVersion, resolveCurrentPageSkillMember, pageSkillMemberContext, prepareAssistantSkills, readAssistantSkillView, validateAssistantSkills, visibleAssistantSkillRefs } = await import("../../assistant/skills");
const { skillRegistryManager } = await import("../../../core/skills/registry/manager");
const { registerSkillProvider, protectedSkillRef } = await import("../../../core/skills/providers");
const domain = "contract-domain";
const credentials = { token: "initiator", locale: "en" };
const referenceAccess = { credentials, readableAgentIds: async () => new Set<string>() };
const reference = { namespace: { kind: "domain" as const, domainId: domain }, name: "sample-skill" };
const files = {
  "SKILL.md": "---\r\nname: sample-skill\r\ndescription: A portable sample\r\nlicense: MIT\r\nmetadata:\r\n  author: example\r\n---\r\nRun scripts/main.mjs.\r\n",
  "scripts/main.mjs": "console.log('原始版本');\n",
  "references/guide.md": "# Shared method\n\nKeep this reference intact.\n",
};
const zip = (changes: Record<string, string> = {}) => {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries({ ...files, ...changes })) archive.addFile(name, Buffer.from(content));
  return archive.toBuffer();
};
const skillMarkdown = (name: string) => `---\nname: ${name}\ndescription: Panel-provided skill\n---\nRun scripts/main.mjs.\n`;
type Offering = {
  skill: RuntimeSkillRef;
  manifest: { name: string; description: string };
  provide: () => Promise<{ skill: RuntimeSkillRef; files: { path: string; content: string }[] }>;
};
let panelOfferings: Offering[] = [];
let protectedPanelOfferings: ProtectedSkillOffering[] = [];
let conflictOfferings: Offering[] = [];
let panelCalls: string[] = [];
let panelListError: Error | null = null;
const panelProvider = {
  id: "panel-test", name: "Test panels",
  async list() { if (panelListError) throw panelListError; return panelOfferings; },
};
const conflictProvider = { id: "conflict-test", name: "Conflicting source", async list() { return conflictOfferings; } };
registerSkillProvider(panelProvider);
registerSkillProvider({ id: "product-panels", name: "Product panels", async list() { return protectedPanelOfferings; } });
registerSkillProvider(conflictProvider);
function offering(name: string, options: { domainId?: string; script?: string; packageName?: string;
  provideError?: Error; namespace?: RuntimeSkillRef["namespace"] } = {}): Offering {
  const skill: RuntimeSkillRef = { namespace: options.namespace ?? { kind: "domain", domainId: options.domainId ?? domain }, name };
  const packageSkill = { ...skill, name: options.packageName ?? name };
  return { skill, manifest: { name, description: "Panel-provided skill" }, provide: async () => {
    panelCalls.push(name);
    if (options.provideError) throw options.provideError;
    return { skill: packageSkill, files: [
      { path: "SKILL.md", content: skillMarkdown(name) },
      { path: "scripts/main.mjs", content: options.script ?? "console.log('panel');\n" },
    ] };
  } };
}
const panelSkill = (name = "panel-skill") => offering(name);
const panelReference = (name = "panel-skill"): RuntimeSkillRef => ({ namespace: { kind: "domain", domainId: domain }, name });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
const pageDirectory = () => Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } });
beforeEach(() => {
  panelOfferings = []; protectedPanelOfferings = []; conflictOfferings = []; panelCalls = []; panelListError = null;
  vi.stubGlobal("fetch", vi.fn(async () => pageDirectory()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("round-trips a standard package byte-for-byte and lists and reads its files", async () => {
  const imported = await skillManager.importSkill(domain, zip(), credentials);
  expect(imported.skill).toEqual(reference);
  expect(imported.title).toBe(reference.name);
  expect(imported.writeRestriction).toBeNull();
  const exported = new AdmZip(await skillManager.exportSkill(domain, reference.name, credentials));
  for (const [name, content] of Object.entries(files)) expect(exported.readFile(name)).toEqual(Buffer.from(content));
  const front = parse(exported.readAsText("SKILL.md").split("---")[1]);
  expect(standardSkillFrontmatterSchema.parse(front)).toMatchObject({ license: "MIT", metadata: { author: "example" } });
  expect(await skillManager.listSkillFiles(domain, reference.name, credentials)).toEqual(Object.keys(files).sort()
    .map((name) => ({ path: name, size: Buffer.byteLength(files[name as keyof typeof files]) })));
  expect(await skillManager.readSkillFile(domain, reference.name, "references/guide.md", credentials)).toBe(files["references/guide.md"]);
});

it("keeps an older package's ontomato.* metadata in the package and reads none of it", async () => {
  const older = "---\nname: sample-skill\ndescription: A portable sample\nmetadata:\n  ontomato.title: Old title\n  ontomato.category: visualization\n  ontomato.tags: not json\n---\nRun scripts/main.mjs.\n";
  const imported = await skillManager.importSkill(domain, zip({ "SKILL.md": older }), credentials, true);
  expect(imported).toMatchObject({ title: reference.name, description: "A portable sample" });
  const exported = new AdmZip(await skillManager.exportSkill(domain, reference.name, credentials));
  expect(exported.readAsText("SKILL.md")).toBe(older);
});

it("reads only files inside the package", async () => {
  await skillManager.importSkill(domain, zip(), credentials, true);
  for (const outside of ["../sample-skill/SKILL.md", "/etc/hosts", "scripts/../../x"])
    await expect(skillManager.readSkillFile(domain, reference.name, outside, credentials)).rejects.toMatchObject({ status: 400 });
});

it("lists and reads a provider package on demand, with no source path and one write restriction", async () => {
  await skillManager.importSkill(domain, zip(), credentials, true);
  panelOfferings = [panelSkill()];
  const infos = await skillManager.getAllSkills(domain, credentials);
  const info = infos.find((entry) => entry.id === "panel-skill")!;
  expect(info).toMatchObject({ isPublic: false, writeRestriction: { kind: "provider", providerId: "panel-test", providerName: "Test panels" } });
  expect(info.path).toBeUndefined();
  expect(infos.find((entry) => entry.id === reference.name)).toMatchObject({ writeRestriction: null, isPublic: false });
  expect(infos.find((entry) => entry.id === "network-graph")).toMatchObject({ writeRestriction: { kind: "public" }, isPublic: true });
  // Listing only asks for metadata; each read asks the provider for its current package.
  expect(panelCalls).toEqual([]);
  expect(await skillManager.listSkillFiles(domain, "panel-skill", credentials)).toEqual([
    { path: "SKILL.md", size: Buffer.byteLength(skillMarkdown("panel-skill")) },
    { path: "scripts/main.mjs", size: Buffer.byteLength("console.log('panel');\n") },
  ]);
  expect(await skillManager.readSkillFile(domain, "panel-skill", "scripts/main.mjs", credentials)).toBe("console.log('panel');\n");
  const exported = new AdmZip(await skillManager.exportSkill(domain, "panel-skill", credentials));
  expect(exported.readAsText("SKILL.md")).toBe(skillMarkdown("panel-skill"));
});

it("publishes the selected provider's current package and never provides an unselected one", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const published: Array<{ skill: RuntimeSkillRef; files: { path: string; content: string }[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } });
    const body = JSON.parse(String(init.body));
    published.push(body);
    return Response.json({ skill: body.skill, digest: "a".repeat(64), description: "Panel-provided skill" }, { status: 201 });
  }));
  panelOfferings = [panelSkill(), offering("unused-panel-skill", { provideError: new Error("must not be provided") })];
  await prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {});
  expect(published.map((entry) => entry.skill)).toEqual([panelReference()]);
  expect(panelCalls).toEqual(["panel-skill"]);
  panelOfferings = [offering("panel-skill", { script: "console.log('current');\n" })];
  await prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {});
  expect(published).toHaveLength(2);
  expect(published[1]!.files.find((file) => file.path === "scripts/main.mjs")?.content).toBe("console.log('current');\n");
  panelOfferings = [offering("panel-skill", { provideError: new Error("cannot supply the selected package") })];
  await expect(prepareAssistantSkills(domain, { kind: "custom", skills: [panelReference()] }, {}))
    .rejects.toThrow(/panel-test.*cannot supply the selected package/);
});

it("derives the same standard domain ref as the three-field identity contract", () => {
  expect(protectedSkillRef("product-panels", domain, "panel-a")).toEqual(panelReference("pvt-bc772a7e3a43e526b266e5b4d409af7f1856edadb2fd6995"));
});

it("admits protected packages only through the initiator's exact entrance and every dependency", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const entrance = { permissionCode: "panel-menu", pageKey: "real-use" };
  const source = { kind: "application-use", applicationId: "app-test", useId: "primary" } as const;
  const old = panelReference("panel-menu-panel-menu-123456789012345678901234");
  const protectedRef = protectedSkillRef("product-panels", domain, "panel-a");
  const readManifest = vi.fn(async (ref: RuntimeSkillRef) => ({ name: ref.name, description: "Protected member" }));
  const provide = vi.fn(async (ref: RuntimeSkillRef) => ({
    skill: ref, files: [{ path: "SKILL.md", content: skillMarkdown(ref.name) }],
  }));
  protectedPanelOfferings = [{
    kind: "protected", sourceKey: "panel-a", entrances: [entrance],
    resourceIds: ["panel-a", "projection-a"], readManifest, provide,
  }];
  let admittedEntrance = { ...entrance, pageKey: "sibling-use" };
  let ids = ["panel-a", "projection-a"];
  const upstream = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (url.endsWith("/platform/page-skills"))
      return Response.json({ success: true, data: {
        pageSkills: [{ permissionCode: entrance.permissionCode }], registeredSkills: [], admittedEntrances: [admittedEntrance],
      } });
    if (url.endsWith("/product-governance/resources")) {
      expect(new Headers(init.headers).get("tk")).toBe(credentials.token);
      expect(JSON.parse(String(init.body))).toEqual({ verb: "use" });
      return Response.json({ ids });
    }
    if (url.endsWith("/platform/applications/app-test/panel-uses"))
      return Response.json({ success: true, data: {
        applicationId: source.applicationId, entry: { path: "/applications/app-test", renderer: "panels" },
        panelUses: [{ id: source.useId, pageKey: entrance.pageKey, panelId: "panel-a",
          path: "/applications/app-test/panel", access: { permissionCode: entrance.permissionCode } }],
      } });
    return Response.json({ skill: protectedRef, digest: "b".repeat(64), description: "Protected member" });
  });
  vi.stubGlobal("fetch", upstream);

  let view = await readAssistantSkillView(domain, credentials);
  expect(view.pageSkills[0].skills).toEqual([]);
  expect(hasHiddenAssistantSkillRefs([protectedRef], view)).toBe(true);
  expect(hasHiddenAssistantSkillRefs([old], view)).toBe(false);
  expect(readManifest).not.toHaveBeenCalled();

  admittedEntrance = entrance;
  view = await readAssistantSkillView(domain, credentials);
  expect(visibleAssistantSkillRefs([old, protectedRef], view)).toEqual([protectedRef]);
  expect(hasHiddenAssistantSkillRefs([old], view)).toBe(false);
  const member = { source, memberPath: [], ref: protectedRef };
  const context = { mode: "member" as const, locator: entrance, member };
  const actualPage = { entrance, member, path: "/applications/app-test/panel" };
  await expect(pageSkillMemberContext(view, entrance, source, { id: "panel-a" })).resolves.toEqual(context);
  await expect(resolveCurrentPageSkillMember(view, entrance, { ...member, ref: { ...protectedRef,
    namespace: { kind: "domain", domainId: "unrelated-domain" } } })).resolves.toBeNull();
  await expect(resolveCurrentPageSkillMember(view, entrance, { ...member, memberPath: [{ member: "sibling" }] })).resolves.toBeNull();
  await expect(resolveCurrentPageSkillMember(view, entrance, { ...member, source: { ...source, useId: "missing" } })).resolves.toBeNull();
  await expect(pageSkillMemberContext(view, entrance, source, { id: "old-panel" })).resolves.toEqual({
    mode: "member", locator: entrance, member: null,
  });
  expect(provide).not.toHaveBeenCalled();
  await expect(prepareAssistantSkills(domain, { kind: "custom", skills: [old] }, credentials, context))
    .resolves.toEqual({ skills: [], pageDrafts: false, currentPage: null });
  const prepared = await prepareAssistantSkills(domain, { kind: "regular", skills: [old] }, credentials, context);
  expect(prepared).toEqual({ skills: [{ skill: protectedRef, digest: "b".repeat(64) }], pageDrafts: true, currentPage: actualPage });
  expect(loadedPageSkillVersion(protectedRef, prepared.skills)).toEqual(prepared.skills[0]);
  expect(loadedPageSkillVersion(protectedSkillRef("product-panels", domain, "panel-b"), prepared.skills)).toBeNull();

  referenceQuery.mockResolvedValueOnce({ rows: [
    { id: "readable", name: "Readable agent" },
    { id: "hidden", name: "Hidden agent" },
  ] });
  const readableAgentIds = vi.fn(async () => new Set(["readable"]));
  await expect(skillManager.getSkillReferences(domain, protectedRef.name, { credentials, readableAgentIds }))
    .resolves.toEqual([{ id: "readable", name: "Readable agent", usesAnalysis: true, usesVisualization: false }]);
  expect(readableAgentIds).toHaveBeenCalledWith(["readable", "hidden"]);

  ids = ["projection-a"];
  expect((await readAssistantSkillView(domain, credentials)).hasSkill(protectedRef)).toBe(false);
  ids = ["panel-a"];
  readManifest.mockClear(); provide.mockClear();
  await expect(skillManager.exportSkill(domain, protectedRef.name, credentials))
    .rejects.toMatchObject({ status: 404, code: "SKILL_NOT_FOUND" });
  await expect(skillManager.deleteSkill(domain, protectedRef.name, referenceAccess))
    .rejects.toMatchObject({ status: 404, code: "SKILL_NOT_FOUND" });
  await expect(skillManager.getSkillReferences(domain, protectedRef.name, referenceAccess))
    .rejects.toMatchObject({ status: 404, code: "SKILL_NOT_FOUND" });
  await expect(validateAssistantSkills(domain, [protectedRef], credentials))
    .rejects.toMatchObject({ code: "SKILL_NOT_FOUND", message: "Skill is not in this domain's catalogue" });
  await expect(prepareAssistantSkills(domain, { kind: "regular", skills: [old] }, credentials))
    .resolves.toEqual({ skills: [], pageDrafts: false, currentPage: null });
  expect(readManifest).not.toHaveBeenCalled();
  expect(provide).not.toHaveBeenCalled();

  protectedPanelOfferings = [];
  view = await readAssistantSkillView(domain, credentials);
  expect(visibleAssistantSkillRefs([old, protectedRef], view)).toEqual([]);
  expect(hasHiddenAssistantSkillRefs([old, protectedRef], view)).toBe(false);
  const imported = new AdmZip();
  imported.addFile("SKILL.md", Buffer.from(skillMarkdown(protectedRef.name)));
  upstream.mockClear();
  await expect(skillManager.importSkill(domain, imported.toBuffer(), credentials, true))
    .rejects.toMatchObject({ code: "INVALID_SKILL_PACKAGE" });
  expect(upstream).not.toHaveBeenCalled();
});

it("publishes one member across admitted entrances alongside the native permission-group skill", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const native = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" } as const;
  const entrances = ["knowledge", "alternate"].map(pageKey => ({ permissionCode: "business-knowledge", pageKey }));
  const ref = protectedSkillRef("product-panels", domain, "knowledge-panel");
  const sourceFor = (pageKey: string) => ({ kind: "application-use" as const, applicationId: "ontology", useId: pageKey });
  const offer = offering(ref.name);
  protectedPanelOfferings = [{ kind: "protected", sourceKey: "knowledge-panel", entrances, resourceIds: ["knowledge-panel"],
    readManifest: async () => offer.manifest, provide: offer.provide }];
  const published: RuntimeSkillRef[] = [];
  const grants = vi.fn(() => Response.json({ ids: ["knowledge-panel"] }));
  const uses = vi.fn(() => Response.json({ success: true, data: {
    applicationId: "ontology", entry: { path: "/ontology", renderer: "ontology" },
    panelUses: entrances.map(({ permissionCode, pageKey }) => ({ id: pageKey, pageKey, path: `/ontology/${pageKey}`,
      access: { permissionCode }, panelId: "knowledge-panel" })),
  } }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: {
      admittedEntrances: entrances, registeredSkills: [native], pageSkills: [{ permissionCode: "business-knowledge", skill: native,
        defaults: [{ pageKey: "governance-report", defaultAgent: { kind: "preset", agentKind: "knowledge-governance" } }] }],
    } });
    if (url.endsWith("/product-governance/resources")) return grants();
    if (url.endsWith("/ontology/panel-uses")) {
      expect(new Headers(init.headers).get("tk")).toBe(credentials.token);
      return uses();
    }
    if (url.endsWith("/ontology/ai/knowledge-governance/skill-package")) {
      published.push(native);
      return Response.json({ skill: native, digest: "a".repeat(64) });
    }
    const { skill } = JSON.parse(String(init.body));
    published.push(skill);
    return Response.json({ skill, digest: "c".repeat(64), description: "Published" });
  }));
  const [first, second] = entrances;
  const member = { source: sourceFor(second.pageKey), ref, memberPath: [] };
  const view = await readAssistantSkillView(domain, credentials);
  expect(view.pageSkills[0]).toMatchObject({ skills: [native, ref],
    defaults: [{ pageKey: "governance-report", defaultAgent: { kind: "preset", agentKind: "knowledge-governance" } }] });
  await expect(resolveCurrentPageSkillMember(view, first, member)).resolves.toBeNull();
  await expect(resolveCurrentPageSkillMember(view, first, { ...member, source: sourceFor(first.pageKey) }))
    .resolves.toMatchObject({ member: { ref }, path: "/ontology/knowledge" });
  const prepared = await prepareAssistantSkills(domain, { kind: "regular", skills: [] }, credentials,
    { mode: "member", locator: second, member });
  expect(prepared.currentPage).toEqual({ entrance: second, member, path: "/ontology/alternate" });
  expect(published).toEqual([native, ref]);
  grants.mockReturnValueOnce(Response.json({ unexpected: "source failure" }));
  await expect(readAssistantSkillView(domain, credentials)).rejects.toMatchObject({ code: "PRODUCT_GOVERNANCE_UNAVAILABLE" });
  uses.mockReturnValueOnce(Response.json({ success: false }));
  await expect(resolveCurrentPageSkillMember(view, second, member)).rejects.toThrow();
});

it("fails the whole catalogue when a provider cannot list, and all preparation with it", async () => {
  panelListError = new Error("panel source unavailable");
  let listFailure: Error | undefined;
  try { await skillManager.getAllSkills(domain, credentials); }
  catch (error) { listFailure = error as Error; }
  expect(listFailure?.message).toContain('Skill provider "Test panels" (panel-test) failed to list skills');
  expect((listFailure as Error & { cause?: unknown }).cause).toBe(panelListError);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, data: { pageSkills: [], registeredSkills: [] } })));
  await expect(prepareAssistantSkills(domain, { kind: "custom", skills: [] }, {}))
    .rejects.toMatchObject({ code: "SKILL_SOURCE_UNAVAILABLE", cause: panelListError });
});

it("fails a page-mapped skill that no source supplies instead of reusing its runtime package", async () => {
  const missing = { namespace: { kind: "provider" as const, provider: "panel-test" }, name: "missing-panel-skill" };
  const published: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.endsWith("/platform/page-skills")) return Response.json({ success: true, data: {
      pageSkills: [{ permissionCode: "business-knowledge", skill: missing }], registeredSkills: [missing] } });
    published.push(JSON.parse(String(init?.body)));
    return Response.json({ skill: missing, digest: "a".repeat(64), description: "Missing" }, { status: 201 });
  }));
  await expect(prepareAssistantSkills(domain, { kind: "regular", skills: [] }, {}))
    .rejects.toMatchObject({ status: 422, code: "SKILL_NOT_FOUND" });
  expect(published).toEqual([]);
});

it("rejects a provider skill for another domain, a repeated manageable name, and a built-in identity takeover", async () => {
  panelOfferings = [offering("other-domain-skill", { domainId: "other-domain" })];
  await expect(skillManager.getAllSkills(domain, credentials)).rejects.toThrow(/other-domain\/other-domain-skill/);
  panelOfferings = [panelSkill()];
  conflictOfferings = [panelSkill("panel-skill")];
  await expect(skillManager.getAllSkills(domain, credentials)).rejects.toThrow(/conflict-test[\s\S]*panel-test/);
  const governance = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "knowledge-governance" };
  panelOfferings = [offering(governance.name, { namespace: governance.namespace })];
  await expect(assistantSkillCatalog(domain, credentials))
    .rejects.toThrow(/built-in skill/);
});

it("refuses to overwrite or delete provider content before touching a domain source or reference", async () => {
  panelOfferings = [panelSkill()];
  const providerZip = (() => {
    const archive = new AdmZip();
    archive.addFile("SKILL.md", Buffer.from(skillMarkdown("panel-skill")));
    return archive.toBuffer();
  })();
  await expect(skillManager.importSkill(domain, providerZip, credentials, true))
    .rejects.toMatchObject({ status: 403, code: "SKILL_PROVIDER_READ_ONLY" });
  await expect(fs.access(path.join(skillRegistryManager.getDomainSkillsRoot(domain), "panel-skill")))
    .rejects.toThrow();
  await expect(skillManager.deleteSkill(domain, "panel-skill", referenceAccess))
    .rejects.toMatchObject({ status: 403, code: "SKILL_PROVIDER_READ_ONLY" });
  expect((await skillManager.getAllSkills(domain, credentials)).find((entry) => entry.id === "panel-skill")?.writeRestriction)
    .toMatchObject({ kind: "provider", providerName: "Test panels" });
});

it("keeps public packages read-only while leaving their files and export readable", async () => {
  expect((await skillManager.listSkillFiles(domain, "network-graph", credentials)).length).toBeGreaterThan(0);
  await expect(skillManager.readSkillFile(domain, "network-graph", "SKILL.md", credentials)).resolves.toContain("---");
  const replacement = new AdmZip();
  replacement.addFile("SKILL.md", Buffer.from("---\nname: network-graph\ndescription: Replaced\n---\n"));
  await expect(skillManager.importSkill(domain, replacement.toBuffer(), credentials, true))
    .rejects.toMatchObject({ status: 403, code: "PUBLIC_SKILL_READ_ONLY" });
  await expect(skillManager.deleteSkill(domain, "network-graph", referenceAccess))
    .rejects.toMatchObject({ status: 403, code: "PUBLIC_SKILL_READ_ONLY" });
});

it("rejects a provided package whose identity differs from the offered skill", async () => {
  panelOfferings = [offering("panel-skill", { packageName: "other-skill" })];
  await expect(skillManager.listSkillFiles(domain, "panel-skill", credentials)).rejects.toThrow(/panel-test.*supplied/);
});

it("rejects a provided package whose SKILL.md declares another name", async () => {
  const offered = panelSkill();
  offered.provide = async () => ({ skill: offered.skill,
    files: [{ path: "SKILL.md", content: skillMarkdown("other-skill") }] });
  panelOfferings = [offered];
  await expect(skillManager.listSkillFiles(domain, "panel-skill", credentials)).rejects.toThrow(/panel-test.*SKILL.md must declare the package name/);
});

it("binds static and current-domain skills to the versions returned by their publishers", async () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "synthetic-host");
  const report: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };
  const analyst: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
  const published: Array<{ skill: RuntimeSkillRef; files: { path: string; content: string }[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (url.endsWith("/platform/page-skills")) return pageDirectory();
    if (url.endsWith("/platform/agent-channel/assistant-skill"))
      return Response.json({ skill: analyst, digest: "a".repeat(64) });
    const body = JSON.parse(String(init.body));
    published.push(body);
    if (body.skill.namespace.kind === "domain")
      expect(new Headers(init.headers).get("x-domain-id")).toBe(domain);
    return Response.json({ skill: body.skill, digest: published.length.toString().repeat(64), description: "Published" });
  }));
  await skillManager.importSkill(domain, zip(), credentials, true);
  const first = await prepareAssistantSkills(domain, { kind: "custom", skills: [analyst, report, reference] }, credentials);
  expect(first.skills).toEqual([
    { skill: analyst, digest: "a".repeat(64) },
    { skill: report, digest: "1".repeat(64) },
    { skill: reference, digest: "2".repeat(64) },
  ]);
  await skillManager.importSkill(domain, zip({ "scripts/main.mjs": "console.log('next run');\n" }), credentials, true);
  const second = await prepareAssistantSkills(domain, { kind: "custom", skills: [reference] }, credentials);
  expect(second.skills).toEqual([{ skill: reference, digest: "3".repeat(64) }]);
  expect(published.map(item => item.skill)).toEqual([report, reference, reference]);
  const script = (body: (typeof published)[number]) => body.files.find(file => file.path === "scripts/main.mjs")?.content;
  expect(script(published[1])).toBe(files["scripts/main.mjs"]);
  expect(script(published[2])).toBe("console.log('next run');\n");
  await expect(prepareAssistantSkills("another-domain", { kind: "custom", skills: [reference] }, credentials))
    .rejects.toMatchObject({ status: 422, code: "SKILL_NOT_FOUND" });
});

it("publishes every bundled public directory with the same standard package contract", async () => {
  const skills = await skillRegistryManager.publicSkills();
  expect(skills.length).toBeGreaterThan(0);
  for (const skill of skills) {
    const request = await readSkillPackage(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
    expect(request.files.some((file) => file.path === "SKILL.md")).toBe(true);
  }
});


it("network-graph CLI takes the runtime language only when the input omits it", async () => {
  const script = path.resolve("skills/executable/visualization/network-graph/scripts/index.mjs");
  for (const locale of [undefined, "ja"]) {
    const workspace = await fs.mkdtemp(path.join(root, "visualization-cli-"));
    const source = path.join(workspace, "input.json");
    await fs.writeFile(source, JSON.stringify({ title: "Locale contract", data: { nodes: [{ id: "a", name: "A" }], links: [] }, locale }));
    execFileSync(process.execPath, [script, source], {
      cwd: workspace,
      env: { ...process.env, ONTOMATO_LANGUAGE: "zh-CN", ONTOMATO_OUTPUT_DIR: path.join(workspace, "outputs") },
    });
    const [file] = await fs.readdir(path.join(workspace, "outputs"));
    const html = await fs.readFile(path.join(workspace, "outputs", file), "utf8");
    expect(html).toContain(`<html lang="${(locale ?? "zh-CN").split("-")[0]}"`);
  }
});
