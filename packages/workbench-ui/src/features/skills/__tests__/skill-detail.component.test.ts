import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import { workbenchI18n } from "../../../i18n";
import SkillDetail from "../components/SkillDetail.vue";
import { skillsApi } from "../api";

/** A skill is read as its package: SKILL.md opens first, and a built-in package offers no deletion. */
vi.mock("@ontomato/foundation-ui/code", () => ({ CodeEditor: { props: ["modelValue"], template: '<pre class="code-double">{{ modelValue }}</pre>' } }));
vi.mock("@ontomato/foundation-ui/markdown", () => ({ MarkdownView: { props: ["content"], template: '<div class="markdown-double">{{ content }}</div>' } }));

const skill = (isPublic: boolean) => ({ id: "growth", title: "Growth", isPublic, skill: { name: "growth" }, type: "executable", category: "analysis", tags: [], path: "", version: "" });

afterEach(() => { vi.restoreAllMocks(); });

async function mountDetail(isPublic: boolean) {
  vi.spyOn(skillsApi, "fetchSkills").mockResolvedValue({ success: true, skills: [skill(isPublic)] });
  vi.spyOn(skillsApi, "listFiles").mockResolvedValue([{ path: "SKILL.md", size: 10 }, { path: "scripts/index.mjs", size: 5 }]);
  const read = vi.spyOn(skillsApi, "readFile").mockImplementation(async (_id, path) =>
    path === "SKILL.md" ? "---\nname: growth\n---\n# Growth\n" : "export {};\n");
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)", component: { template: "<div/>" } }] });
  const wrapper = mount(SkillDetail, { props: { skillId: "growth" }, global: { plugins: [workbenchI18n(), ElementPlus, router] } });
  await flushPromises();
  return { wrapper, read };
}

it("opens SKILL.md first, with its frontmatter as written above the drawn body, and shows other files as code", async () => {
  const { wrapper, read } = await mountDetail(false);
  expect(read).toHaveBeenCalledWith("growth", "SKILL.md");
  expect(wrapper.find(".frontmatter").text()).toBe("name: growth");
  expect(wrapper.find(".markdown-double").text()).toBe("# Growth");
  await wrapper.findAll(".tree-row")[1]!.trigger("click");
  await flushPromises();
  expect(wrapper.find(".code-double").text()).toBe("export {};");
  expect(wrapper.text()).toContain("Delete");
  wrapper.unmount();
});

it("offers no deletion for a built-in skill", async () => {
  const { wrapper } = await mountDetail(true);
  expect(wrapper.text()).not.toContain("Delete");
  wrapper.unmount();
});
