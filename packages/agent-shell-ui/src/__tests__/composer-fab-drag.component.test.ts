import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import ShellComposer from "../components/ShellComposer.vue";

/*
 * The folded floating composer is one small button over the page: a tap opens it, a drag moves it inside the page area,
 * and this browser remembers that place. happy-dom has no layout, so the tests give the page area and the button their
 * dimensions and use the inline distances the component draws; the rendered page itself is checked in the browser.
 */

const labels = { placeholder: "Ask", send: "Send", stop: "Stop", collapseComposer: "Hide", expandComposer: "Ask about this page" };
const apps: App[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const app of apps.splice(0).reverse()) app.unmount();
  document.body.innerHTML = "";
  localStorage.clear();
});

function pointer(target: HTMLElement, type: string, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
}

async function mountFolded(position?: { right: number; bottom: number }, size = { width: 800, height: 600 }) {
  localStorage.setItem("ontomato.shell.composerCollapsed", "true");
  if (position) localStorage.setItem("ontomato.shell.composerFabPosition", JSON.stringify(position));
  const area = document.createElement("section");
  area.style.position = "relative";
  let width = size.width;
  let height = size.height;
  Object.defineProperty(area, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(area, "clientHeight", { configurable: true, get: () => height });
  const dock = document.createElement("div");
  dock.style.position = "absolute";
  const mountPoint = document.createElement("div");
  area.append(dock);
  dock.append(mountPoint);
  document.body.append(area);
  const app = createApp({ render: () => h(ShellComposer, { busy: false, floating: true, labels }) });
  apps.push(app);
  app.mount(mountPoint);
  await nextTick();
  await nextTick();
  const button = area.querySelector<HTMLButtonElement>(".composer-unfold")!;
  Object.defineProperty(button, "offsetWidth", { configurable: true, value: 44 });
  Object.defineProperty(button, "offsetHeight", { configurable: true, value: 44 });
  window.dispatchEvent(new Event("resize"));
  await nextTick();
  return {
    area,
    button: () => area.querySelector<HTMLButtonElement>(".composer-unfold"),
    composer: () => area.querySelector("form.composer"),
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
      window.dispatchEvent(new Event("resize"));
    },
  };
}

const storedPosition = () => JSON.parse(localStorage.getItem("ontomato.shell.composerFabPosition") ?? "null") as { right: number; bottom: number } | null;

it("moves with a drag inside the page area, remembers the place, and does not open as a click", async () => {
  const first = await mountFolded({ right: 100, bottom: 100 });
  const button = first.button()!;
  expect(button.style.right).toBe("100px");
  expect(button.style.bottom).toBe("100px");

  pointer(button, "pointerdown", 500, 400);
  pointer(button, "pointermove", 420, 330);
  await nextTick();
  expect(button.style.right).toBe("180px");
  expect(button.style.bottom).toBe("170px");
  pointer(button, "pointerup", 420, 330);
  expect(storedPosition()).toEqual({ right: 180, bottom: 170 });

  // The release of a drag is not a light tap: it never opens the composer.
  button.click();
  await nextTick();
  expect(first.composer()).toBeNull();
  expect(first.button()).not.toBeNull();

  // Drawn again (another page, a reload): the same place comes back.
  apps.splice(0).pop()!.unmount();
  const again = await mountFolded();
  expect(again.button()!.style.right).toBe("180px");
  expect(again.button()!.style.bottom).toBe("170px");
});

it("opens on a light tap and leaves no dragged position behind", async () => {
  const page = await mountFolded();
  const button = page.button()!;
  pointer(button, "pointerdown", 500, 400);
  pointer(button, "pointerup", 500, 400);
  button.click();
  await nextTick();

  expect(page.composer()).not.toBeNull();
  expect(page.button()).toBeNull();
  expect(localStorage.getItem("ontomato.shell.composerCollapsed")).toBe("false");
  expect(storedPosition()).toBeNull();
});

it("pulls a remembered place back into view when the page area shrinks", async () => {
  const page = await mountFolded({ right: 300, bottom: 220 });
  expect(page.button()!.style.right).toBe("300px");
  expect(page.button()!.style.bottom).toBe("220px");

  page.resize(300, 200);
  await nextTick();
  expect(page.button()!.style.right).toBe("256px");
  expect(page.button()!.style.bottom).toBe("156px");
  expect(storedPosition()).toEqual({ right: 256, bottom: 156 });
});

it("clamps a drag at the page area's edges", async () => {
  const page = await mountFolded({ right: 100, bottom: 100 }, { width: 300, height: 200 });
  const button = page.button()!;

  pointer(button, "pointerdown", 250, 150);
  pointer(button, "pointermove", -300, -300);
  await nextTick();
  expect(button.style.right).toBe("256px");
  expect(button.style.bottom).toBe("156px");
  pointer(button, "pointermove", 900, 700);
  await nextTick();
  expect(button.style.right).toBe("0px");
  expect(button.style.bottom).toBe("0px");
  pointer(button, "pointerup", 900, 700);
  expect(storedPosition()).toEqual({ right: 0, bottom: 0 });
});
