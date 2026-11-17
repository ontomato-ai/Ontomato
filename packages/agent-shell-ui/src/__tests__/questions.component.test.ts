import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import type { AgentPendingQuestion } from "@ontomato/contracts/agent-channel";
import ShellConversation from "../components/ShellConversation.vue";
import { shellContextKey, type ShellContext } from "../context";

/*
 * The questions over the composer, as the user decided them (after Codex): folded to their count; open, numbered options
 * with the agent's default marked and the reader's own answer last, a number key picking an option; drafts kept while the
 * reader moves between questions; skipping sends nothing; and the composer under the panel keeps its own text and still
 * sends while the agent works, beside its stop button.
 */

const source = { session: { providerId: "workbench", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const scope: AgentPendingQuestion = {
  requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  source,
  message: "Which teachers count?",
  defaultAssumption: "Full-time teachers only",
  options: [
    { label: "Full-time only", isDefault: true },
    { label: "Include part-time", description: "Adds about 40 people", isDefault: false },
  ],
};
const period: AgentPendingQuestion = {
  requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  source,
  message: "Which period?",
  defaultAssumption: "This school year",
};

const labels = {
  placeholder: "Message", send: "Send", stop: "Stop", greeting: "Hello", submit: "Submit",
  questionsWaiting: (count: number) => `${count} waiting`,
  questionDefault: "Default assumption", questionOptionDefault: "Default", questionOptionOther: "Other",
  questionOtherPlaceholder: "Your answer", questionSkip: "Skip", questionPrevious: "Previous", questionNext: "Next",
};

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mountConversation(busy = false) {
  const answer = vi.fn(async () => true);
  const sent: string[] = [];
  const pending = ref([scope, period]);
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({
    render: () => h(ShellConversation, {
      items: [], sessionId: source.session.sessionId, agent: { id: "agent", name: "Assistant", description: "", icon: null, enabled: true },
      loading: false, loadError: null, hasOlder: false, loadingOlder: false, olderError: null, historyRevision: 0,
      sendError: null, pendingInput: null, busy, sending: false, onSend: (text: string) => sent.push(text),
    }),
  });
  app.provide(shellContextKey, {
    labels: ref(labels),
    questions: { pending, sending: ref(false), answer, view: reactive({ open: false, current: null, drafts: {}, skipped: [] }) },
  } as unknown as ShellContext);
  app.mount(root);
  return { root, answer, sent, pending };
}

const key = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const click = async (element: Element) => {
  (element as HTMLElement).click();
  await nextTick();
};
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text || candidate.getAttribute("aria-label") === text)!;
const pressed = (root: HTMLElement) => [...root.querySelectorAll(".question-option[aria-pressed='true']")].map((option) => option.textContent);

it("answers from the panel without touching the composer, and skipping sends nothing", async () => {
  const { root, answer } = mountConversation();
  await nextTick();
  const toggle = root.querySelector<HTMLButtonElement>(".questions-toggle")!;
  expect(toggle.textContent).toContain("2 waiting");
  expect(root.textContent).not.toContain("Which teachers count?");

  await click(toggle);
  expect(root.textContent).toContain("Which teachers count?");
  expect(root.textContent).toContain("Full-time teachers only");
  const options = [...root.querySelectorAll(".question-option")].map((option) => ({
    number: option.querySelector(".option-number")?.textContent,
    label: option.querySelector(".option-label")?.textContent?.replace(/\s+/g, " ").trim(),
    description: option.querySelector(".option-description")?.textContent,
  }));
  expect(options).toEqual([
    { number: "1", label: "Full-time only Default", description: undefined },
    { number: "2", label: "Include part-time", description: "Adds about 40 people" },
    { number: "3", label: "Other", description: undefined },
  ]);

  // A number typed in the composer is the reader's message, not a choice.
  const composer = root.querySelector("textarea")!;
  composer.value = "2 more things";
  composer.dispatchEvent(new Event("input"));
  key(composer, "2");
  await nextTick();
  expect(pressed(root)).toEqual([]);

  // In the panel a number key picks the option; the pick stays while the reader looks at the next question.
  key(toggle, "2");
  await nextTick();
  expect(pressed(root)).toHaveLength(1);
  expect(pressed(root)[0]).toContain("Include part-time");
  await click(button(root, "Next"));
  expect(root.textContent).toContain("Which period?");
  await click(button(root, "Previous"));
  expect(pressed(root)[0]).toContain("Include part-time");

  // Skipping only hides the question here.
  await click(button(root, "Skip"));
  expect(answer).not.toHaveBeenCalled();
  expect(toggle.textContent).toContain("1 waiting");
  expect(root.textContent).toContain("Which period?");

  // A question without options takes the reader's own answer.
  const own = root.querySelector<HTMLInputElement>(".question-option input")!;
  own.value = "  The last 12 months ";
  own.dispatchEvent(new Event("input"));
  await nextTick();
  root.querySelector("form.questions-body")!.dispatchEvent(new Event("submit"));
  await nextTick();
  expect(answer).toHaveBeenCalledWith(period.requestId, "The last 12 months");
  expect(composer.value).toBe("2 more things");
});

it("sends into a running reply, with the stop button beside the send button", async () => {
  const { root, sent } = mountConversation(true);
  await nextTick();
  expect(button(root, "Stop")).toBeTruthy();
  expect(button(root, "Send")).toBeUndefined();

  const composer = root.querySelector("textarea")!;
  composer.value = "Only count this year";
  composer.dispatchEvent(new Event("input"));
  await nextTick();
  expect(button(root, "Stop")).toBeTruthy();
  expect(button(root, "Send").disabled).toBe(false);
  root.querySelector<HTMLFormElement>("form.composer")!.dispatchEvent(new Event("submit"));
  expect(sent).toEqual(["Only count this year"]);
});
