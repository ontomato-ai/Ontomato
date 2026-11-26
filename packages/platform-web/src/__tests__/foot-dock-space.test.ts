/* eslint-disable vue/one-component-per-file */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, inject, nextTick, ref, type App } from "vue";
import { pageDockSpaceKey } from "@ontomato/agent-shell-ui";
import EntryUnit from "../pages/EntryUnit.vue";

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
  trigger(target: HTMLElement, height: number) {
    Object.defineProperty(target, "offsetHeight", { configurable: true, value: height });
    if (!this.observed.has(target)) return;
    this.callback([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;
let app: App | null = null;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  globalThis.ResizeObserver = originalResizeObserver;
});

function triggerResize(target: HTMLElement, height: number) {
  for (const instance of FakeResizeObserver.instances) instance.trigger(target, height);
}

describe("floating foot dock space measurement", () => {
  it("EntryUnit measures its floating foot dynamically and publishes --pane-dock-space and pageDockSpaceKey", async () => {
    const readSpace = ref<number | null>(null);
    const Reader = defineComponent({
      setup() {
        const space = inject(pageDockSpaceKey);
        return () => {
          readSpace.value = space?.value ?? null;
          return h("div", { class: "body-probe" }, String(space?.value ?? ""));
        };
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    app = createApp({
      render: () =>
        h(EntryUnit, null, {
          default: () => h(Reader),
          foot: () => h("div", { class: "foot-probe" }, "Composer"),
        }),
    });
    app.mount(host);
    await nextTick();

    const unit = host.querySelector<HTMLElement>(".panel-entry-unit")!;
    const foot = host.querySelector<HTMLElement>(".panel-entry-unit-foot")!;
    expect(unit.style.getPropertyValue("--pane-dock-space")).toBe("0px");
    expect(readSpace.value).toBe(0);

    // Expanded two-layer floating composer.
    triggerResize(foot, 115);
    await nextTick();
    expect(unit.style.getPropertyValue("--pane-dock-space")).toBe("115px");
    expect(readSpace.value).toBe(115);

    // Multiline expansion.
    triggerResize(foot, 184);
    await nextTick();
    expect(unit.style.getPropertyValue("--pane-dock-space")).toBe("184px");
    expect(readSpace.value).toBe(184);

    // Folded corner FAB: the button floats absolutely and the foot owns no height.
    triggerResize(foot, 0);
    await nextTick();
    expect(unit.style.getPropertyValue("--pane-dock-space")).toBe("0px");
    expect(readSpace.value).toBe(0);
  });

  it("EntryUnit yields to an ancestor pageDockSpaceKey when mounted without its own foot", async () => {
    const ancestorSpace = ref(128);
    const readSpace = ref<number | null>(null);
    const Reader = defineComponent({
      setup() {
        const space = inject(pageDockSpaceKey);
        return () => {
          readSpace.value = space?.value ?? null;
          return h("div", { class: "body-probe" }, String(space?.value ?? ""));
        };
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    app = createApp({
      render: () => h(EntryUnit, null, { default: () => h(Reader) }),
    });
    app.provide(pageDockSpaceKey, ancestorSpace);
    app.mount(host);
    await nextTick();

    const unit = host.querySelector<HTMLElement>(".panel-entry-unit")!;
    expect(unit.style.getPropertyValue("--pane-dock-space")).toBe("");
    expect(readSpace.value).toBe(128);

    ancestorSpace.value = 0;
    await nextTick();
    expect(readSpace.value).toBe(0);
  });
});
