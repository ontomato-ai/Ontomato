import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkillsProjection } from "@ontomato/contracts/page-skills";
import { assistantAgentsQuerySchema } from "@ontomato/contracts/page-skills";
import type { DomainSkillRegistryManager, SkillRegistryManager } from "../../../core/skills/registry/manager";
import type { AgentRow } from "../store";

type PageSkillRegistry = Pick<SkillRegistryManager, "getSkillByRef" | "failedManifests">;

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), agents: vi.fn(), native: vi.fn(), profile: vi.fn(),
  publishGovernance: vi.fn(), managed: [] as { skill: RuntimeSkillRef; title: string; description: string }[],
  grants: new Set<string>(),
}));
vi.mock("../../../utils/backend-client", () => ({ backendGet: mocks.get, backendPost: mocks.post,
  buildBackendHeaders: (token: string) => ({ tk: token }) }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../content/resources", () => ({ workbenchServerResourceRoot: "/resources" }));
vi.mock("../../../core/skills/manifest", () => ({
  readSkillMarkdown: () => ({ manifest: { description: "Skill" } }),
  InvalidSkillPackageError: class InvalidSkillPackageError extends Error {},
}));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {
  forDomain: async (...[, admit]: Parameters<DomainSkillRegistryManager["forDomain"]>): Promise<PageSkillRegistry> => {
    await admit?.([], []);
    return { getSkillByRef: () => null, failedManifests: new Map() };
  },
} }));
vi.mock("../../skills/skill-manager", () => ({ skillManager: { skillsInRegistry: () => mocks.managed } }));
vi.mock("../../agent-runtime/skills", () => ({
  workbenchBuiltinSkillRoot: () => "/resources",
  publishSkill: vi.fn(async (_root: string, skill: RuntimeSkillRef) => ({ skill, digest: "a".repeat(64) })),
  publishSkillPackage: vi.fn(),
}));
vi.mock("../../../i18n", () => ({ tForLocale: (_locale: string, key: string) => key }));
vi.mock("../governance", () => ({ publishGovernanceSkill: mocks.publishGovernance }));
vi.mock("../store", () => ({ assistantStore: { agents: mocks.agents } }));
vi.mock("../labels", () => ({ assistantName: (a: AgentRow) => a.name, assistantDescription: (a: AgentRow) => a.description }));
vi.mock("../../product-assets/platform-assets", () => ({ nativeProfileId: mocks.native }));
vi.mock("../../product-assets/agent-profile", () => ({ profileIdForAgent: mocks.profile }));
vi.mock("../../product-assets/grants", () => ({
  withProductGrants: (_owner: unknown, action: () => unknown) => action(), currentProductGrants: () => ({ use: mocks.grants }),
}));
import { assistantSkillCatalog, effectiveAssistantSkills, prepareAssistantSkills, readAssistantSkillView, validateAssistantSkills } from "../skills";
import { listAssistantAgents } from "../agents";
import { workbenchApplications } from "../../applications/builtins";

const page: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" };
const report: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };
const dashboard: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "dashboard-pages" };
const sameName: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: page.name };
const owner = { domainId: "domain", userId: "user" }, credentials = { token: "user-token", locale: "en" };
const query = { pageKey: "governance-report", permissionCode: "business-knowledge" } as const;
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
function definition(index: number, kind: string, skills: RuntimeSkillRef[] = [report, page]): AgentRow {
  return { id: ids[index], domain_id: "domain", kind, name: kind, description: "", icon: null, enabled: true,
    execution_user_id: null, system_prompt: "private prompt", model_selection: { modelId: null }, skills, class_names: [], enabled_mcp_service_ids: [], sort_order: index };
}
function projection(allowed = true): PageSkillsProjection {
  return { pageSkills: allowed ? [{ permissionCode: "business-knowledge", skill: page }] : [], registeredSkills: [page, dashboard] };
}
let current: PageSkillsProjection;
beforeEach(() => {
  vi.clearAllMocks(); mocks.grants.clear(); current = projection();
  mocks.managed.length = 0;
  mocks.publishGovernance.mockResolvedValue({ skill: page, digest: "b".repeat(64) });
  mocks.get.mockImplementation(async () => ({ text: JSON.stringify({ success: true, data: current }) }));
  mocks.post.mockResolvedValue({ text: JSON.stringify({ allowed: true }) });
  mocks.native.mockResolvedValue(undefined); mocks.profile.mockResolvedValue(null);
  mocks.agents.mockResolvedValue([definition(0, "regular", [report]), definition(1, "custom")]);
});

