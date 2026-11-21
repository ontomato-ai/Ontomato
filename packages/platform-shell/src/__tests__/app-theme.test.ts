import { afterEach, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";
import { applyTheme, composeThemes, useAppTheme, type ThemeMode } from "../app-theme";

/*
 * An application's theme assigned in its area only (product-layer standard; design §六): the area takes the values in the
 * reader's mode, a pop-up opened from inside the area takes them too, a pop-up opened elsewhere (the platform's rail,
 * the account menu) does not, and nothing is left behind once the application goes.
 */

const theme: PanelThemeOverrides = { light: { "--el-color-primary": "#0f7b6c" }, dark: { "--el-color-primary": "#3cc4ad" } };
let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

function mountArea(mode: Ref<ThemeMode>, assigned: Ref<PanelThemeOverrides | null>) {
  const area = ref<HTMLElement | null>(null);
  const app = createApp(defineComponent({
    setup() {
      useAppTheme(area, () => assigned.value, () => mode.value);
      return () => h("div", [
        h("nav", { class: "rail" }, [h("button", { class: "account", "aria-controls": "account-menu" }, "Account")]),
        h("section", { ref: area, class: "app-area" }, [h("button", { class: "picker", "aria-describedby": "picker-popup" }, "Pick")]),
      ]);
    },
  }));
  const element = document.createElement("div");
  document.body.append(element);
  app.mount(element);
  unmount = () => app.unmount();
  return () => document.querySelector<HTMLElement>(".app-area")!;
}

/** A pop-up layer the component library adds at the end of the document. */
async function popup(id: string) {
  const layer = document.createElement("div");
  layer.innerHTML = `<div id="${id}" class="el-popper">…</div>`;
  document.body.append(layer);
  await new Promise((resolve) => setTimeout(resolve));
  return document.getElementById(id)!;
}

it("assigns the theme in the application's area in the reader's mode, and follows a change of mode", async () => {
  const mode = ref<ThemeMode>("light");
  const area = mountArea(mode, ref(theme));
  await nextTick();
  expect(area().style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
  mode.value = "dark";
  await nextTick();
  expect(area().style.getPropertyValue("--el-color-primary")).toBe("#3cc4ad");
});

it("gives a pop-up opened inside the area the area's theme, and one opened from the rail none", async () => {
  mountArea(ref("light"), ref(theme));
  await nextTick();
  expect((await popup("picker-popup")).style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
  expect((await popup("account-menu")).style.getPropertyValue("--el-color-primary")).toBe("");
});

it("takes the theme away when the application has none any more or goes", async () => {
  const assigned = ref<PanelThemeOverrides | null>(theme);
  const area = mountArea(ref("light"), assigned);
  await nextTick();
  assigned.value = null;
  await nextTick();
  expect(area().style.getPropertyValue("--el-color-primary")).toBe("");
  assigned.value = theme;
  await nextTick();
  const element = area();
  unmount!();
  unmount = null;
  expect(element.style.getPropertyValue("--el-color-primary")).toBe("");
});

it("lays a placement's theme over the panel's own, key by key and mode by mode", () => {
  const panel: PanelThemeOverrides = { light: { "--a": "1", "--b": "1" }, dark: { "--a": "d1" } };
  const placement: PanelThemeOverrides = { light: { "--b": "2" } };
  expect(composeThemes(panel, placement)).toEqual({ light: { "--a": "1", "--b": "2" }, dark: { "--a": "d1" } });
  expect(composeThemes(undefined, null)).toEqual({});
});

it("assigns a theme to a host-mounted element until it is taken away, and gives its pop-ups the same", async () => {
  const mode = ref<ThemeMode>("light");
  const element = document.createElement("div");
  element.innerHTML = `<button aria-controls="nested-popup">Open</button>`;
  document.body.append(element);
  const drop = applyTheme(element, () => theme, () => mode.value);
  expect(element.style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
  mode.value = "dark";
  await nextTick();
  expect(element.style.getPropertyValue("--el-color-primary")).toBe("#3cc4ad");
  expect((await popup("nested-popup")).style.getPropertyValue("--el-color-primary")).toBe("#3cc4ad");
  drop();
  expect(element.style.getPropertyValue("--el-color-primary")).toBe("");
});

it("themes a pop-up the library added before its trigger named it, once the trigger in the area opens it", async () => {
  mountArea(ref("light"), ref(theme));
  await nextTick();
  // The layer exists first, named by nothing (a date picker renders it before it opens).
  const layer = document.createElement("div");
  layer.innerHTML = `<div id="picker-later" class="el-popper">…</div>`;
  document.body.append(layer);
  await new Promise((resolve) => setTimeout(resolve));
  const popup = document.getElementById("picker-later")!;
  expect(popup.style.getPropertyValue("--el-color-primary")).toBe("");
  // Opening it, the trigger inside the area names it.
  const trigger = document.querySelector<HTMLElement>(".picker")!;
  trigger.setAttribute("aria-controls", "picker-later");
  trigger.setAttribute("aria-expanded", "true");
  await new Promise((resolve) => setTimeout(resolve));
  expect(popup.style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
});

// Element Plus's shades of primary are worked out on the page's root; the area declares them again from its own primary,
// so a focus ring, a hovered button and a soft fill inside it follow the application's colour, its pop-ups too.
it("declares the shades of a colour the theme recolours in the area and its pop-ups, and takes them away with it", async () => {
  const mode = ref<ThemeMode>("light");
  const assigned = ref<PanelThemeOverrides | null>(theme);
  const area = mountArea(mode, assigned);
  await nextTick();
  expect(area().style.getPropertyValue("--el-color-primary-light-3")).toBe("color-mix(in srgb, var(--el-color-primary), var(--el-bg-color) 30%)");
  expect(area().style.getPropertyValue("--el-color-primary-rgb")).toBe("15, 123, 108");
  expect((await popup("picker-popup")).style.getPropertyValue("--el-color-primary-light-3")).not.toBe("");
  assigned.value = null;
  await nextTick();
  expect(area().style.getPropertyValue("--el-color-primary-light-3")).toBe("");
});
