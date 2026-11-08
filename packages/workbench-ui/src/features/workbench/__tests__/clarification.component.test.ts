import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import ClarificationRenderer from "../components/ClarificationRenderer.vue";

it("requires an explicit choice and preserves the original retrieval version when continuing", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  const retrieval = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", decisionRevision: 3 };
  const wrapper = mount(ClarificationRenderer, {
    props: { artifact: { id: "clarification", runId: "source" } as never, title: "Scope", presentation: "inline", continueConversation: proceed,
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
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining("Full-time only"));
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining('"decisionRevision":3'));
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining(retrieval.runId));
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
    await wrapper.get("form").trigger("submit");
    expect(proceed).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});
