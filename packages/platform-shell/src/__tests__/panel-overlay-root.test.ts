import { afterEach, describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { createPanelOverlayRoot } from "../panel-host";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createPanelOverlayRoot", () => {
  it("uses one whole-window root when no page-region container is supplied", () => {
    const shown = ref(true);
    const overlay = createPanelOverlayRoot("single", () => shown.value);

    expect(overlay.element).toBe(overlay.windowElement);
    expect(overlay.element.parentElement).toBe(document.body);
    expect(overlay.element.className).toBe("panel-host-overlay-root");
    expect(overlay.element.dataset.panelInstance).toBe("single");
    expect(overlay.element.dataset.panelOverlayRoot).toBe("");

    shown.value = false;
    expect(overlay.element.hidden).toBe(true);
    expect(overlay.element.style.display).toBe("none");
    expect(overlay.element.inert).toBe(true);
    shown.value = true;
    expect(overlay.element.hidden).toBe(false);
    expect(overlay.element.style.display).toBe("");
    expect(overlay.element.inert).toBe(false);

    overlay.dispose();
    expect(overlay.element.isConnected).toBe(false);
  });

  it("moves the page-region root into its reactive container while the window root stays on document.body", async () => {
    const shown = ref(true);
    const region = ref<HTMLElement | null>(null);
    const container = document.createElement("main");
    document.body.append(container);
    const overlay = createPanelOverlayRoot("regioned", () => shown.value, () => region.value);

    expect(overlay.element).not.toBe(overlay.windowElement);
    expect(overlay.windowElement.parentElement).toBe(document.body);
    expect(overlay.element.parentElement).toBe(document.body);

    region.value = container;
    await nextTick();
    expect(overlay.element.parentElement).toBe(container);
    expect(overlay.windowElement.parentElement).toBe(document.body);

    region.value = null;
    await nextTick();
    expect(overlay.element.parentElement).toBe(document.body);

    shown.value = false;
    for (const root of [overlay.element, overlay.windowElement]) {
      expect(root.hidden).toBe(true);
      expect(root.style.display).toBe("none");
      expect(root.inert).toBe(true);
    }
    shown.value = true;
    for (const root of [overlay.element, overlay.windowElement]) {
      expect(root.hidden).toBe(false);
      expect(root.style.display).toBe("");
      expect(root.inert).toBe(false);
    }

    overlay.dispose();
    expect(overlay.element.isConnected).toBe(false);
    expect(overlay.windowElement.isConnected).toBe(false);
  });
});
