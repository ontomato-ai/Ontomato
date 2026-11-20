import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { pageSkillContextSchema } from "@ontomato/contracts/page-skills";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { PanelSkillSource } from "@ontomato/contracts/product-panels";
import { startPanelSkillEntryServer } from "../../__tests__/fixtures/panel-skill-entry-server";
import { protectedSkillRef } from "../../core/skills/providers";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";

vi.mock("../../services/assistant/execution-setting", () => ({ validateExecutionSetting: vi.fn() }));
const governance = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "knowledge-governance" };
const governanceDefault = { kind: "preset" as const, agentKind: "governance-report" };
const fixture = {
  domainId: "panel-entry-domain", panelId: "settings", grants: new Set(["settings", "records"]), native: false,
  uses: [
    { applicationId: "settings", useId: "settings-panel", panelId: "settings", path: "/applications/settings/settings",
      entrance: { permissionCode: "analysis-agent", pageKey: "settings" } },
    { applicationId: "other-settings", useId: "other-panel", panelId: "settings", path: "/applications/other-settings/other",
      entrance: { permissionCode: "business-knowledge", pageKey: "other-settings" } },
  ] as PanelSkillSource[],
};
const agentId = randomUUID();
let server: Awaited<ReturnType<typeof startPanelSkillEntryServer>>;
let base: string;
let skill: RuntimeSkillRef;
const published = vi.fn();

beforeAll(async () => {
  server = await startPanelSkillEntryServer({
    entries: fixture.uses, grants: fixture.grants, onPublish: published,
    nativeMapping: () => fixture.native ? { permissionCode: "business-knowledge", skill: governance,
      defaults: [{ pageKey: "other-settings", defaultAgent: governanceDefault }] } : undefined,
  });
  base = server.origin + "/api/assistant";
  skill = protectedSkillRef("product-panels", server.domainId, fixture.panelId);
  await getPostgresPool().query(`INSERT INTO ${table("assistant_agents")}
    (id,domain_id,kind,name,description,enabled,system_prompt,skills)
    VALUES ($1,$2,$1::uuid::text,'Before','',true,'',$3)`,
    [agentId, server.domainId, JSON.stringify([{ namespace: { kind: "domain", domainId: server.domainId },
      name: `panel-menu-settings-${"a".repeat(24)}` }])]);
});
afterAll(async () => { await server?.close(); });

