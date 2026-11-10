import { afterEach, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import ElementPlus, { ElDialog } from "element-plus";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The platform's own rules, without the foundation they import.
const platformStyles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../style.css"), "utf8").replace(
  /@import[^;]+;/g,
  ""
);

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

// The platform centres every dialog in its overlay, so the same stylesheet keeps each one within it: however tall the
// content, the title with its close button and the footer stay in view and only the body scrolls. The test DOM lays
// nothing out, so the test reads the layout the stylesheet gives Element Plus's own dialog.
it("keeps every dialog within the window: the title and the footer stay, the body scrolls", async () => {
  const style = document.createElement("style");
  style.textContent = platformStyles;
  document.head.append(style);
  const wrapper = mount(ElDialog, {
    props: { modelValue: true, title: "Skill" },
    slots: { default: () => h("div", { style: "height: 3000px" }), footer: () => h("button", "Close") },
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  });
  await flushPromises();
  const dialog = document.querySelector(".el-dialog")!;
  const part = (name: string) => getComputedStyle(dialog.querySelector(`.el-dialog__${name}`)!);

  expect([getComputedStyle(dialog).display, getComputedStyle(dialog).flexDirection]).toEqual(["flex", "column"]);
  expect(getComputedStyle(dialog).maxHeight).toMatch(/^calc\(100% - \d+px\)$/);
  expect(part("body").overflow).toBe("auto");
  expect(part("body").minHeight).toMatch(/^0(px)?$/);
  for (const fixed of ["header", "footer"]) expect(part(fixed).flexShrink).toBe("0");
  wrapper.unmount();
});
