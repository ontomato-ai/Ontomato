import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import { agentDefinitionsApi } from "../api";
import { editorAddress } from "./editor-address";

/*
 * The skills area is one whole selection, and the page shows only the skills this reader may see: an update that leaves
 * the field out keeps the ones the owner stores, so the page sends it only when the reader worked in the area or the
 * draft named the skills. These hold that rule on the real editor and the real selector, with only the server's API
 * doubled.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string) => string;

const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT: RuntimeSkillRef = { namespace: { kind: "domain", domainId: "domain-1" }, name: "sales-report" };
const FORECAST: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "forecast" };
const DRAFT = `/agents/settings/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json`;

const draft = vi.hoisted(() => ({ read: vi.fn(), record: vi.fn() }));
vi.mock("../../workbench/assistant-host", () => ({
  createAssistantClient: () => ({ readPageDraft: draft.read, recordPageDraftCreated: draft.record }),
}));

const options: ModelOptions = { models: [{ ref: "gateway/qwen-main", name: "Qwen", type: "chat" }], defaultModelId: "gateway/qwen-main", embeddingModelId: null };
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/settings/:agentId", component: { template: "<div />" } }] });
const global = { plugins: [i18n, ElementPlus, router], stubs: { CodeEditor: { template: "<div />" } } };

function agent(skills: RuntimeSkillRef[] = []): AssistantAgentDefinition {
  return {
    id: AGENT, name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills, classNames: [], enabledMcpServiceIds: [], sortOrder: 3,
    executionUserId: null,
  };
}

const catalog = [
  { skill: REPORT, title: REPORT.name, description: "" },
  { skill: FORECAST, title: FORECAST.name, description: "" },
];

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  draft.read.mockReset();
  draft.record.mockReset();
  document.body.innerHTML = "";
});

/** The editor over `stored` (a new agent for null), with a draft when `form` is given. */
async function open(stored: AssistantAgentDefinition | null, form?: Record<string, unknown>) {
  const path = form ? DRAFT : stored ? `/agents/settings/${AGENT}` : "/agents/settings/new";
  if (form) draft.read.mockResolvedValue({ pageKey: "agent-settings", operation: "agent.update", target: { id: AGENT }, form });
  await router.push(path);
  vi.spyOn(agentDefinitionsApi, "skills").mockResolvedValue({ skills: catalog });
  vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
  vi.spyOn(agentDefinitionsApi, "executionOptions").mockResolvedValue({ canSetExecutionUser: false, users: [] });
  const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (id, written) => ({ ...agent(), ...written, id }) as AssistantAgentDefinition);
  const create = vi.spyOn(agentDefinitionsApi, "create").mockImplementation(async (written) => ({ ...agent(), ...written, id: AGENT }) as AssistantAgentDefinition);
  const wrapper = mount(AgentEditor, {
    props: { agent: stored, classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
    global: { ...global, provide: editorAddress(path).provide },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, update, create };
}

const saveButton = (wrapper: VueWrapper) =>
  wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!;

/** The skill card of `skill` in the real selector, clicked the way a reader clicks it. */
async function choose(wrapper: VueWrapper, skill: RuntimeSkillRef, times = 1) {
  const card = wrapper.findAll(".skill-card").find((item) => item.text().includes(skill.name))!;
  for (let time = 0; time < times; time += 1) await card.trigger("click");
  await flushPromises();
}

async function rename(wrapper: VueWrapper, name: string) {
  await wrapper.find("input").setValue(name);
  await flushPromises();
}

async function save(wrapper: VueWrapper) {
  await saveButton(wrapper).trigger("click");
  await flushPromises();
}

describe("the agent editor's skills save", () => {
  it("renames the agent without sending the skills the page shows", async () => {
    const { wrapper, update } = await open(agent([REPORT]));

    await rename(wrapper, "Renamed analyst");
    await save(wrapper);

    // The page shows only the skills this reader may see; sending them back would replace the whole selection.
    expect(update.mock.calls[0]![1]).not.toHaveProperty("skills");
    expect(update.mock.calls[0]![1]).toMatchObject({ name: "Renamed analyst" });
  });

  it("sends the whole selection when the reader changes the skills area", async () => {
    const { wrapper, update } = await open(agent());

    await choose(wrapper, FORECAST);
    await save(wrapper);

    expect(update.mock.calls[0]![1]).toMatchObject({ skills: [FORECAST] });
  });

  it("sends an empty selection when the reader clears the agent's skills", async () => {
    const { wrapper, update } = await open(agent([REPORT]));

    await choose(wrapper, REPORT);
    await save(wrapper);

    expect(update.mock.calls[0]![1]).toMatchObject({ skills: [] });
  });

  it("sends the selection the reader chose back even when it is the one the agent already holds", async () => {
    const { wrapper, update } = await open(agent([REPORT]));

    // Taking the skill away and choosing it again is still the reader's explicit selection, not "unchanged".
    await choose(wrapper, REPORT, 2);
    await rename(wrapper, "Renamed analyst");
    await save(wrapper);

    expect(update.mock.calls[0]![1]).toMatchObject({ name: "Renamed analyst", skills: [REPORT] });
  });

  it("keeps the stored skills when the draft names none, and marks only what it changes", async () => {
    const { wrapper, update } = await open(agent([REPORT]), {
      name: "Renamed analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
      modelSelection: { modelId: null }, classNames: [], enabledMcpServiceIds: [], sortOrder: 3, executionUserId: null,
    });

    expect(wrapper.findAll(".editor-section.changed").map((section) => section.attributes("data-section"))).toEqual(["basics"]);
    expect(wrapper.find(".draft-changed").text()).not.toContain(t("agents.skills"));
    await save(wrapper);
    expect(update.mock.calls[0]![1]).not.toHaveProperty("skills");
  });

  it("sends the skills a draft names, an empty selection included", async () => {
    const { wrapper, update } = await open(agent([REPORT]), {
      name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
      modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 3, executionUserId: null,
    });

    expect(wrapper.findAll(".editor-section.changed").map((section) => section.attributes("data-section"))).toEqual(["capabilities"]);
    await save(wrapper);
    expect(update.mock.calls[0]![1]).toMatchObject({ skills: [] });
  });

  it("names the skills of a new agent, which a creation still requires", async () => {
    const { wrapper, create } = await open(null);

    await rename(wrapper, "New analyst");
    await save(wrapper);

    expect(create.mock.calls[0]![0]).toMatchObject({ name: "New analyst", skills: [] });
  });

  it("shows the owner's refusal in its own words when the selection cannot be saved", async () => {
    const refused = "这个智能体选了你无权查看的技能，技能选择要由能看到完整选择的人来改";
    const { wrapper, update } = await open(agent([REPORT]));
    update.mockRejectedValue(new Error(refused));
    const shown = vi.spyOn(ElMessage, "error");

    await choose(wrapper, FORECAST);
    await save(wrapper);

    expect(shown).toHaveBeenCalledWith(refused);
  });
});
