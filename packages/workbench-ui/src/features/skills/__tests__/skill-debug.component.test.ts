import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { workbenchI18n } from "../../../i18n";
import SkillDebugDialog from "../components/SkillDebugDialog.vue";

vi.mock("../api", () => ({
  skillsApi: { debugSkill: async () => ({ success: true, result: { html: "<html><body>chart</body></html>", json: {}, meta: {} } }) },
}));

afterEach(() => {
  document.body.innerHTML = "";
});

// A skill's debug output runs as the skill's own page did before the shared HTML preview drew it: scripts and its own
// origin, so it can load the skill's resources, and the browser's default referrer policy.
it("runs a skill's HTML output with scripts and its own origin, as before", async () => {
  const wrapper = mount(SkillDebugDialog, {
    props: { visible: true, skill: { id: "echarts", title: "ECharts" } as SkillInfo },
    global: { plugins: [workbenchI18n(), ElementPlus] },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper.findAll("button").find((button) => button.text() === "Execute")!.trigger("click");
  await flushPromises();
  const frame = document.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  expect(frame.hasAttribute("referrerpolicy")).toBe(false);
  expect(frame.srcdoc).toContain("chart");
  wrapper.unmount();
});
