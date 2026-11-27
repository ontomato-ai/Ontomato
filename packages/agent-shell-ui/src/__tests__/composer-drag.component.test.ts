import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import ShellComposer from "../components/ShellComposer.vue";

/*
 * The expanded floating composer drags from the grip in its upper bar. Its placement element is the room the page
 * leaves: exactly on the bottom line it is the composer's height, anywhere above it zero. happy-dom has no layout,
 * so the page, placement and box measurements are supplied here; the rendered page itself is checked in the browser.
 */

const labels = { placeholder: "Ask", send: "Send", stop: "Stop", collapseComposer: "Hide", expandComposer: "Ask about this page" };
const apps: App[] = [];

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  trigger(target: Element) {
    if (this.observed.has(target)) this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  localStorage.clear();
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  for (const app of apps.splice(0).reverse()) app.unmount();
  document.body.innerHTML = "";
  localStorage.clear();
  globalThis.ResizeObserver = originalResizeObserver;
});

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function pointer(target: HTMLElement, type: string, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
}

async function mountExpanded(position?: { right: number; bottom: number }) {
  const size = { pageWidth: 800, pageHeight: 600, gutter: 20, foot: 16, boxWidth: 500, boxHeight: 80 };
  const page = document.createElement("section");
  page.style.position = "relative";
  Object.defineProperty(page, "clientWidth", { configurable: true, get: () => size.pageWidth });
  Object.defineProperty(page, "clientHeight", { configurable: true, get: () => size.pageHeight });
  Object.defineProperty(page, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(0, 0, size.pageWidth, size.pageHeight),
  });
  const dock = document.createElement("div");
  dock.style.position = "absolute";
  const mountPoint = document.createElement("div");
  page.append(dock);
  mountPoint.style.paddingBottom = "16px";
  dock.append(mountPoint);
  document.body.append(page);
  const app = createApp({ render: () => h(ShellComposer, { busy: false, floating: true, labels }) });
  apps.push(app);
  app.mount(mountPoint);
  await nextTick();
  await nextTick();

  const placement = page.querySelector<HTMLElement>(".composer-placement")!;
  const box = page.querySelector<HTMLFormElement>("form.composer")!;
  Object.defineProperty(placement, "clientWidth", { configurable: true, get: () => size.pageWidth - size.gutter * 2 });
  Object.defineProperty(placement, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const height = Number.parseFloat(placement.style.height || "0") || 0;
      const bottom = size.pageHeight - size.foot;
      return rect(size.gutter, bottom - height, size.pageWidth - size.gutter, bottom);
    },
  });
  Object.defineProperty(box, "offsetWidth", { configurable: true, get: () => Math.min(size.boxWidth, placement.clientWidth) });
  Object.defineProperty(box, "offsetHeight", { configurable: true, get: () => size.boxHeight });
  Object.defineProperty(box, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const placementBox = placement.getBoundingClientRect();
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const rightDistance = box.classList.contains("placed") && box.style.right
        ? Number.parseFloat(box.style.right)
        : (placement.clientWidth - width) / 2;
      const bottomDistance = box.style.bottom ? Number.parseFloat(box.style.bottom) : 0;
      const right = placementBox.right - rightDistance;
      const bottom = placementBox.bottom - bottomDistance;
      return rect(right - width, bottom - height, right, bottom);
    },
  });
  if (position) localStorage.setItem("ontomato.shell.composerPosition", JSON.stringify(position));
  window.dispatchEvent(new Event("resize"));
  await nextTick();
  await nextTick();

  return {
    page,
    size,
    placement: () => page.querySelector<HTMLElement>(".composer-placement"),
    box: () => page.querySelector<HTMLFormElement>("form.composer"),
    grip: () => page.querySelector<HTMLElement>(".composer-drag"),
    resize(width: number, height: number) {
      size.pageWidth = width;
      size.pageHeight = height;
      window.dispatchEvent(new Event("resize"));
    },
  };
}

const storedPosition = () => JSON.parse(localStorage.getItem("ontomato.shell.composerPosition") ?? "null") as { right: number; bottom: number } | null;
const storedFabPosition = () => localStorage.getItem("ontomato.shell.composerFabPosition");

it("starts centered on the bottom line with the page's room, drags from the grip, and leaves no room above the bottom", async () => {
  const page = await mountExpanded();
  expect(page.placement()!.style.height).toBe("80px");
  expect(page.placement()!.classList.contains("off-bottom")).toBe(false);
  expect(page.box()!.classList.contains("placed")).toBe(false);

  const grip = page.grip()!;
  pointer(grip, "pointerdown", 500, 400);
  pointer(grip, "pointermove", 420, 330);
  await nextTick();
  expect(page.box()!.style.right).toBe("210px");
  expect(page.box()!.style.bottom).toBe("86px");
  expect(page.placement()!.style.height).toBe("0px");
  expect(page.placement()!.classList.contains("off-bottom")).toBe(true);
  pointer(grip, "pointerup", 420, 330);
  expect(storedPosition()).toEqual({ right: 210, bottom: 70 });
  expect(storedFabPosition()).toBeNull();

  apps.splice(0).pop()!.unmount();
  const again = await mountExpanded();
  expect(again.box()!.style.right).toBe("210px");
  expect(again.box()!.style.bottom).toBe("86px");
  expect(again.placement()!.style.height).toBe("0px");
});

it("returns the page's room when dragged back onto the bottom line", async () => {
  const page = await mountExpanded({ right: 210, bottom: 170 });
  expect(page.placement()!.style.height).toBe("0px");
  const grip = page.grip()!;

  pointer(grip, "pointerdown", 420, 330);
  pointer(grip, "pointermove", 420, 900);
  await nextTick();
  expect(page.box()!.style.bottom).toBe("0px");
  expect(page.placement()!.style.height).toBe("80px");
  expect(page.placement()!.classList.contains("off-bottom")).toBe(false);
  pointer(grip, "pointerup", 420, 900);
  expect(storedPosition()).toEqual({ right: 210, bottom: 0 });
});

it("keeps the expanded box's place independent from the folded button's place", async () => {
  localStorage.setItem("ontomato.shell.composerFabPosition", JSON.stringify({ right: 30, bottom: 40 }));
  const page = await mountExpanded();
  const grip = page.grip()!;
  pointer(grip, "pointerdown", 500, 400);
  pointer(grip, "pointermove", 450, 350);
  pointer(grip, "pointerup", 450, 350);

  expect(storedPosition()).toEqual({ right: 180, bottom: 50 });
  expect(storedFabPosition()).toBe(JSON.stringify({ right: 30, bottom: 40 }));
});

it("pulls a remembered place back into the page area when the window shrinks", async () => {
  const page = await mountExpanded({ right: 700, bottom: 500 });
  expect(page.box()!.style.right).toBe("260px");
  expect(page.box()!.style.bottom).toBe("516px");

  page.resize(600, 300);
  await nextTick();
  await nextTick();
  expect(page.box()!.style.right).toBe("60px");
  expect(page.box()!.style.bottom).toBe("220px");
  expect(storedPosition()).toEqual({ right: 60, bottom: 204 });
});
