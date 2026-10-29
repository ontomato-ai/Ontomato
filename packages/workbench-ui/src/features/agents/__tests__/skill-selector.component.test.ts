import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus, { ElUpload, ElMessageBox } from "element-plus";
import { ApiRequestError } from "../../../utils/api";
import { workbenchI18n } from "../../../i18n";
import SkillSelector from "../components/SkillSelector.vue";
import { skillsApi } from "../../skills/api";
import { agentDefinitionsApi } from "../api";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

const provider: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };
const domain: RuntimeSkillRef = { namespace: { kind: "domain", domainId: "test-domain" }, name: "imported-skill" };
const option = (skill: RuntimeSkillRef) => ({ skill, title: skill.name, description: "", enabled: true, tags: [] });
afterEach(() => { vi.restoreAllMocks(); });

describe("complete skill references in agent configuration", () => {
  it("imports a domain package after overwrite confirmation without losing the provider selection", async () => {
    const skill = { id: domain.name, skill: domain, type: "knowledge", category: "analysis", tags: [], enabled: true, version: "1" };
    vi.spyOn(agentDefinitionsApi, "skills").mockResolvedValueOnce([option(provider)]).mockResolvedValueOnce([option(provider), option(domain)]);
    const importer = vi.spyOn(skillsApi, "importSkill")
      .mockRejectedValueOnce(new ApiRequestError("Exists", 409, { code: "SKILL_EXISTS", details: { skillId: skill.id } }))
      .mockResolvedValueOnce({ success: true, skill });
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: [provider] },
      global: { plugins: [workbenchI18n(), ElementPlus], stubs: { SkillFormDialog: true } },
    });
    try {
      await flushPromises();
      const file = new File(["zip"], "skill.zip");
      await wrapper.getComponent(ElUpload).props("onChange")!({ raw: file } as any, []);
      await flushPromises();
      expect(importer.mock.calls[1][1]).toBe(true);
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[provider, domain]]);
    } finally { wrapper.unmount(); }
  });

  it("makes provider skills removable and retains namespace identity when names coincide", async () => {
    const sameName = { ...domain, name: provider.name };
    vi.spyOn(agentDefinitionsApi, "skills").mockResolvedValue([option(provider), option(sameName)]);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: [provider] },
      global: { plugins: [workbenchI18n(), ElementPlus], stubs: { SkillFormDialog: true } },
    });
    try {
      await flushPromises();
      const cards = wrapper.findAll(".skill-card");
      expect(cards[0].classes()).toContain("selected");
      expect(cards[1].classes()).not.toContain("selected");
      await cards[0].trigger("click");
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[]]);
      await cards[1].trigger("click");
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[sameName]]);
    } finally { wrapper.unmount(); }
  });
});
