import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import ClarificationRenderer from "../components/ClarificationRenderer.vue";

function mountCard(card: object, proceed = vi.fn().mockResolvedValue(undefined)) {
  return mount(ClarificationRenderer, {
    props: { artifact: { id: "clarification", sessionId: "session", runId: "source", path: "outputs/teachers.clarification.json" } as never,
      title: "Scope", presentation: "inline", continueConversation: proceed,
      read: async () => new Blob([JSON.stringify({ schema: "ontomato.clarification.v1", title: "Teacher scope", ...card })]) },
    global: { plugins: [ElementPlus, workbenchI18n()] },
  });
}

/*
 * Questions are now asked and answered over the composer. A card from an earlier conversation stays readable as the
 * record it is, and nothing on it answers again: an answer from it would reach no question that is still waiting.
 */
it("shows an earlier card's title, questions and options, and takes no answer", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  const wrapper = mountCard({ questions: [
    { id: "scope", label: "Which teachers?", kind: "single", options: [{ value: "full-time", label: "Full-time only" }, { value: "all", label: "Include part-time" }] },
    { id: "unit", label: "Unit", kind: "text", required: false },
  ] }, proceed);
  try {
    await flushPromises();
    const text = wrapper.text();
    for (const shown of ["Teacher scope", "Which teachers?", "Full-time only", "Include part-time", "Unit"]) expect(text).toContain(shown);
    expect(wrapper.findAll("form, input, textarea, button")).toHaveLength(0);
    expect(proceed).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
