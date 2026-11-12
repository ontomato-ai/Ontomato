import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import { workbenchI18n } from "../../../i18n";
import SkillLibrary from "../components/SkillLibrary.vue";
import { skillsApi } from "../api";

/** Each card exports its skill and deletes it, greyed for a built-in one; importing first says what a package is. */
const skill = (id: string, isPublic: boolean) => ({ id, title: id, isPublic, skill: { name: id }, type: "knowledge", category: "analysis", tags: [], path: "", version: "" });

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("offers deletion on every card, greyed for a built-in skill, and explains the package before the file is chosen", async () => {
  vi.spyOn(skillsApi, "fetchSkills").mockResolvedValue({ success: true, skills: [skill("built-in", true), skill("own", false)] });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)", component: { template: "<div/>" } }] });
  const wrapper = mount(SkillLibrary, { global: { plugins: [workbenchI18n(), ElementPlus, router] }, attachTo: document.body });
  await flushPromises();
  const cards = wrapper.findAll(".skill-card");
  expect(cards.map((card) => card.find(".card-actions .el-button--danger").attributes("disabled"))).toEqual(["", undefined]);
  expect(document.querySelector(".import-rules")).toBeNull();
  await wrapper.find(".platform-page-header .el-button--primary").trigger("click");
  await flushPromises();
  expect(document.querySelectorAll(".import-rules li")).toHaveLength(4);
  wrapper.unmount();
});
