import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import DataScopeGraph from "../components/DataScopeGraph.vue";
import { agentDefinitionsApi } from "../api";
import { editorAddress } from "./editor-address";

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
// The editor sits at its agent's address: leaving it is what its unsaved changes are checked against.
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/settings/:agentId", component: { template: "<div />" } }] });
await router.push("/agents/settings/agent-1");
const global = {
  plugins: [i18n, ElementPlus, router],
  stubs: { SkillSelector, CodeEditor: { template: "<div />" } },
};

function agent(classNames: string[]): AssistantAgentDefinition {
  return {
    id: "agent-1",
    name: "Sales analyst",
    description: "",
    icon: null,
    enabled: true,
    executionUserId: null,
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

  it("keeps natural node dimensions and allows horizontal scrolling when wider than the container", async () => {
    const sixteenClasses = Array.from({ length: 16 }, (_, index) => ({
      className: `Class${index + 1}`,
      showName: index === 3 ? "岗位等级变动记录" : index === 15 ? "Praxis 上下文装配" : `Object ${index + 1}`,
    }));
    const wrapper = mount(DataScopeGraph, {
      props: { modelValue: [], classes: sixteenClasses, relations: [], loading: false },
      global,
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const canvas = wrapper.find(".graph-canvas");
    const svg = canvas.find("svg");
    const fourthColNodes = wrapper.findAll(".graph-node").filter((_, index) => index % 4 === 3);

    // 4 columns at natural size: margin(16) + 4*node(152) + 3*gap(24) + margin(16) = 712, without viewBox scaling.
    expect(svg.attributes("width")).toBe("712");
    expect(svg.attributes("height")).toBe("268");
    expect(svg.attributes("viewBox")).toBeUndefined();
    expect(fourthColNodes).toHaveLength(4);
    expect(fourthColNodes[0]!.find("rect").attributes("x")).toBe("544");
    expect(fourthColNodes[0]!.find("rect").attributes("width")).toBe("152");
    expect(fourthColNodes[0]!.find("text").text()).toBe("岗位等级变动记录");
    expect(fourthColNodes[3]!.find("text").text()).toBe("Praxis 上下文装配");

    // The scroll area is not clamped inline to the SVG height (which would spawn a vertical scrollbar beside the horizontal one).
    expect(canvas.attributes("style")).toBeUndefined();

    const source = readFileSync(resolve(process.cwd(), "src/features/agents/components/DataScopeGraph.vue"), "utf8");
    const css = source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(css).toContain(".data-scope {");
    expect(css).toContain(".scope-graph {");
    expect(css).toContain("min-width: 0;");
    expect(css).toContain("max-height: 420px;");
    expect(css).toContain("overflow: auto;");
    expect(css).toContain("scrollbar-width: auto;");
    expect(css).toContain(".graph-canvas::-webkit-scrollbar");
    expect(css).toContain("max-width: none;");
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
      global: { ...global, provide: editorAddress("/agents/settings/agent-1").provide },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const graph = wrapper.findComponent(DataScopeGraph);
    graph.vm.$emit("update:modelValue", ["Order", "Customer"]);
    await flushPromises();
    const save = () => wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!;
    await save().trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1].classNames).toEqual(["Order", "Customer"]);
  });
});