it("removes denied page identities while preserving non-page skills, including the same name in another namespace", async () => {
  mocks.managed.push({ skill: sameName, title: sameName.name, description: "Available from a different provider" });
  current = projection(false);
  const denied = await readAssistantSkillView(owner.domainId, credentials);
  for (const kind of ["regular", "custom"])
    expect(effectiveAssistantSkills({ kind, skills: [report, page, sameName] }, denied)).toEqual([report, sameName]);
  current = projection();
  const allowed = await readAssistantSkillView(owner.domainId, credentials);
  expect(effectiveAssistantSkills({ kind: "regular", skills: [report] }, allowed)).toEqual([report, page]);
  expect(effectiveAssistantSkills({ kind: "custom", skills: [report] }, allowed)).toEqual([report]);
});

it("projects and admits the same skills, and rereads revocation on the next request", async () => {
  const rows = [definition(0, "regular", [report]), definition(1, "custom")]; mocks.agents.mockResolvedValue(rows);
  for (const allowed of [true, false]) {
    current = projection(allowed);
    const directory = await listAssistantAgents(owner, credentials);
    for (const row of rows) {
      const admitted = (await prepareAssistantSkills(owner.domainId, row, credentials)).skills.map(({ skill }) => skill);
      expect(directory.agents.find(a => a.id === row.id)?.effectiveSkills).toEqual(admitted);
      expect(admitted.some(skill => skill.name === page.name)).toBe(allowed);
    }
  }
  expect(JSON.stringify(await listAssistantAgents(owner, credentials))).not.toContain("private prompt");
  expect(JSON.stringify(await listAssistantAgents(owner, credentials))).not.toContain("user-token");
});

it("filters the configuration skill catalog and rejects a denied page skill on save", async () => {
  expect((await assistantSkillCatalog(owner.domainId, credentials)).skills.some(s => s.skill.name === page.name)).toBe(true);
  current = projection(false);
  expect((await assistantSkillCatalog(owner.domainId, credentials)).skills.some(s => s.skill.name === page.name)).toBe(false);
  await expect(validateAssistantSkills(owner.domainId, [page], credentials)).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
  await expect(listAssistantAgents(owner, credentials, query)).rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
});

it("keeps ordinary native skills and excludes true product Profile skills from page candidates", async () => {
  const native = definition(0, "regular", [report]);
  mocks.agents.mockResolvedValue([native, definition(1, "custom"), definition(2, "product"), { ...definition(3, "disabled"), enabled: false }]);
  mocks.native.mockImplementation(async (_domain: string, id: string) => id === native.id ? "native-profile" : undefined);
  mocks.grants.add("native-profile"); mocks.grants.add(native.id);
  mocks.profile.mockImplementation(async (_owner: unknown, id: string) => id === ids[2] ? "product-profile" : null);
  const directory = await listAssistantAgents(owner, credentials, query);
  expect(directory.agents.map(a => a.id)).toEqual([ids[0], ids[1]]);
  expect(directory.defaultAgentId).toBe(native.id);
  expect((await listAssistantAgents(owner, credentials)).agents.find(a => a.id === ids[2])?.effectiveSkills).toEqual([]);
  mocks.post.mockResolvedValue({ text: JSON.stringify({ allowed: false }) });
  expect((await listAssistantAgents(owner, credentials)).agents.some(a => a.id === native.id)).toBe(true);
  mocks.post.mockResolvedValue({ text: JSON.stringify({ allowed: true }) });
  mocks.grants.delete(native.id);
  expect((await listAssistantAgents(owner, credentials)).agents.some(a => a.id === native.id)).toBe(true);
});

