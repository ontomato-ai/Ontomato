import { createApp, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, expect, it } from "vitest";
import ShellComposer from "../components/ShellComposer.vue";
import { shellContextKey, type ShellContext } from "../context";

/*
 * The composer is as tall as what it shows. While it is empty that is its placeholder: a hint long enough to wrap is read
 * in full rather than cut through its second line. Once the reader types, the message decides again.
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

it("is as tall as its placeholder while empty, and as its message once the reader types", async () => {
  const labels = ref({ placeholder: HINT, send: "Send", stop: "Stop" });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ShellComposer, { busy: false }) });
  app.provide(shellContextKey, { labels } as unknown as ShellContext);
  app.mount(root);
  try {
    const input = root.querySelector("textarea")!;
    expect(input.style.height).toBe(`${textHeight(HINT)}px`);
    expect(input.value).toBe("");

    input.value = "Add a filter";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(input.style.height).toBe(`${textHeight("Add a filter")}px`);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    labels.value = { ...labels.value, placeholder: "Describe what to change" };
    await nextTick();
    expect(input.style.height).toBe(`${textHeight("Describe what to change")}px`);
  } finally {
    app.unmount();
    root.remove();
  }
});
