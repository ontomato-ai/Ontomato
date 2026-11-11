import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import ActionProposalRenderer from "../components/ActionProposalRenderer.vue";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get, nodeApiPost: api.post }));
afterEach(() => { vi.clearAllMocks(); });

it("blocks confirmation when a hidden target identity was not supplied by the model", async () => {
  api.get.mockResolvedValue({
    proposal: { schema: "ontomato.action-proposal.v1", actionId: "action", version: "v1", reason: "Update education", parameters: { highest_degree: "博士" } },
    action: { id: "action", name: "Update education", description: "", version: "v1", effects: [], parameters: [
      { name: "person_id", type: "TYPE_STRING", description: "Staff ID", required: true },
      { name: "highest_degree", type: "TYPE_STRING", description: "Degree", required: true },
    ] }, execution: null,
  });
  const wrapper = mount(ActionProposalRenderer, {
    props: { artifact: { id: "artifact", sessionId: "session" } as never, title: "Update", presentation: "inline", read: async () => new Blob() },
    global: { plugins: [workbenchI18n(), ElementPlus] },
  });
  try {
    await flushPromises();
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("person_id");
    await wrapper.get("form").trigger("submit");
    expect(api.post).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});

it("prefills parameters without executing and sends a write only after explicit confirmation", async () => {
  const continueConversation = vi.fn().mockResolvedValue(undefined);
  api.get.mockResolvedValue({
    proposal: { schema: "ontomato.action-proposal.v1", actionId: "action", version: "v1", reason: "Verify source", parameters: { source: "Verified" } },
    action: { id: "action", name: "Update source", description: "Technical description", version: "v1", effects: ["/internal/object update"], parameters: [{ name: "source", type: "TYPE_STRING", description: "Source", required: true }] },
    execution: null,
  });
  api.post.mockResolvedValue({ status: "succeeded", parameters: { source: "Reviewed" }, result: null, error: null });
  const wrapper = mount(ActionProposalRenderer, {
    props: { artifact: { id: "artifact", sessionId: "session" } as never, title: "Update source", presentation: "inline", read: async () => new Blob(), continueConversation },
    global: { plugins: [workbenchI18n(), ElementPlus] },
  });
  try {
    await flushPromises();
    expect(wrapper.get("input").element.value).toBe("Verified");
    expect(wrapper.text()).not.toContain("Technical description");
    expect(wrapper.text()).not.toContain("/internal/object");
    expect(api.post).not.toHaveBeenCalled();
    await wrapper.get("input").setValue("Reviewed");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/assistant/sessions/session/artifacts/artifact/action/confirm", { parameters: { source: "Reviewed" } });
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
    expect(wrapper.get("input").element.disabled).toBe(true);
    const edit = wrapper.findAll("button").find((button) => button.text() === "Edit again")!;
    await edit.trigger("click");
    await flushPromises();
    expect(continueConversation).toHaveBeenCalledWith(expect.stringContaining("Query its current data first"));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(wrapper.get("input").element.disabled).toBe(true);
    const verify = wrapper.findAll("button").find((button) => button.text() === "Check latest data")!;
    await verify.trigger("click");
    await flushPromises();
    expect(continueConversation).toHaveBeenLastCalledWith(expect.stringContaining("Only read"));
    await wrapper.setProps({ presentation: "panel" });
    expect(wrapper.text()).toContain("Technical description");
    expect(wrapper.text()).toContain("/internal/object update");
  } finally { wrapper.unmount(); }
});


it("confirms with every explicit null, empty string and zero intact", async () => {
  const parameters = { person_id: null, note: "", amount: 0 };
  api.get.mockResolvedValue({
    proposal: { schema: "ontomato.action-proposal.v1", actionId: "action", version: "v1", reason: "Update", parameters },
    action: { id: "action", name: "Update", description: "", version: "v1", effects: [], parameters: [
      { name: "person_id", type: "TYPE_STRING", description: "ID", required: true },
      { name: "note", type: "TYPE_STRING", description: "Note", required: true },
      { name: "amount", type: "TYPE_NUMBER", description: "Amount", required: true },
    ] }, execution: null,
  });
  api.post.mockResolvedValue({ status: "succeeded", parameters, result: null, error: null });
  const wrapper = mount(ActionProposalRenderer, {
    props: { artifact: { id: "artifact", sessionId: "session" } as never, title: "Update", presentation: "inline", read: async () => new Blob() },
    global: { plugins: [workbenchI18n(), ElementPlus] },
  });
  try {
    await flushPromises();
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/assistant/sessions/session/artifacts/artifact/action/confirm", { parameters });
  } finally { wrapper.unmount(); }
});
