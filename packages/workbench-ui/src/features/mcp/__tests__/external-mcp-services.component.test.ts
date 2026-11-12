import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import ExternalMcpServices from "../components/ExternalMcpServices.vue";
import { agentDefinitionsApi } from "../../agents/api";

/**
 * The external MCP services are the system settings', and the MCP permission alone opens them: the agents are read only
 * for someone who may read them, and never stand between the list and its reader.
 */
vi.mock("../api", () => ({
  listMcpServices: vi.fn(async () => [{ id: "7cc21b6e-170b-4d05-9559-c5c431603a24", name: "Orders", url: "http://orders/mcp", headers: {} }]),
  listExternalMcpTools: vi.fn(),
  deleteMcpService: vi.fn(),
}));
vi.mock("../../agents/api", () => ({ agentDefinitionsApi: { list: vi.fn() } }));

afterEach(() => { vi.clearAllMocks(); });

async function mountPage(showUsage: boolean) {
  const wrapper = mount(ExternalMcpServices, {
    props: { showUsage },
    global: { plugins: [workbenchI18n(), ElementPlus], stubs: { McpServiceDialog: true } },
  });
  await flushPromises();
  return wrapper;
}

it("lists the services without reading the agents when the reader may not", async () => {
  const wrapper = await mountPage(false);
  expect(wrapper.text()).toContain("Orders");
  expect(agentDefinitionsApi.list).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("names the agents that use a service for a reader who may read them", async () => {
  vi.mocked(agentDefinitionsApi.list).mockResolvedValue([
    { name: "Analyst", enabledMcpServiceIds: ["7cc21b6e-170b-4d05-9559-c5c431603a24"] },
  ] as never);
  const wrapper = await mountPage(true);
  expect(wrapper.text()).toContain("Analyst");
  wrapper.unmount();
});