it("returns the directory without a default when a preset is missing, disabled or unusable", async () => {
  current.pageSkills[0].defaults = [{ pageKey: "governance-report", defaultAgent: { kind: "preset", agentKind: "custom" } }];
  mocks.agents.mockResolvedValue([definition(0, "regular"), definition(1, "custom", [page])]);
  expect((await listAssistantAgents(owner, credentials, query)).defaultAgentId).toBe(ids[1]);
  for (const rows of [
    [definition(0, "regular")],
    [definition(0, "regular"), { ...definition(1, "custom", [page]), enabled: false }],
    [definition(0, "regular"), definition(1, "custom", [report])],
  ]) {
    mocks.agents.mockResolvedValue(rows);
    const directory = await listAssistantAgents(owner, credentials, query);
    expect(directory.agents.map(agent => agent.id)).toEqual([ids[0]]);
    expect(directory).not.toHaveProperty("defaultAgentId");
  }
});

it("selects a concrete ID without treating it as a preset kind", async () => {
  mocks.agents.mockResolvedValue([definition(0, "regular"), definition(1, "custom", [page])]);
  current.pageSkills[0].defaults = [{ pageKey: "governance-report", defaultAgent: { kind: "id", id: ids[1] } }];
  expect((await listAssistantAgents(owner, credentials, query)).defaultAgentId).toBe(ids[1]);
  current.pageSkills[0].defaults[0]!.defaultAgent = { kind: "id", id: "custom" };
  await expect(listAssistantAgents(owner, credentials, query)).rejects.toMatchObject({ code: "PAGE_DEFAULT_AGENT_UNAVAILABLE" });
});

it("locates each domain-member page by pageKey and keeps dashboard's own skill and default", async () => {
  current = { pageSkills: [{ access: "domain-member", pageKey: "dashboard", skill: dashboard, defaults: [{ pageKey: "dashboard", defaultAgent: { kind: "preset", agentKind: "custom" } }] },
    {access:"domain-member",pageKey:"schedules",skill:page,defaults:[{pageKey:"schedules",defaultAgent:{kind:"id",id:ids[0]}}]}], registeredSkills: [dashboard,page] };
  mocks.agents.mockResolvedValue([definition(0, "regular", [report]), definition(1, "custom", [dashboard])]);
  expect((await listAssistantAgents(owner, credentials, { pageKey: "dashboard", access: "domain-member" })).defaultAgentId).toBe(ids[1]);
  expect((await listAssistantAgents(owner, credentials, { pageKey: "schedules", access: "domain-member" })).defaultAgentId).toBe(ids[0]);
  await expect(listAssistantAgents(owner, credentials, { pageKey: "agent-settings", access: "domain-member" })).rejects.toMatchObject({code:"PAGE_SKILL_FORBIDDEN"});
  expect(assistantAgentsQuerySchema.safeParse({ pageKey: "dashboard" }).success).toBe(false);
  expect(assistantAgentsQuerySchema.safeParse({ ...query, access: "domain-member" }).success).toBe(false);
});

it("exposes projection failures instead of continuing with stale authorization", async () => {
  mocks.get.mockRejectedValue(new Error("Java unavailable"));
  await expect(listAssistantAgents(owner, credentials)).rejects.toThrow("Java unavailable");
  await expect(prepareAssistantSkills(owner.domainId, definition(0, "regular"), credentials)).rejects.toThrow("Java unavailable");
});

it("offers the registered dashboard page skill to the default agent for the dashboard query",async()=>{
  const mapping=workbenchApplications.find(app=>app.id==="dashboards")?.declaration.pageSkills?.find(entry=>"access" in entry&&entry.access==="domain-member");
  expect(mapping).toBeDefined();
  current={pageSkills:[mapping!],registeredSkills:[mapping!.skill]};
  const query=assistantAgentsQuerySchema.parse(Object.fromEntries(new URLSearchParams("pageKey=dashboard&access=domain-member")));
  const result=await listAssistantAgents(owner,credentials,query);
  expect(result.defaultAgentId).toBe(ids[0]);
  expect(result.agents.find(agent=>agent.id===ids[0])?.effectiveSkills).toContainEqual({namespace:{kind:"provider",provider:"workbench"},name:"dashboard-pages"});
});
