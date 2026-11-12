import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import SkillSelector from "../components/SkillSelector.vue";
import { agentDefinitionsApi } from "../api";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

const provider: RuntimeSkillRef = { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" };
const domain: RuntimeSkillRef = { namespace: { kind: "domain", domainId: "test-domain" }, name: "imported-skill" };
const option = (skill: RuntimeSkillRef) => ({ skill, title: skill.name, description: "", tags: [] });
afterEach(() => { vi.restoreAllMocks(); });

describe("complete skill references in agent configuration", () => {
  it("shows missing saved skills so their references can be removed without losing available selections", async () => {
    const missing: RuntimeSkillRef = { ...provider, name: "action-invocation" };
    vi.spyOn(agentDefinitionsApi, "skills").mockResolvedValue([option(provider)]);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: [provider, missing] },
      global: { plugins: [workbenchI18n(), ElementPlus] },
    });
    try {
      await flushPromises();
      const card = wrapper.findAll(".skill-card").find((item) => item.text().includes(missing.name))!;
      expect(card.classes()).toContain("selected");
      expect(card.text()).toContain("Unavailable");
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      await card.trigger("click");
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([[provider]]);
      expect(wrapper.text()).not.toContain(missing.name);
    } finally { wrapper.unmount(); }
  });

  it("does not call saved skills unavailable while the catalogue is still loading", async () => {
    vi.spyOn(agentDefinitionsApi, "skills").mockReturnValue(new Promise(() => {}));
    const wrapper = mount(SkillSelector, {
      props: { modelValue: [provider] },
      global: { plugins: [workbenchI18n(), ElementPlus] },
    });
    try {
      await flushPromises();
      expect(wrapper.findAll(".skill-card")).toHaveLength(0);
      expect(wrapper.text()).not.toContain("Unavailable");
    } finally { wrapper.unmount(); }
  });

  it("makes provider skills removable and retains namespace identity when names coincide", async () => {
    const sameName = { ...domain, name: provider.name };
    vi.spyOn(agentDefinitionsApi, "skills").mockResolvedValue([option(provider), option(sameName)]);
    const wrapper = mount(SkillSelector, {
      props: { modelValue: [provider] },
      global: { plugins: [workbenchI18n(), ElementPlus] },
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
