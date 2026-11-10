import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent } from "vue";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import DataScopeGraph from "../components/DataScopeGraph.vue";
import { agentDefinitionsApi } from "../api";

/*
 * The data scope is chosen on the ontology graph (chosen / adjacent / not in scope) and saved as the same class-name
 * list as before: nothing selected means the whole ontology.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const classes = [
  { className: "Order", showName: "Orders" },
  { className: "Invoice", showName: "Invoices" },
  { className: "Customer", showName: "Customers" },
  { className: "Region", showName: "Regions" },
];
const relations = [
  { from: "Order", to: "Invoice" },
  { from: "Invoice", to: "Customer" },
];

const SkillSelector = defineComponent({ emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" });
const global = {
  plugins: [i18n, ElementPlus],
  stubs: { SkillSelector, CodeEditor: { template: "<div />" } },
};

function agent(classNames: string[]): AssistantAgentDefinition {
  return {
    id: "agent-1",
    name: "Sales analyst",
    description: "",
    icon: null,
    enabled: true,
    systemPrompt: "",
    modelSelection: { modelId: null },
    skills: [],
    classNames,
    enabledMcpServiceIds: [],
    sortOrder: 0,
  } as AssistantAgentDefinition;
}

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountGraph(value: string[]) {
  const wrapper = mount(DataScopeGraph, {
    props: { modelValue: value, classes, relations, loading: false },
    global,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  const node = (name: string) => wrapper.findAll(".graph-node").find((item) => item.attributes("aria-label") === name)!;
  const emitted = () => wrapper.emitted("update:modelValue")?.at(-1)?.[0] as string[] | undefined;
  return { wrapper, node, emitted };
}

describe("agent data scope on the ontology graph", () => {
  it("shows chosen, adjacent and out-of-scope object types", async () => {
    const { node } = await mountGraph(["Order"]);
    expect(node("Orders (Order)").classes()).toContain("chosen");
    expect(node("Invoices (Invoice)").classes()).toContain("adjacent");
    expect(node("Regions (Region)").classes()).not.toContain("adjacent");
    expect(node("Regions (Region)").classes()).not.toContain("chosen");
  });

  it("adds a clicked object type to the list and removes it when clicked again", async () => {
    const { node, emitted } = await mountGraph(["Order"]);
    await node("Customers (Customer)").trigger("click");
    expect(emitted()).toEqual(["Order", "Customer"]);
    await node("Orders (Order)").trigger("click");
    expect(emitted()).toEqual([]);
  });

  it("writes the adjacent object types into the same list when they are included", async () => {
    const { wrapper, emitted } = await mountGraph(["Order"]);
    await wrapper.find(".adjacent-choice input").setValue(true);
    // The neighbour becomes part of the saved list, so the parent re-renders it as chosen.
    expect(emitted()).toEqual(["Order", "Invoice"]);
    await wrapper.setProps({ modelValue: emitted() });
    const invoice = wrapper.findAll(".graph-node").find((item) => item.attributes("aria-label") === "Invoices (Invoice)")!;
    expect(invoice.classes()).toContain("chosen");
    expect(invoice.classes()).not.toContain("adjacent");
  });
});

describe("agent editor data scope", () => {
  it("saves the chosen class names as classNames, and an empty choice as the whole ontology", async () => {
    vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
    const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (_id, input) => ({
      ...agent(input.classNames),
      ...input,
    }) as AssistantAgentDefinition);
    const wrapper = mount(AgentEditor, {
      props: { agent: agent([]), classes, relations, outlineLoading: false, modelOptions: null, modelOptionsFailed: false },
      global,
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const graph = wrapper.findComponent(DataScopeGraph);
    graph.vm.$emit("update:modelValue", ["Order", "Customer"]);
    await flushPromises();
    const save = () => wrapper.findAll(".editor-bar button").find((button) => button.text() === t("common.save"))!;
    await save().trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1].classNames).toEqual(["Order", "Customer"]);
  });

  it("keeps the editor's sections in order: basics, data scope, capabilities, model, instructions", async () => {
    vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
    const wrapper = mount(AgentEditor, {
      props: { agent: agent([]), classes, relations, outlineLoading: false, modelOptions: null, modelOptionsFailed: false },
      global,
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    const sections = wrapper.findAll(".editor-section").map((section) => section.attributes("data-section"));
    expect(sections).toEqual(["basics", "capabilities", "prompt", "data"]);
    expect(wrapper.find('[data-section="basics"] [data-section="model"]').exists()).toBe(true);
  });
});
