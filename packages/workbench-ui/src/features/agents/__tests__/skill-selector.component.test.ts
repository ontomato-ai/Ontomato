import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus, { ElUpload, ElMessageBox } from "element-plus";
import { ApiRequestError } from "../../../utils/api";
import { workbenchI18n } from "../../../i18n";
import SkillSelector from "../components/SkillSelector.vue";
import SkillFormDialog from "../../skills/components/SkillFormDialog.vue";
import { skillsApi } from "../../skills/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skill creation during agent configuration", () => {
  it("confirms overwrite, imports the ZIP and preserves existing selections", async () => {
    const skill = { id: "imported-skill", type: "knowledge" as const, category: "analysis" as const, tags: [], enabled: true, version: "1" };
    vi.spyOn(skillsApi, "listAnalysisSkills").mockResolvedValueOnce([]).mockResolvedValueOnce([skill]);
    vi.spyOn(skillsApi, "listVisualizationSkills").mockResolvedValue([]);
    const importer = vi.spyOn(skillsApi, "importSkill")
      .mockRejectedValueOnce(new ApiRequestError("Exists", 409, { code: "SKILL_EXISTS", details: { skillId: skill.id } }))
      .mockResolvedValueOnce({ success: true, skill });
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: ["existing-skill"] },
      global: { plugins: [workbenchI18n(), ElementPlus], stubs: { SkillFormDialog: true } },
    });
    try {
      await flushPromises();
      const file = new File(["zip"], "skill.zip");
      await wrapper.getComponent(ElUpload).props("onChange")!({ raw: file } as any, []);
      await flushPromises();
      expect(importer).toHaveBeenCalledTimes(2);
      expect(importer.mock.calls[0][0].get("file")).toBeInstanceOf(File);
      expect(importer.mock.calls[1][1]).toBe(true);
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["existing-skill", skill.id]]);
    } finally {
      wrapper.unmount();
    }
  });

  it("lists analysis and visualization skills together and selects a newly created one", async () => {
    const created = {
      id: "new-skill", type: "executable" as const, category: "visualization" as const,
      title: "New skill", tags: [], enabled: true, version: "1.0.0",
    };
    const analysis = { ...created, id: "analysis-skill", title: "Analysis skill", category: "analysis" as const };
    vi.spyOn(skillsApi, "listAnalysisSkills").mockResolvedValue([analysis]);
    const visual = vi.spyOn(skillsApi, "listVisualizationSkills").mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: ["existing-skill"] },
      global: { plugins: [workbenchI18n(), ElementPlus], stubs: { SkillFormDialog: true } },
    });
    try {
      await flushPromises();
      expect(wrapper.findAll(".skill-title").map((title) => title.text())).toEqual(["Analysis skill"]);
      await wrapper.findAll(".skill-selector-toolbar button").at(-1)!.trigger("click");
      const form = wrapper.getComponent(SkillFormDialog);
      expect(form.props("visible")).toBe(true);
      form.vm.$emit("created", created);
      await flushPromises();
      expect(visual).toHaveBeenCalledTimes(2);
      expect(wrapper.findAll(".skill-title").map((title) => title.text())).toEqual(["Analysis skill", "New skill"]);
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["existing-skill", "new-skill"]]);
    } finally {
      wrapper.unmount();
    }
  });
});
