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

// A theme rule the page's stylesheets work out on the root from the brand's colours (the enterprise edition's focus ring,
// 2026-11-21) is worked out there once and inherited as it came out: the area declares it again, as it is written, so it
// is worked out from the area's own colours — in the mode the page is in, and through every rule that leads to it.
it("declares again in the area every root rule that is worked out from a colour the area recolours", async () => {
  const style = document.createElement("style");
  style.textContent = [
    ":root { --brand-primary-tint: #e8f0ff; --unrelated: 4px; --control-focus-ring: 0 0 0 1px blue; }",
    "html:root { --control-focus-ring: 0 0 0 2px var(--brand-primary-tint); --control-ring: var(--control-focus-ring); --error-ring: 0 0 0 2px var(--el-color-danger-light-9); }",
    "html.dark { --control-focus-ring: 0 0 0 3px var(--brand-primary-tint); }",
  ].join("\n");
  document.head.append(style);
  try {
    const mode = ref<ThemeMode>("light");
    const assigned = ref<PanelThemeOverrides | null>(theme);
    const area = mountArea(mode, assigned);
    await nextTick();
    // The more specific root rule, as written; and the rule that reads it.
    expect(area().style.getPropertyValue("--control-focus-ring")).toBe("0 0 0 2px var(--brand-primary-tint)");
    expect(area().style.getPropertyValue("--control-ring")).toBe("var(--control-focus-ring)");
    // A rule from no colour the theme recolours stays the root's.
    expect(area().style.getPropertyValue("--unrelated")).toBe("");
    expect(area().style.getPropertyValue("--error-ring")).toBe("");
    // In dark mode, the dark rule.
    document.documentElement.classList.add("dark");
    mode.value = "dark";
    await nextTick();
    await nextTick();
    expect(area().style.getPropertyValue("--control-focus-ring")).toBe("0 0 0 3px var(--brand-primary-tint)");
  } finally {
    document.documentElement.classList.remove("dark");
    style.remove();
  }
});

// The deployment's stylesheet holds selectors with commas inside a function (Element Plus's colour picker,
// `:not(:is(.is-disabled, .is-focused))`), 2026-11-22 on 128: a list is matched as the browser parses it, never cut at
// every comma, so such a rule neither stops the theme nor counts as the root's.
it("reads root rules past selectors whose functions hold commas, and still assigns the theme", async () => {
  const style = document.createElement("style");
  style.textContent = [
    ".picker:hover:not(:is(.is-disabled, .is-focused)) .trigger { color: red; }",
    ":root, .elsewhere:not(:is(.a, .b)) { --control-focus-ring: 0 0 0 2px var(--brand-primary-tint); }",
  ].join("\n");
  document.head.append(style);
  try {
    const area = mountArea(ref<ThemeMode>("light"), ref<PanelThemeOverrides | null>(theme));
    await nextTick();
    expect(area().style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
    expect(area().style.getPropertyValue("--control-focus-ring")).toBe("0 0 0 2px var(--brand-primary-tint)");
  } finally {
    style.remove();
  }
});