it("lists a code panel's protected skill from the bundled current SDK and saves its selection", async () => {
  const [listed, saved] = await Promise.all([
    fetch(base + "/agent-skills"),
    fetch(`${base}/agent-definitions/${agentId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", description: "", icon: null, enabled: true, systemPrompt: "", skills: [skill] }),
    }),
  ]);
  expect([listed.status, saved.status]).toEqual([200, 200]);
  expect(await listed.json()).toMatchObject({ skills: expect.arrayContaining([expect.objectContaining({ skill })]) });
  expect(await saved.json()).toMatchObject({ id: agentId, name: "Renamed", skills: [skill] });
  const result = await getPostgresPool().query(`SELECT name,skills FROM ${table("assistant_agents")} WHERE id=$1`, [agentId]);
  expect(result.rows).toEqual([{ name: "Renamed", skills: [skill] }]);
});

it("prepares the same exact panel version from both current uses and omits it when a dependency is unreadable", async () => {
  const { pageSkillMemberContext, prepareAssistantSkills, readAssistantSkillView } = await import("../../services/assistant/skills");
  const credentials = { token: "editor", locale: "en" };
  const agent = { kind: "regular", skills: [] };
  let digest: string | undefined;
  const view = await readAssistantSkillView(fixture.domainId, credentials);
  for (const { applicationId, useId, entrance, path } of fixture.uses) {
    const source = { kind: "application-use" as const, applicationId, useId };
    const context = await pageSkillMemberContext(view, entrance, source, { id: fixture.panelId });
    expect(context).toMatchObject({ member: { source, memberPath: [], ref: skill } });
    const prepared = await prepareAssistantSkills(fixture.domainId, agent, credentials, context);
    digest ??= prepared.skills[0]!.digest;
    expect(prepared).toEqual({
      skills: [{ skill, digest }], pageDrafts: true,
      currentPage: { entrance, member: { source, memberPath: [], ref: skill }, path },
    });
  }
  expect(published).toHaveBeenCalledTimes(2);
  expect(published.mock.calls[0]).toEqual(published.mock.calls[1]);
  published.mockClear();
  fixture.grants.delete("records");
  const denied = await readAssistantSkillView(fixture.domainId, credentials);
  const { applicationId, useId, entrance } = fixture.uses[0]!;
  expect(await pageSkillMemberContext(denied, entrance, { kind: "application-use", applicationId, useId }, { id: fixture.panelId }))
    .toMatchObject({ member: null });
  expect(await prepareAssistantSkills(fixture.domainId, agent, credentials)).toEqual({
    skills: [], pageDrafts: false, currentPage: null,
  });
  expect(published).not.toHaveBeenCalled();
});

it("keeps the native governance skill and preset alongside the protected panel in the same group", async () => {
  const { effectiveAssistantSkills, readAssistantSkillView } = await import("../../services/assistant/skills");
  fixture.grants.add("records");
  fixture.native = true;
  const view = await readAssistantSkillView(fixture.domainId, { token: "editor", locale: "en" });
  const groups = view.pageSkills.filter(group =>
    "permissionCode" in group.locator && group.locator.permissionCode === "business-knowledge");
  expect(groups).toEqual([{
    locator: { permissionCode: "business-knowledge" }, skills: [governance, skill],
    defaults: [{ pageKey: "other-settings", defaultAgent: governanceDefault }],
  }]);
  expect(effectiveAssistantSkills({ kind: "regular", skills: [] }, view)).toHaveLength(2);
});

it("opens registered panel entries, selects the regular assistant and installs the exact current page skill", async () => {
  const { prepareAssistantSkills } = await import("../../services/assistant/skills");
  const { assistantStore } = await import("../../services/assistant/store");
  const pages = server.entries;
  fixture.uses.splice(0, fixture.uses.length, ...pages);
  fixture.native = false;
  for (const page of pages) fixture.grants.add(page.panelId);
  const credentials = { token: "editor", locale: "en" };
  const owner = { domainId: fixture.domainId, userId: "editor" };
  for (const { applicationId, useId, panelId, entrance, path: pagePath } of pages) {
    const panelUrl = `${server.origin}/api/product-panels/${panelId}?${new URLSearchParams({ applicationId, useId, ...entrance })}`;
    const opened = await fetch(panelUrl);
    const page = await opened.json();
    expect(opened.status, JSON.stringify(page)).toBe(200);
    const context = pageSkillContextSchema.parse(page.pageSkillContext);
    const member = { source: { kind: "application-use", applicationId, useId }, memberPath: [],
      ref: protectedSkillRef("product-panels", owner.domainId, panelId) };
    expect(context).toEqual({ mode: "member", locator: entrance, member });
    if (context.mode !== "member" || !context.member) throw new Error("Expected an admitted panel member");

    const locator = new URLSearchParams(context.locator);
    const missing = await fetch(`${base}/agents?${locator}`);
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ error: { code: "PAGE_SKILL_FORBIDDEN" } });
    locator.set("member", JSON.stringify(context.member));
    const candidateUrl = `${base}/agents?${locator}`;
    const result = await fetch(candidateUrl);
    const candidates = await result.json();
    expect(result.status, JSON.stringify(candidates)).toBe(200);
    expect(candidates.defaultAgentId).toBe(server.regularAgentId);
    expect(candidates.agents).toContainEqual(expect.objectContaining({ id: server.regularAgentId, enabled: true }));
    const agent = await assistantStore.agent(candidates.defaultAgentId, owner);
    const prepared = await prepareAssistantSkills(owner.domainId, agent, credentials, context);
    expect(prepared.currentPage).toEqual({ entrance, member, path: pagePath });
    const sessionId = randomUUID();
    const session = await fetch(base + "/sessions", { method: "POST", headers: {
      "Content-Type": "application/json", "Idempotency-Key": sessionId }, body: JSON.stringify({ agentId: agent.id }) });
    expect(session.ok, await session.text()).toBe(true);
    const sent = await fetch(`${base}/sessions/${sessionId}/runs`, { method: "POST", headers: {
      "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ message: "Read this panel", pageSkillContext: context }) });
    expect(sent.status, await sent.text()).toBe(202);
    const installed = await server.installedSkill(sessionId, member.ref);
    expect(prepared.skills).toContainEqual({ skill: installed.skill, digest: installed.digest });
    expect(installed.markdown).toContain(member.ref.name);

    fixture.grants.delete("records");
    const denied = await fetch(panelUrl);
    expect(denied.status).toBe(200);
    expect((await denied.json()).pageSkillContext).toEqual({ mode: "member", locator: entrance, member: null });
    expect((await fetch(candidateUrl)).status).toBe(403);
    await expect(prepareAssistantSkills(owner.domainId, agent, credentials, context))
      .rejects.toMatchObject({ status: 403, code: "PAGE_SKILL_FORBIDDEN" });
    fixture.grants.add("records");
  }
}, 30000);
