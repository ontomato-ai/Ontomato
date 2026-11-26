import { afterEach, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { h } from "vue";
import PageHeader from "../../../apps-sdk/src/base/PageHeader.vue";
import { panelContextKey } from "../../../apps-sdk/src/panel/context";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

function header(nested: boolean, slots: Record<string, () => ReturnType<typeof h>> = {}) {
  return mount(PageHeader, {
    props: { title: "Record", description: "Details", backLabel: "Back", density: "bar" },
    slots: { leading: () => h("span", { "data-test": "leading" }), ...slots },
    global: { plugins: [workbenchI18n()], provide: { [panelContextKey]: { instance: { nested } } } },
  });
}

it("keeps the full heading and back action for the entry panel", async () => {
  const page = header(false);
  expect(page.find("h1").exists()).toBe(true);
  expect(page.find("p").exists()).toBe(true);
  expect(page.find('[data-test="leading"]').exists()).toBe(true);
  await page.get("button").trigger("click");
  expect(page.emitted("back")).toBeDefined();
});

it("adds no elements for a nested header with no actions", () => {
  expect(header(true).element.nodeType).toBe(Node.COMMENT_NODE);
});

it.each(["actions", "default", "draft"])("renders the nested %s slot without the page heading", slot => {
  const page = header(true, { [slot]: () => h("button", { "data-test": "action" }) });
  expect(page.find('[data-test="action"]').exists()).toBe(true);
  expect(page.find("h1, p, [data-test=leading], .sdk-page-header-back").exists()).toBe(false);
});
