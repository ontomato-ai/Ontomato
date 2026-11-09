import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import ClarificationRenderer from "../components/ClarificationRenderer.vue";
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get, nodeApiPut: api.put, nodeApiPost: api.post }));

it("requires an explicit choice and preserves the original retrieval version when continuing", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  api.get.mockResolvedValue({ values: {}, notes: "", status: "draft", continuationRunId: null });
  api.put.mockResolvedValue({}); api.post.mockResolvedValue({});
  const retrieval = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", decisionRevision: 3 };
  const wrapper = mount(ClarificationRenderer, {
    props: { artifact: { id: "clarification", sessionId: "session", runId: "source" } as never, title: "Scope", presentation: "inline", refreshConversation: proceed,
      read: async () => new Blob([JSON.stringify({ schema: "ontomato.clarification.v1", title: "Teacher scope", retrieval,
        questions: [{ id: "scope", label: "Which teachers?", kind: "single", required: true, options: [{ value: "full-time", label: "Full-time only" }, { value: "all", label: "Include part-time" }] }] })]) },
    global: { plugins: [ElementPlus, workbenchI18n()] },
  });
  try {
    await flushPromises();
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
    await wrapper.get('input[type="radio"]').setValue();
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/assistant/sessions/session/artifacts/clarification/decision/submit", { values: { scope: "full-time" }, notes: "" });
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
    await wrapper.get("form").trigger("submit");
    expect(proceed).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

it("restores a submitted decision as read-only when reopened", async () => {
  api.get.mockResolvedValue({ values: { scope: "all" }, notes: "My decision", status: "submitted", continuationRunId: "22222222-2222-4222-8222-222222222222" });
  const wrapper = mount(ClarificationRenderer, {
    props: { artifact: { id: "saved", sessionId: "session" } as never, title: "Scope", presentation: "inline", read: async () => new Blob([JSON.stringify({ schema: "ontomato.clarification.v1", title: "Scope", questions: [{ id: "scope", kind: "single", label: "Which teachers?", options: [{ value: "all", label: "All teachers" }] }] })]) },
    global: { plugins: [ElementPlus, workbenchI18n()] },
  });
  try {
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[type="radio"]').element.checked).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe("My decision");
  } finally { wrapper.unmount(); }
});
