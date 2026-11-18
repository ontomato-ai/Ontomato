import { createApp, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, expect, it } from "vitest";
import ShellComposer from "../components/ShellComposer.vue";

/*
 * The two shapes of the one composer (the user's decision, 2026-11-18). Under a conversation it is one block three lines
 * high — two lines to write in and the controls' line — and grows upward with the message to eight lines, scrolling inside
 * after that. Floating over a page it is two layers: the fold and the agent above, one line of input and send below,
 * growing to six lines. Folded, a floating box is a round button; opened again, what was being written is still there,
 * and the fold is remembered by the browser.
 *
 * What these cannot show is the stylesheet's: the box's corners, its shadow, where the round button sits on the page and
 * the pixels between the parts — those are checked on the deployed page.
 */

// The test page has no layout: a textarea's text takes one 22px line per 40 characters, inside 5px of padding each side.
const LINE = 22, PADDING = 10, PER_LINE = 40;
const written = (text: string) => text.split("\n").reduce((lines, part) => lines + Math.max(1, Math.ceil(part.length / PER_LINE)), 0);
beforeEach(() => {
  const style = document.createElement("style");
  style.dataset.composerTest = "";
  style.textContent = `textarea { line-height: ${LINE}px; padding: ${PADDING / 2}px 0; }`;
  document.head.append(style);
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return written(this.value) * LINE + PADDING;
    },
  });
});
afterEach(() => {
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  document.head.querySelector("style[data-composer-test]")?.remove();
  localStorage.clear();
  document.body.innerHTML = "";
});

const height = (lines: number) => `${lines * LINE + PADDING}px`;
const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

function mount(floating: boolean) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({
    render: () =>
      h(
        ShellComposer,
        { busy: false, floating, labels: { placeholder: "Ask", send: "Send", stop: "Stop", collapseComposer: "Hide", expandComposer: "Ask about this page" } },
        floating ? { agent: () => h("button", { class: "switch-trigger" }, "Assistant") } : {},
      ),
  });
  app.mount(root);
  const input = () => root.querySelector<HTMLTextAreaElement>("textarea")!;
  async function type(value: string) {
    input().value = value;
    input().dispatchEvent(new Event("input"));
    await nextTick();
    await nextTick();
  }
  return { root, input, type, unmount: () => app.unmount() };
}

it("is three lines high in a conversation: two to write in, then the controls", async () => {
  const conversation = mount(false);
  await nextTick();

  expect(conversation.input().style.height).toBe(height(2));
  // The input first, the controls' line under it; no agent chooser in the box (it heads the column).
  const body = conversation.root.querySelector(".composer-body")!;
  expect([...body.children].map((child) => child.className || child.tagName.toLowerCase())).toEqual(["textarea", "composer-controls"]);
  expect(conversation.root.querySelector(".composer .switch-trigger")).toBeNull();
  expect(conversation.root.querySelector(".composer-bar")).toBeNull();
  conversation.unmount();
});

it("grows upward with the message in a conversation, to eight lines, and scrolls inside after that", async () => {
  const conversation = mount(false);
  await conversation.type(lines(5));
  expect(conversation.input().style.height).toBe(height(5));
  expect(conversation.input().style.overflowY).toBe("hidden");

  await conversation.type(lines(12));
  expect(conversation.input().style.height).toBe(height(8));
  expect(conversation.input().style.overflowY).toBe("auto");

  await conversation.type("");
  expect(conversation.input().style.height).toBe(height(2));
  conversation.unmount();
});

it("floats over a page as two layers: the fold and the agent, then one line of input and send", async () => {
  const page = mount(true);
  await nextTick();

  const bar = page.root.querySelector(".composer-bar")!;
  expect([...bar.children].map((child) => child.className)).toEqual(["composer-fold", "composer-agent"]);
  const body = page.root.querySelector(".composer-body")!;
  expect([...body.children].map((child) => child.className || child.tagName.toLowerCase())).toEqual(["textarea", "composer-controls"]);
  expect(page.input().style.height).toBe(height(1));
  page.unmount();
});

it("grows upward on a page to six lines, scrolls after that, and is one line again when emptied", async () => {
  const page = mount(true);
  await page.type(lines(3));
  expect(page.input().style.height).toBe(height(3));

  await page.type(lines(9));
  expect(page.input().style.height).toBe(height(6));
  expect(page.input().style.overflowY).toBe("auto");

  await page.type("");
  expect(page.input().style.height).toBe(height(1));
  page.unmount();
});

it("folds into a round button and opens with what was being written still there; the fold is remembered", async () => {
  const page = mount(true);
  await page.type("Half a question");

  (page.root.querySelector(".composer-fold") as HTMLButtonElement).click();
  await nextTick();
  expect(page.root.querySelector(".composer")).toBeNull();
  expect(page.root.querySelector(".composer-unfold")).not.toBeNull();
  page.unmount();

  // Drawn again (another page, a reload): still folded.
  const again = mount(true);
  await nextTick();
  expect(again.root.querySelector(".composer")).toBeNull();
  (again.root.querySelector(".composer-unfold") as HTMLButtonElement).click();
  await nextTick();
  expect(again.root.querySelector(".composer")).not.toBeNull();
  again.unmount();

  // The draft lives in the box that was folded: folding and opening it keeps what was written.
  const kept = mount(true);
  await kept.type("Half a question");
  (kept.root.querySelector(".composer-fold") as HTMLButtonElement).click();
  await nextTick();
  (kept.root.querySelector(".composer-unfold") as HTMLButtonElement).click();
  await nextTick();
  expect(kept.input().value).toBe("Half a question");
  kept.unmount();
});

it("never folds a conversation's box", async () => {
  localStorage.setItem("ontomato.shell.composerCollapsed", "true");
  const conversation = mount(false);
  await nextTick();
  expect(conversation.root.querySelector(".composer")).not.toBeNull();
  expect(conversation.root.querySelector(".composer-fold")).toBeNull();
  conversation.unmount();
});

it("keeps the reader's message while it waits for the button that sends it", async () => {
  const labels = ref({ placeholder: "Ask", send: "Send", stop: "Stop" });
  const root = document.createElement("div");
  document.body.append(root);
  const sent: string[] = [];
  const app = createApp({ render: () => h(ShellComposer, { busy: false, labels: labels.value, onSend: (text: string) => sent.push(text) }) });
  app.mount(root);
  const input = root.querySelector("textarea")!;
  input.value = "Which region grew fastest?";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  (root.querySelector(".composer-button") as HTMLButtonElement).click();
  await nextTick();
  expect(sent).toEqual(["Which region grew fastest?"]);
  app.unmount();
});
