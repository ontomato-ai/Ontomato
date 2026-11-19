import { afterEach, expect, it } from "vitest";
import { effectScope } from "vue";
import { documentVisible, onDocumentVisibility, useDocumentVisible } from "../visibility";

/*
 * The background-tab switch follows what the browser reports for the document: hidden is the background, visible is the
 * foreground, and a page put into the back-forward cache is hidden until it is shown again. Focus is not part of it.
 */
function report(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => report("visible"));

it("follows the document's visibility, the back-forward cache included, and not the focus", () => {
  const heard: boolean[] = [];
  const stop = onDocumentVisibility((visible) => heard.push(visible));
  expect(documentVisible()).toBe(true);

  report("hidden");
  expect(documentVisible()).toBe(false);
  report("visible");
  // Another window taking the focus leaves this one visible.
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("pageshow"));
  expect(heard).toEqual([false, true, false, true]);

  stop();
  report("hidden");
  expect(heard).toHaveLength(4);
});

it("gives a component the state as a ref and stops following when it goes", () => {
  const scope = effectScope();
  const visible = scope.run(() => useDocumentVisible())!;
  expect(visible.value).toBe(true);
  report("hidden");
  expect(visible.value).toBe(false);

  scope.stop();
  report("visible");
  expect(visible.value).toBe(false);
});
