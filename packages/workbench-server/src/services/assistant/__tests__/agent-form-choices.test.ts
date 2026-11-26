import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../authorization", () => ({
  requireAgentCreation: vi.fn(), requireAgent: vi.fn(), agentAllowed: vi.fn(async () => false),
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" } } }));
import { tmpdir } from "node:os";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { appTextEn } from "../../../i18n/app-text-en";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { AgentRow } from "../store";

configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });
installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
const { createAgentOptionReadAdapters } = await import("../panel-reads");
const { describeAgentDefinitionForm, prepareAgentDefinitionFormFromFacts } = await import("../definition-form");
const { SkillRegistryManager, skillRegistryManager } = await import("../../../core/skills/registry/manager");
const { SkillScanner } = await import("../../../core/skills/discovery/scanner");
const { assistantStore } = await import("../store");
const { agentDefinitionFromRow } = await import("../definitions");
const { requireAgent, requireAgentCreation } = await import("../authorization");

beforeEach(() => {
  vi.spyOn(skillRegistryManager, "forDomain").mockImplementation(async domainId =>
    new SkillRegistryManager(tmpdir(), new SkillScanner(tmpdir()), domainId));
});

/*
 * The agent form as the original agent settings page asked for it (原页面对照《智能体设置》, panelisation lead
 * 2026-11-22): only the name must be filled in; the model and whose permissions the agent runs with each offer their
 * empty choice by name — the domain's default model, the reader's own permissions — so a reader can go back to it and
 * reads what an empty field means.
 */

const viewer = { token: "reader", locale: "en" };
const owner = { domainId: "domain", userId: "alice" };
const answer = (url: string) => {
  if (url.includes("/model-options"))
    return Response.json({ success: true, data: {
      models: [{ name: "dev-model", type: "chat" }, { name: "embed", type: "embedding", dimensions: 8 }],
      defaultModel: "dev-model", embeddingModel: null,
    } });
  if (url.includes("/platform/agent-execution/options"))
    return Response.json({ canSetExecutionUser: true, users: [{ id: "u-1", name: "Wang" }] });
  if (url.includes("/internal/agent-execution/validate-setting")) return new Response(null, { status: 204 });
  throw new Error(`unexpected ${url}`);
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("offers the domain's default model and the reader's own permissions by name, first", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  const options = createAgentOptionReadAdapters(viewer as never);
  const models = (await options.models.options()).options;
  expect(models[0]).toEqual({ primaryKey: "@default", value: null, label: "Domain default (dev-model)" });
  expect(models.slice(1)).toEqual([{ primaryKey: "dev-model", value: "dev-model", label: "dev-model" }]);
  const users = (await options.users.options({})).options;
  expect(users[0]).toEqual({ primaryKey: "@default", value: null, label: "The reader's own permissions" });
  expect(users.slice(1).map(({ value }) => value)).toEqual(["u-1"]);
  // A held empty value reads as the same choice.
  expect((await options.models.resolve([null])).options[0]!.label).toBe("Domain default (dev-model)");
});

it("asks only for the agent's name before it is saved", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  const form = await describeAgentDefinitionForm({ target: { kind: "draft" } } as never, owner as never, viewer as never);
  expect(form.fields.filter((field) => field.required).map((field) => field.path)).toEqual(["/name"]);
});

it("groups the form into the agent page's sections, each field under its own, with the page's hints", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  const form = await describeAgentDefinitionForm({ target: { kind: "draft" } } as never, owner as never, viewer as never);
  expect(form.sections?.map(({ key }) => key)).toEqual(["basics", "model", "prompt", "capabilities", "execution", "data"]);
  expect(form.sections?.find(({ key }) => key === "model")?.hint).toBe("The model this agent uses. Following the domain default, it changes when the default does.");
  const sectionOf = Object.fromEntries(form.fields.map((field) => [field.path, field.section]));
  expect(form.fields.find(field => field.path === "/engine")).toMatchObject({
    defaultValue: "pi",
    control: { kind: "select", options: [
      expect.objectContaining({ value: "pi" }), expect.objectContaining({ value: "codex" }),
    ] },
  });
  expect(sectionOf).toEqual({
    "/name": "basics", "/description": "basics", "/icon": "basics", "/enabled": "basics", "/publicationAccess/kind": "basics",
    "/engine": "model", "/modelSelection/modelId": "model", "/systemPrompt": "prompt",
    "/skills": "capabilities", "/enabledMcpServiceIds": "capabilities",
    "/executionUserId": "execution", "/classNames": "data",
  });
  expect(form.fields.find(({ path }) => path === "/enabled")?.help).toBe("Once enabled, the agent can be chosen and used in conversations.");
  // The name and the description suggest what goes in them, as the page did.
  const placeholder = (path: string) => { const control = form.fields.find((field) => field.path === path)!.control; return control.kind === "text" ? control.placeholder : undefined; };
  expect([placeholder("/name"), placeholder("/description")]).toEqual(["For example: Sales analysis expert", "Briefly say what this agent is for"]);
});

it("presents an admitted draft from the same form assembly and without the old execution directory request", async () => {
  const request = { target: { kind: "draft" }, changedField: null } as const;
  const fetch = vi.fn(async (url: string) => answer(String(url)));
  vi.stubGlobal("fetch", fetch);
  const legacy = await describeAgentDefinitionForm(request, owner, viewer);
  fetch.mockClear();
  expect(prepareAgentDefinitionFormFromFacts(request, undefined, owner, viewer).present({ editable: true, canSetExecutionUser: true })).toEqual(legacy);
  expect(fetch).not.toHaveBeenCalled();
});

