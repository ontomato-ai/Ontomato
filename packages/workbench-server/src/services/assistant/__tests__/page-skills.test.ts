import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkillsProjection } from "@ontomato/contracts/page-skills";
import { assistantAgentsQuerySchema } from "@ontomato/contracts/page-skills";
import type { AgentRow } from "../store";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), agents: vi.fn(), native: vi.fn(), profile: vi.fn(),
  grants: new Set<string>(),
}));
vi.mock("../../../utils/backend-client", () => ({ backendGet: mocks.get, backendPost: mocks.post,
  buildBackendHeaders: (token: string) => ({ tk: token }) }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://ontology.test" } } }));
vi.mock("../../../content/resources", () => ({ workbenchServerResourceRoot: "/resources" }));
vi.mock("../../../core/skills/manifest", () => ({ readSkillMarkdown: () => ({ manifest: { description: "Skill" } }) }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: { forDomain: async () => ({}) } }));
vi.mock("../../skills/skill-manager", () => ({ skillManager: { getAllSkills: async () => [] }, skillReference: vi.fn() }));
vi.mock("../../agent-runtime/skills", () => ({ publishSkill: vi.fn() }));
vi.mock("../../../i18n", () => ({ tForLocale: (_locale: string, key: string) => key }));
vi.mock("../store", () => ({ assistantStore: { agents: mocks.agents } }));
vi.mock("../labels", () => ({ assistantName: (a: AgentRow) => a.name, assistantDescription: (a: AgentRow) => a.description }));
vi.mock("../../product-assets/platform-assets", () => ({ nativeProfileId: mocks.native }));
vi.mock("../../product-assets/agent-profile", () => ({ profileIdForPrincipal: mocks.profile }));
vi.mock("../../product-assets/grants", () => ({
  withProductGrants: (_owner: unknown, action: () => unknown) => action(), currentProductGrants: () => ({ use: mocks.grants }),
}));
import { assistantSkillCatalog, effectiveAssistantSkills, prepareAssistantSkills, validateAssistantSkills } from "../skills";
import { listAssistantAgents } from "../agents";

const page: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "knowledge-governance" };
const report: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };
const dashboard: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "dashboard-pages" };
const sameName: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: page.name };
const owner = { domainId: "domain", userId: "user" }, credentials = { token: "user-token", locale: "en" };
const query = { pageKey: "governance-report", permissionCode: "business-knowledge" } as const;
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
function definition(index: number, kind: string, skills: RuntimeSkillRef[] = [report, page]): AgentRow {
  return { id: ids[index], domain_id: "domain", kind, name: kind, description: "", icon: null, enabled: true,
    system_prompt: "private prompt", model_selection: { modelId: null }, skills, class_names: [], enabled_mcp_service_ids: [], sort_order: index };
}
function projection(allowed = true): PageSkillsProjection {
  return { pageSkills: allowed ? [{ permissionCode: "business-knowledge", skill: page }] : [], registeredSkills: [page, dashboard] };
}
let current: PageSkillsProjection;
beforeEach(() => {
  vi.clearAllMocks(); mocks.grants.clear(); current = projection();
  mocks.get.mockImplementation(async () => ({ text: JSON.stringify({ success: true, data: current }) }));
  mocks.post.mockResolvedValue({ text: JSON.stringify({ allowed: true }) });
  mocks.native.mockResolvedValue(undefined); mocks.profile.mockResolvedValue(null);
  mocks.agents.mockResolvedValue([definition(0, "regular", [report]), definition(1, "custom")]);
});

it("removes denied page identities while preserving non-page skills, including the same name in another namespace", () => {
  for (const kind of ["regular", "custom"])
    expect(effectiveAssistantSkills({ kind, skills: [report, page, sameName] }, projection(false))).toEqual([report, sameName]);
  expect(effectiveAssistantSkills({ kind: "regular", skills: [report] }, projection())).toEqual([report, page]);
  expect(effectiveAssistantSkills({ kind: "custom", skills: [report] }, projection())).toEqual([report]);
});

it("projects and admits the same skills, and rereads revocation on the next request", async () => {
  const rows = [definition(0, "regular", [report]), definition(1, "custom")]; mocks.agents.mockResolvedValue(rows);
  for (const allowed of [true, false]) {
    current = projection(allowed);
    const directory = await listAssistantAgents(owner, credentials);
    for (const row of rows) {
      const admitted = (await prepareAssistantSkills(owner.domainId, row, credentials)).skills;
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
  expect((await listAssistantAgents(owner, credentials)).agents.some(a => a.id === native.id)).toBe(false);
  mocks.post.mockResolvedValue({ text: JSON.stringify({ allowed: true }) });
  mocks.grants.delete(native.id);
  expect((await listAssistantAgents(owner, credentials)).agents.some(a => a.id === native.id)).toBe(false);
});

it("uses the registered default only if it remains an enabled and usable page candidate", async () => {
  current.pageSkills[0].defaults = [{ pageKey: "governance-report", agentKey: "custom" }];
  expect((await listAssistantAgents(owner, credentials, query)).defaultAgentId).toBe(ids[1]);
  for (const rows of [[definition(0, "regular")], [definition(0, "regular"), { ...definition(1, "custom"), enabled: false }], [definition(0, "regular"), definition(1, "custom", [report])]]) {
    mocks.agents.mockResolvedValue(rows);
    await expect(listAssistantAgents(owner, credentials, query)).rejects.toMatchObject({ code: "PAGE_DEFAULT_AGENT_UNAVAILABLE" });
  }
});

it("uses the pageKey only to select a local default and supports the domain-member locator", async () => {
  current = { pageSkills: [{ access: "domain-member", skill: dashboard, defaults: [{ pageKey: "dashboard", agentKey: "custom" }] }], registeredSkills: [dashboard] };
  mocks.agents.mockResolvedValue([definition(0, "regular", [report]), definition(1, "custom", [dashboard])]);
  expect((await listAssistantAgents(owner, credentials, { pageKey: "dashboard", access: "domain-member" })).defaultAgentId).toBe(ids[1]);
  expect((await listAssistantAgents(owner, credentials, { pageKey: "agent-settings", access: "domain-member" })).defaultAgentId).toBe(ids[0]);
  expect(assistantAgentsQuerySchema.safeParse({ pageKey: "dashboard" }).success).toBe(false);
  expect(assistantAgentsQuerySchema.safeParse({ ...query, access: "domain-member" }).success).toBe(false);
});

it("exposes projection failures instead of continuing with stale authorization", async () => {
  mocks.get.mockRejectedValue(new Error("Java unavailable"));
  await expect(listAssistantAgents(owner, credentials)).rejects.toThrow("Java unavailable");
  await expect(prepareAssistantSkills(owner.domainId, definition(0, "regular"), credentials)).rejects.toThrow("Java unavailable");
});
