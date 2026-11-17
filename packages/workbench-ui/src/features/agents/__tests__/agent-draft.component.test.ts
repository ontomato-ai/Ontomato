import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AssistantAgentDefinition, AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import { agentSettingsAddressKey } from "../agent-settings-address";
import { editorAddress } from "./editor-address";
import { agentDefinitionsApi } from "../api";

/*
 * A page link may carry a draft: the agent wrote this form and the reader saves it. These hold the rule the page
 * keeps — filling and marking never write, Save is the one write, and the draft then leaves the address.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string) => string;

const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT = (name: string) => `/agents/settings/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2F${name}.page-draft.json`;

const draft = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../workbench/assistant-host", () => ({ createAssistantClient: () => ({ readPageDraft: draft.read }) }));

const options: ModelOptions = { models: [{ ref: "gateway/qwen-main", name: "Qwen", type: "chat" }], defaultModelId: "gateway/qwen-main", embeddingModelId: null };
const SkillSelector = defineComponent({ emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" });

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/settings/:agentId", component: { template: "<div />" } }] });
const global = {
  plugins: [i18n, ElementPlus, router],
  stubs: { SkillSelector, CodeEditor: { template: "<div />" } },
};

function agent(): AssistantAgentDefinition {
  return {
    id: AGENT, name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 3,
    executionUserId: null,
  };
}

function input(overrides: Partial<AssistantAgentInput> = {}): AssistantAgentInput {
  return {
    name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 3,
    ...overrides,
  };
}

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  draft.read.mockReset();
  document.body.innerHTML = "";
});

async function open(path: string, form: AssistantAgentInput, target: { id?: string } = { id: AGENT }, editing = target !== undefined && target.id !== undefined) {
  draft.read.mockResolvedValue({ pageKey: "agent-settings", operation: target.id ? "agent.update" : "agent.create", target, form });
  await router.push(path);
  vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
  const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (id, written) => ({ ...agent(), ...written, id }) as AssistantAgentDefinition);
  const create = vi.spyOn(agentDefinitionsApi, "create").mockImplementation(async (written) => ({ ...agent(), ...written }) as AssistantAgentDefinition);
  const address = editorAddress(path);
  const mounted = mount(AgentEditor, {
    props: { agent: editing ? agent() : null, classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
    global: { ...global, provide: address.provide },
    attachTo: document.body,
  });
  return finish(mounted, update, create, address.go);
}

async function finish(
  wrapper: VueWrapper,
  update: ReturnType<typeof vi.spyOn>,
  create: ReturnType<typeof vi.spyOn>,
  go: ReturnType<typeof editorAddress>["go"],
) {
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, update, create, go };
}

const saveButton = (wrapper: VueWrapper) =>
  wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!;

describe("the agent editor's page draft", () => {
  it("reads the draft and reports the save at the address the page is shown at, not the browser's", async () => {
    // Beside a conversation the page's address is the conversation's parameter; the editor must read the draft there and
    // ask the host to change that address once saved.
    draft.read.mockResolvedValue({ pageKey: "agent-settings", operation: "agent.update", target: { id: AGENT }, form: input({ name: "Renamed analyst" }) });
    await router.push("/agents/chat");
    vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
    const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (id, written) => ({ ...agent(), ...written, id }) as AssistantAgentDefinition);
    const go = vi.fn();
    const address = `/ontology/agents/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json`;
    const wrapper = mount(AgentEditor, {
      props: { agent: agent(), classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
      global: {
        ...global,
        provide: {
          [agentSettingsAddressKey as symbol]: {
            address: { value: address },
            draft: { value: { sessionId: "s", runId: "r", path: "outputs/drafts/a.page-draft.json" } },
            savedAddress: { value: `/ontology/agents/${AGENT}` },
            go,
          },
        },
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Renamed analyst");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(1);
    // The conversation's address loses the draft handoff; the browser's address is the conversation's and stays.
    expect(go).toHaveBeenCalledWith(`/ontology/agents/${AGENT}`);
    expect(router.currentRoute.value.path).toBe("/agents/chat");
  });

  it("fills the form and marks what the draft changed without writing anything", async () => {
    const { wrapper, update } = await open(DRAFT("a"), input({ name: "Renamed analyst", description: "covers EMEA" }));

    expect(draft.read).toHaveBeenCalledWith("s", "r", "outputs/drafts/a.page-draft.json");
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Renamed analyst");
    expect(wrapper.find(".draft-changed").text()).toContain(t("common.name"));
    expect(wrapper.find(".draft-changed").text()).toContain(t("common.description"));
    // Filling is not saving: the owner still holds the old name.
    expect(update).not.toHaveBeenCalled();
  });

  it("saves the filled form once, then drops the draft from the address", async () => {
    const { wrapper, update, go } = await open(DRAFT("a"), input({ name: "Renamed analyst" }));

    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![1]).toMatchObject({ name: "Renamed analyst" });
    // The page is asked for its address without the handoff; the editor never writes the browser's address itself.
    expect(go).toHaveBeenCalledWith(`/agents/settings/${AGENT}`);
  });

  it("fills a new agent's form from a create draft over its defaults", async () => {
    const { wrapper, create } = await open("/agents/settings/new?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fb.page-draft.json", input({ name: "New analyst" }), {});

    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("New analyst");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(create.mock.calls[0]![0]).toMatchObject({ name: "New analyst" });
  });

  it("refuses a create draft on a page that edits an existing agent", async () => {
    const { wrapper, update } = await open(DRAFT("d"), input({ name: "Another" }), {}, true);

    expect(wrapper.find(".draft-changed").exists()).toBe(false);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Sales analyst");
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a draft written for another agent", async () => {
    const { wrapper, update } = await open(DRAFT("c"), input({ name: "Other" }), { id: OTHER });

    expect(wrapper.find(".draft-changed").exists()).toBe(false);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Sales analyst");
    expect(update).not.toHaveBeenCalled();
  });
});
