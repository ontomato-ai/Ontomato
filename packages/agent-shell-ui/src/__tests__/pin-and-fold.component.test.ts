import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import ShellConversation from "../components/ShellConversation.vue";
import ShellResponse from "../components/ShellResponse.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { ConversationItem, ResponseItem } from "../view";

/*
 * How a turn reads while the agent works, as the user decided it (after Codex, 2026-11-17): a message that starts a turn
 * takes the top of the view and the reply grows under it, without the view being pulled to the tail; a message sent into
 * a running reply does not move the view; and the reply's thinking and tool steps stay one folded line while they run.
 */

const labels = {
  placeholder: "Message", send: "Send", stop: "Stop", greeting: "Hello", scrollToBottom: "Latest",
  working: "Working", elapsed: (time: string) => time, worked: (time: string) => `Worked ${time}`,
  thinking: "Thinking", preparing: "Preparing", steps: (count: number) => `${count} steps`,
};

let app: App | null = null;
let layout: (() => void) | null = null;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { layout = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  app?.unmount();
  app = null;
  layout = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const response = (key: string, running: boolean): ResponseItem => ({
  kind: "response", key, runId: key, workspaceCommit: null, running, end: null, answerMessageId: null, answerText: "",
  reviews: [], startedAt: null, finishedAt: null,
  process: [{ kind: "steps", key: `${key}:0`, active: running, steps: [{
    key: `${key}:0`, kind: "thinking", text: "Reading the question", toolName: "", skill: null, args: {}, status: running ? "streaming" : "done", output: "",
  }] }],
});

function provide(target: App) {
  target.provide(shellContextKey, {
    labels: ref(labels), slots: {}, toolRenderers: ref([]),
    questions: { pending: ref([]), sending: ref(false), answer: vi.fn(), view: reactive({ open: true, current: null, drafts: {}, skipped: [] }) },
  } as unknown as ShellContext);
}

/** A conversation 2000px tall in a 500px view; every element's top is 800px down the thread, minus the scroll. */
async function mountConversation() {
  const props = reactive({
    items: [{ kind: "user", key: "u1", text: "First", answer: false }, response("r1", false)] as ConversationItem[],
    pendingInput: null as string | null,
    busy: false,
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({
    render: () => h(ShellConversation, {
      ...props, sessionId: "s", agent: { id: "agent", name: "Assistant", description: "", icon: null, enabled: true },
      loading: false, loadError: null, hasOlder: false, loadingOlder: false, olderError: null, historyRevision: 0,
      sendError: null, sending: false, onSend: (text: string) => (props.pendingInput = text),
    }),
  });
  provide(app);
  app.mount(root);
  await nextTick();
  const scroller = root.querySelector<HTMLElement>(".scroller")!;
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this === scroller ? 0 : 800 - scroller.scrollTop, bottom: 0 } as DOMRect;
  });
  scroller.scrollTop = 0;
  return { root, props, scroller };
}

async function send(root: HTMLElement, text: string) {
  const textarea = root.querySelector("textarea")!;
  textarea.value = text;
  textarea.dispatchEvent(new Event("input"));
  await nextTick();
  root.querySelector<HTMLButtonElement>("button[aria-label='Send']")!.click();
  await nextTick();
  await nextTick();
}

it("puts a message that starts a turn at the top, and the reply grows under it without pulling the view down", async () => {
  const { root, props, scroller } = await mountConversation();
  await send(root, "Second");
  expect(root.querySelector("[data-pin]")?.textContent).toBe("Second");
  expect(scroller.scrollTop).toBe(776);

  // The run is admitted and streams: the sent message becomes the turn's question and the view stays on it.
  props.busy = true;
  props.items = [...props.items, { kind: "user", key: "u2", text: "Second", answer: false }, response("r2", true)];
  props.pendingInput = null;
  await nextTick();
  layout!();
  expect(root.querySelector("[data-pin]")?.textContent).toBe("Second");
  expect(scroller.scrollTop).toBe(776);
});

it("leaves the view where it is for a message sent into a running reply", async () => {
  const { root, props, scroller } = await mountConversation();
  props.busy = true;
  await nextTick();
  scroller.scrollTop = 300;
  await send(root, "Only this year");
  layout!();
  expect(root.querySelector("[data-pin]")).toBeNull();
  expect(scroller.scrollTop).toBe(300);
});

it("keeps a running reply's steps on one folded line until the reader opens them", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const item = ref(response("r", true));
  app = createApp({ render: () => h(ShellResponse, { item: item.value, sessionId: "s" }) });
  provide(app);
  app.mount(root);
  const line = root.querySelector<HTMLButtonElement>(".process-summary")!;
  expect(line.textContent).toContain("Thinking");
  expect(root.querySelector(".steps")).toBeNull();

  line.click();
  await nextTick();
  expect(root.querySelector(".steps")?.textContent).toContain("Reading the question");
});
