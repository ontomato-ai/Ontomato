import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import FollowUpRenderer from "../components/FollowUpRenderer.vue";
import { shellContextKey } from "../../../../../agent-shell-ui/src/context";

it("continues only on click and retains the actual source run and dataset references", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(FollowUpRenderer, {
    props: { artifact: { id: "follow-up", runId: "source-run" } as never, presentation: "inline", title: "Continue",
      read: async () => new Blob([JSON.stringify({ schema: "ontomato.follow-ups.v1", suggestions: [
        { label: "按学院拆分", question: "按学院拆分2025年在职教师人数", datasetPaths: ["outputs/staff.dataset.json"] },
      ] })]) },
    global: { plugins: [ElementPlus], provide: { [shellContextKey as symbol]: { continueConversation: proceed } } },
  });
  try {
    await flushPromises();
    expect(proceed).not.toHaveBeenCalled();
    expect(wrapper.get<HTMLButtonElement>("button").element.disabled).toBe(false);
    await wrapper.get("button").trigger("click"); await flushPromises();
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining("2025年在职教师"));
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining('"sourceRunId":"source-run"'));
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining("outputs/staff.dataset.json"));
  } finally { wrapper.unmount(); }
});
