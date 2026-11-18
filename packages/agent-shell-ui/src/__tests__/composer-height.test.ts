import { createApp, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, expect, it } from "vitest";
import ShellComposer from "../components/ShellComposer.vue";

/*
 * The composer is as tall as the message. An empty one is one line whatever its placeholder says — the hint is cut with an
 * ellipsis rather than wrapping, so a narrow row keeps the agent choice beside the input — and the reader's own text
 * decides again as it grows.
 */

// The test page has no layout: a textarea's text takes one 22px line per 40 characters, inside 9px of padding each side.
const LINE = 22, PADDING = 18, PER_LINE = 40;
const textHeight = (text: string) => Math.max(1, Math.ceil(text.length / PER_LINE)) * LINE + PADDING;
beforeEach(() => {
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return textHeight(this.value);
    },
  });
});
afterEach(() => {
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
});

const HINT = "Describe the app, e.g. list materials below safety stock and let each row request a refill";
const NARROW_HINT = "Ask anything about your data…";

it("is one line while empty, and as tall as its message once the reader types", async () => {
  const labels = ref({ placeholder: HINT, send: "Send", stop: "Stop" });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ShellComposer, { busy: false, labels: labels.value }) });
  app.mount(root);
  try {
    const input = root.querySelector("textarea")!;
    // Empty: one line, however long the hint (the test page reports one line for a textarea holding nothing).
    expect(input.style.height).toBe(`${textHeight("")}px`);
    expect(input.value).toBe("");

    input.value = "Add a filter";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(input.style.height).toBe(`${textHeight("Add a filter")}px`);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    labels.value = { ...labels.value, placeholder: "Describe what to change" };
    await nextTick();
    expect(input.style.height).toBe(`${textHeight("")}px`);
  } finally {
    app.unmount();
    root.remove();
  }
});

it("keeps the agent choice on the row when the composer is narrow", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({
    render: () => h(ShellComposer, { busy: false, labels: { placeholder: NARROW_HINT, send: "Send", stop: "Stop" } }, {
      agent: () => h("button", { class: "switch-trigger" }, [
        h("span", { class: "switch-name" }, "Knowledge governance"),
        h("span", { class: "switch-chevron" }),
      ]),
    }),
  });
  app.mount(root);
  try {
    // The row is one row: the agent choice, the input and send, in that order (the narrow width's rules are the
    // component's stylesheet: which of them shrinks is read there, the page itself is checked at 128).
    const input = root.querySelector<HTMLElement>("textarea")!;
    expect([...root.querySelector(".composer")!.children].map((child) => child.className || child.tagName.toLowerCase())).toEqual([
      "composer-agent", "textarea", "composer-actions",
    ]);
    // The empty composer is one line high whatever the hint: the agent choice stays beside it.
    expect(input.style.height).toBe(`${textHeight("")}px`);
  } finally {
    app.unmount();
    root.remove();
  }
});

/*
 * One composer, two states. On a page it is one row — it must not take the page's room — and it opens into two rows only
 * while the message takes more than one line; emptied, it is one row again. In a conversation it is two rows from the
 * start. Open, the input is the first line, from the left edge, and the controls are the line under it.
 */
function mountComposer(expanded: boolean) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({
    render: () => h(ShellComposer, { busy: false, expanded, labels: { placeholder: "Ask", send: "Send", stop: "Stop" } }, {
      agent: () => h("button", { class: "switch-trigger" }, "Assistant"),
    }),
  });
  app.mount(root);
  const composer = () => root.querySelector<HTMLElement>(".composer")!;
  const input = root.querySelector<HTMLTextAreaElement>("textarea")!;
  async function type(value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
    await nextTick();
    await nextTick();
  }
  return { root, composer, input, type, done: () => { app.unmount(); root.remove(); } };
}

it("stays one row on a page, opens while the message takes more lines, and closes again when it is emptied", async () => {
  const page = mountComposer(false);
  try {
    expect(page.composer().classList.contains("open")).toBe(false);

    await page.type("Short question");
    expect(page.composer().classList.contains("open")).toBe(false);

    await page.type("A question long enough to need a second line on the page's own composer, and more");
    expect(page.composer().classList.contains("open")).toBe(true);

    await page.type("");
    expect(page.composer().classList.contains("open")).toBe(false);
  } finally {
    page.done();
  }
});

it("is two rows in a conversation from the start, with the input first and the controls under it", async () => {
  const conversation = mountComposer(true);
  try {
    expect(conversation.composer().classList.contains("open")).toBe(true);
    // The input comes first in the open layout's order and the agent and send follow it on the next line. Where those
    // lines fall on the screen (the input's left edge, send at the right) is the stylesheet's and is checked at 128.
    expect(conversation.input.style.height).toBe(`${textHeight("")}px`);
    expect(conversation.root.querySelector(".composer.open textarea")).not.toBeNull();
    expect(conversation.root.querySelector(".composer.open .composer-actions")).not.toBeNull();
  } finally {
    conversation.done();
  }
});
