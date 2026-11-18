import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import AgentExecutionField from "../components/AgentExecutionField.vue";
import { agentDefinitionsApi } from "../api";
import { editorAddress } from "./editor-address";

/*
 * Whose permissions an agent runs with: a domain governance administrator chooses one member, everyone else reads the
 * reference it holds and cannot submit a change to it. Editing anything else never resets the stored reference, because
 * an update that omits the field keeps it — the field is sent only when this reader may set it and changed it.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SkillSelector = defineComponent({ emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" });
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/ontology/agents/:agentId", component: { template: "<div />" } }] });
const global = { plugins: [i18n, ElementPlus, router], stubs: { SkillSelector, CodeEditor: { template: "<div />" } } };

const options: ModelOptions = {
  models: [{ ref: "gateway/qwen-main", name: "Qwen", type: "chat" }],
  defaultModelId: "gateway/qwen-main", embeddingModelId: null,
};

function agent(executionUserId: string | null): AssistantAgentDefinition {
  return {
    id: AGENT, name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 3,
    executionUserId,
  };
}

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The identity service's answer: an administrator may set the reference, and sees one member to choose. */
function identity(
  canSetExecutionUser: boolean,
  users: { id: string; name: string }[] = [],
  selected?: { id: string; name: string; available: boolean; reason?: "disabled" | "deleted" | "not-member" },
) {
  return vi.spyOn(agentDefinitionsApi, "executionOptions").mockResolvedValue({ canSetExecutionUser, users, selected });
}

async function mountEditor(stored: string | null, canSet: boolean, selected?: Parameters<typeof identity>[2]) {
  identity(canSet, canSet ? [{ id: MEMBER, name: "Mei Chen" }] : [], selected);
  vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
  const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (id, written) => ({ ...agent(stored), ...written, id }) as AssistantAgentDefinition);
  await router.push(`/ontology/agents/${AGENT}`);
  const wrapper = mount(AgentEditor, {
    props: { agent: agent(stored), classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
    global: { ...global, provide: editorAddress(`/ontology/agents/${AGENT}`).provide },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, update, field: wrapper.findComponent(AgentExecutionField) };
}

const saveButton = (wrapper: VueWrapper) =>
  wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!;

describe("an agent's execution permission", () => {
  it("shows its arrow: a remote choice that looks like a field cannot be told from one that is read only", async () => {
    const { wrapper } = await mountEditor(MEMBER, true);
    // The choice is remote and filterable, which Element Plus draws without a suffix unless it is asked for one: what
    // says "this opens a list" is the caret the other choices on the page have.
    const suffix = wrapper.find(".execution-select .el-select__suffix");
    expect(suffix.exists()).toBe(true);
    // The caret itself, the same mark the page's other choices carry.
    expect(suffix.find("svg").exists()).toBe(true);
  });

  it("names the stored member and why it cannot run, even when the list does not reach it", async () => {
    // The identity service answers for the reference itself: a reader without the permission sees the member's name and
    // the reason, and no member list is needed to judge it.
    const { wrapper } = await mountEditor(MEMBER, false, { id: MEMBER, name: "Mei Chen", available: false, reason: "not-member" });
    expect(wrapper.find(".execution-read").text()).toBe("Mei Chen");
    expect(wrapper.find(".execution-unavailable").text()).toContain(t("agents.executionReason.not-member"));
  });

  it("shows the server's own words when the options cannot be read", async () => {
    identity(false, []);
    vi.mocked(agentDefinitionsApi.executionOptions).mockRejectedValue(new Error("Domain identity service unavailable"));
    vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
    await router.push(`/ontology/agents/${AGENT}`);
    const wrapper = mount(AgentEditor, {
      props: { agent: agent(MEMBER), classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
      global: { ...global, provide: editorAddress(`/ontology/agents/${AGENT}`).provide }, attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find(".execution-unavailable").text()).toContain("Domain identity service unavailable");
  });

  it("starts a new agent with the reader's own permissions", async () => {
    identity(true, [{ id: MEMBER, name: "Mei Chen" }]);
    vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
    const create = vi.spyOn(agentDefinitionsApi, "create").mockImplementation(async (written) => ({ ...agent(null), ...written }) as AssistantAgentDefinition);
    const wrapper = mount(AgentEditor, {
      props: { agent: null, classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
      global: { ...global, provide: editorAddress("/ontology/agents/new").provide }, attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    await wrapper.find("input").setValue("New analyst");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(create.mock.calls[0]![0]).not.toHaveProperty("executionUserId");
  });

  it("lets an administrator choose in the list alone, in the reader's words", async () => {
    // The choice is the list itself: an administrator reads it there once, and every line under it is a sentence.
    const { field } = await mountEditor(null, true);
    expect(field.find(".execution-select").exists()).toBe(true);
    expect(field.find(".execution-read").exists()).toBe(false);
    expect(field.text()).not.toMatch(/agents\.\w+/);
  });

  it("sends the reference an administrator chose", async () => {
    const { wrapper, update } = await mountEditor(null, true);
    const field = wrapper.findComponent(AgentExecutionField);
    field.vm.$emit("update:modelValue", MEMBER);
    await flushPromises();

    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1].executionUserId).toBe(MEMBER);
  });

  it("keeps the stored reference when only other fields change", async () => {
    const { wrapper, update } = await mountEditor(MEMBER, true);
    await wrapper.find("input").setValue("Renamed analyst");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    // Omitted: the owner keeps the member an administrator chose.
    expect(update.mock.calls[0]![1]).not.toHaveProperty("executionUserId");
  });

  it("shows a reader without the permission what is set, and never sends it", async () => {
    const { wrapper, update } = await mountEditor(MEMBER, false);
    // The reference is shown by name once the identity service offers it; here it offers no members to this reader.
    expect(wrapper.text()).toContain(t("agents.executionReadOnly"));

    await wrapper.find("input").setValue("Renamed analyst");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1]).not.toHaveProperty("executionUserId");
  });
});
