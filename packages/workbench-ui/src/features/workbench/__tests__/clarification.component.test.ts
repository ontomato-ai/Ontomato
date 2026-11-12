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

it("requires an explicit choice and answers with one ordinary message naming the card file", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  const retrieval = { id: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222", decisionRevision: 3 };
  const wrapper = mountCard({ retrieval, questions: [{ id: "scope", label: "Which teachers?", kind: "single", required: true,
    options: [{ value: "full-time", label: "Full-time only" }, { value: "all", label: "Include part-time" }] }] }, proceed);
  try {
    await flushPromises();
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    await wrapper.get('input[type="radio"]').setValue();
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(proceed).toHaveBeenCalledTimes(1);
    const message = proceed.mock.calls[0]![0] as string;
    // One message naming the card's title and file, the question, and the answer the reader chose.
    expect(message).toContain("Teacher scope");
    expect(message).toContain("outputs/teachers.clarification.json");
    expect(message).toContain("Which teachers?");
    expect(message).toContain("Full-time only");
    expect(message).not.toContain(retrieval.id);
    // The card records no answered state; the sent message is the user's answer.
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  } finally { wrapper.unmount(); }
});

it("lists multiple choices and notes, and skips unanswered optional questions", async () => {
  const proceed = vi.fn().mockResolvedValue(undefined);
  const wrapper = mountCard({ questions: [
    { id: "types", label: "Staff types", kind: "multiple", options: [{ value: "t", label: "Teachers" }, { value: "r", label: "Researchers" }] },
    { id: "unit", label: "Unit", kind: "text", required: false },
  ] }, proceed);
  try {
    await flushPromises();
    for (const box of wrapper.findAll('input[type="checkbox"]')) await box.setValue(true);
    await wrapper.get("textarea").setValue("Exclude visiting staff");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(proceed).toHaveBeenCalledTimes(1);
    const message = proceed.mock.calls[0]![0] as string;
    expect(message).toContain("Staff types");
    expect(message).toContain("Teachers");
    expect(message).toContain("Researchers");
    expect(message).toContain("Exclude visiting staff");
    // The unanswered optional question is left out of the message.
    expect(message).not.toContain("Unit");
  } finally { wrapper.unmount(); }
});
