import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import ShellPagePane from "../components/ShellPagePane.vue";
import { shellContextKey, type ShellContext } from "../context";

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

/** A page beside the conversation, with the window at happy-dom's 1024px: the side is 430px, at most 717px, at least 360px. */
async function sidePane() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const onExpand = vi.fn();
  const onClose = vi.fn();
  app = createApp({
    render: () =>
      h(ShellPagePane, {
        feature: { id: "panel", label: "Workspace", icon: "pages", availability: "page", withConversation: true },
        view: "side",
        busy: false,
        disabled: false,
        onExpand,
        onClose,
      }),
  });
  app.provide(shellContextKey, { labels: ref({ expand: "Expand", close: "Close" }) } as unknown as ShellContext);
  app.mount(root);
  await nextTick();
  const pane = root.querySelector<HTMLElement>(".page-pane")!;
  const handle = root.querySelector<HTMLElement>(".pane-resize")!;
  /** Presses the handle at x 500, moves to `to` and releases there; the browser ends the capture on release. */
  async function drag(to: number) {
    handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 500, bubbles: true }));
    handle.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: to }));
    await nextTick();
    const during = { width: pane.style.getPropertyValue("--panel-width"), className: pane.className };
    handle.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    await nextTick();
    return { during, after: pane.style.getPropertyValue("--panel-width") };
  }
  return { onExpand, onClose, drag };
}

// The agent-app states (DESIGN "Agent apps"): dragging the side past its bounds is a way to the other two states.
it("expands or closes a page dragged on past its bounds, and stops at a bound otherwise", async () => {
  const { onExpand, onClose, drag } = await sidePane();

  // 430 + (500 - 600) = 330: under the narrowest by less than the snap distance, so it stops at 360.
  expect(await drag(600)).toMatchObject({ during: { width: "360px" }, after: "360px" });
  expect([onExpand.mock.calls.length, onClose.mock.calls.length]).toEqual([0, 0]);

  // 360 + (500 - 700) = 160: far past the narrowest; releasing there closes the page and keeps the width it had.
  const closing = await drag(700);
  expect(closing.during.className).toContain("beyond-close");
  expect(closing.after).toBe("360px");
  expect(onClose).toHaveBeenCalledTimes(1);

  // 360 + (500 - 50) = 810: past the widest (717) by more than the snap distance; releasing there expands the page.
  const expanding = await drag(50);
  expect(expanding.during).toMatchObject({ width: "717px" });
  expect(expanding.during.className).toContain("beyond-expand");
  expect(expanding.after).toBe("360px");
  expect(onExpand).toHaveBeenCalledTimes(1);
});
