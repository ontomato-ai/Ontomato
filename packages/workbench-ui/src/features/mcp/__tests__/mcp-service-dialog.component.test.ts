import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { MCP_HEADER_MASK } from "@ontomato/contracts/agent-runtime-mcp";
import { workbenchI18n } from "../../../i18n";
import McpServiceDialog from "../components/McpServiceDialog.vue";
import { saveMcpService } from "../api";
import type { McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";

/**
 * Adding or editing an external MCP service: a saved header keeps its value unless a new one is typed, a removed row is
 * the only way to drop it, and the saved request never carries the masked placeholder.
 */
const i18n = workbenchI18n();
const t = i18n.global.t;

vi.mock("../api", () => ({ saveMcpService: vi.fn(async () => undefined) }));

const service: McpServiceView = {
  id: "7cc21b6e-170b-4d05-9559-c5c431603a24",
  name: "Orders",
  url: "http://localhost/mcp",
  headers: { authorization: MCP_HEADER_MASK, "x-remove": MCP_HEADER_MASK },
};

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function mountDialog() {
  const wrapper = mount(McpServiceDialog, {
    props: { visible: false, service },
    global: {
      plugins: [i18n, ElementPlus],
      stubs: {
        ElDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot/><slot name="footer"/></div>' },
      },
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("external MCP service dialog", () => {
  it("keeps hidden header values on rename and omits only the removed rows", async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ visible: true });
    await flushPromises();

    const header = wrapper.find('input[aria-label="Header value"]');
    expect((header.element as HTMLInputElement).value).toBe("");
    expect(header.attributes("placeholder")).toBe(MCP_HEADER_MASK);

    await wrapper.find('input[aria-label="Service Name"]').setValue("Renamed");
    await wrapper.findAll(".header-row")[1]!.find("button").trigger("click");
    const save = wrapper.findAll("button").find((item) => item.text() === t("common.save"))!;
    await save.trigger("click");
    await flushPromises();

    expect(vi.mocked(saveMcpService)).toHaveBeenCalledWith(
      { name: "Renamed", url: "http://localhost/mcp", headers: { authorization: null } },
      service.id,
    );
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });
});