it("validates an admitted skill-free draft using only execution and model facts", async () => {
  const plan = prepareAgentDefinitionFormFromFacts({
    target: { kind: "draft" }, changedField: null,
    values: {
      name: "Analyst", description: "", icon: null, enabled: true, systemPrompt: "",
      skills: [], enabledMcpServiceIds: [], executionUserId: "member", modelSelection: { modelId: "chat" },
    },
  }, undefined, owner, viewer);
  expect(plan.validation).toEqual({ oldExecutionUserId: null, executionUserId: "member", modelId: "chat" });
  const editor = { editable: true, canSetExecutionUser: true };
  expect((await plan.present({ ...editor, executionError: "Member no longer active" })).errors).toEqual([
    { field: "/executionUserId", code: "invalid_option", message: "Member no longer active" },
  ]);
  const modelOptions = { models: [{ name: "chat", type: "chat" }], defaultModel: "chat", embeddingModel: null };
  expect((await plan.present({ ...editor, modelOptions })).values).toMatchObject({ name: "Analyst", executionUserId: "member", skills: [] });
  expect((await plan.present({ ...editor, modelOptions: { ...modelOptions, models: [] } })).errors).toMatchObject([
    { field: "/modelSelection/modelId", code: "target_unavailable" },
  ]);
});

const visibleSkill = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" } as const;
const hiddenSkill = { namespace: { kind: "domain", domainId: owner.domainId }, name: "removed-skill" } as const;
const storedAgent = {
  id: "5cd64061-34e5-4626-8c35-e0d767f810e7", kind: "custom", domain_id: owner.domainId, owner_id: "author",
  name: "Analyst", description: "", enabled: true, icon: null, system_prompt: "",
  engine: "pi", sort_order: 1, execution_user_id: null, model_selection: { modelId: null },
  skills: [visibleSkill, hiddenSkill], class_names: [], enabled_mcp_service_ids: [],
} as AgentRow;
const agentTarget = { kind: "object", objectType: AGENT_DEFINITION, primaryKey: storedAgent.id } as const;

it("projects stored P1 skills on a VIEW-only form without requiring selector EDIT", async () => {
  vi.spyOn(assistantStore, "agent").mockResolvedValue(storedAgent);
  const fetch = vi.fn(async (url: string) => answer(String(url)));
  vi.stubGlobal("fetch", fetch);
  const request = { target: agentTarget, changedField: null };
  const legacy = await describeAgentDefinitionForm(request, owner, viewer);
  expect(requireAgent).toHaveBeenCalledWith(storedAgent, "VIEW", viewer);
  expect(legacy.values.skills).toEqual([visibleSkill]);
  fetch.mockClear();
  const plan = prepareAgentDefinitionFormFromFacts(request, agentDefinitionFromRow(storedAgent), owner, viewer);
  expect(await plan.present({ editable: false, canSetExecutionUser: true })).toEqual(legacy);
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves omitted stored skills, and clears explicit empty skills only when all stored skills are visible", async () => {
  const fetch = vi.fn(async (url: string) => answer(String(url)));
  vi.stubGlobal("fetch", fetch);
  const definition = agentDefinitionFromRow(storedAgent);
  const facts = { editable: true, canSetExecutionUser: true };
  const draft = { target: agentTarget, changedField: null, values: { name: "Renamed" } };
  const omitted = prepareAgentDefinitionFormFromFacts(draft, definition, owner, viewer);
  expect(await omitted.present(facts)).toMatchObject({
    values: { name: "Renamed", skills: [visibleSkill] }, errors: [],
  });
  expect(definition.skills).toEqual([visibleSkill, hiddenSkill]);

  const clear = { ...draft, values: { ...draft.values, skills: [] } };
  const rejected = prepareAgentDefinitionFormFromFacts(clear, definition, owner, viewer);
  expect(await rejected.present(facts)).toMatchObject({
    errors: [{ field: "/skills", code: "target_unavailable", message: en["panels.agentForm.hiddenSkillSelection"] }],
  });
  expect((await rejected.present({ ...facts, executionError: "Member revoked" })).errors).toEqual([
    { field: "/executionUserId", code: "invalid_option", message: "Member revoked" },
  ]);
  const visible = { ...definition, skills: [visibleSkill] };
  expect(await prepareAgentDefinitionFormFromFacts(clear, visible, owner, viewer).present(facts)).toMatchObject({
    values: { skills: [] }, errors: [],
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the original P1 skill validation after CREATE and second-batch execution facts", async () => {
  const fetch = vi.fn(async (url: string) => answer(String(url)));
  vi.stubGlobal("fetch", fetch);
  const request = {
    target: { kind: "draft" as const }, changedField: null,
    values: { name: "Analyst", description: "", icon: null, enabled: true, systemPrompt: "", skills: [visibleSkill], enabledMcpServiceIds: [] },
  };
  const legacy = await describeAgentDefinitionForm(request, owner, viewer);
  expect(requireAgentCreation).toHaveBeenCalledWith(viewer);
  expect(legacy.errors).toEqual([]);
  fetch.mockClear();
  const facts = { editable: true, canSetExecutionUser: true };
  const plan = prepareAgentDefinitionFormFromFacts(request, undefined, owner, viewer);
  expect(await plan.present(facts)).toEqual(legacy);
  const missing = { ...request, values: { ...request.values, skills: [hiddenSkill] } };
  expect(await prepareAgentDefinitionFormFromFacts(missing, undefined, owner, viewer).present(facts)).toMatchObject({
    errors: [{ field: "/skills", code: "invalid_option", message: "Skill is not in this domain's catalogue" }],
  });
  expect(fetch).not.toHaveBeenCalled();
});
