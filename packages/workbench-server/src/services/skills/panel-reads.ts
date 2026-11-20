import { runtimeSkillKey, runtimeSkillRefSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { PanelOption, PanelOptionList } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { assistantSkillCatalog } from "../assistant/skills";
import type { ProductOwner } from "../product-governance/grants";

/*
 * The skill owner's named reads for a panel reference picker. Both reads answer `panelOptionList` from the
 * catalogue the initiating reader can see, read per call so revocation applies to the next read. `options` lists
 * that catalogue as it is, in the owner's order. `resolve` names the complete `RuntimeSkillRef` values a form
 * already holds: one item per value in the submitted order, a visible value by its catalogue titles, and a value
 * this call cannot see — missing, unreadable, or removed — by the same generalized label and reason, never the
 * skill's own name. Nothing is resolved from definitions or hidden stores.
 */

/** The values a form already holds, each a complete skill reference, in their submitted order. */
export interface SkillResolveRequest {
  values: readonly RuntimeSkillRef[];
}

export type SkillReads = {
  options(): Promise<PanelOptionList>;
  resolve(request: SkillResolveRequest): Promise<PanelOptionList>;
};

export function createSkillReadAdapter(
  owner: ProductOwner, viewer: AssistantCredentials, _callerUserName?: string,
): SkillReads {
  async function visibleCatalogue() {
    const { skills } = await assistantSkillCatalog(owner.domainId, viewer);
    return new Map(skills.map(({ skill, title, description }) => [runtimeSkillKey(skill), { skill, title, description }]));
  }
  const unavailable = () => ({
    label: tForLocale(viewer.locale, "assistant.skills.unavailable.name"),
    reason: tForLocale(viewer.locale, "assistant.skills.unavailable.reason"),
  });
  return {
    async options() {
      const catalogue = [...(await visibleCatalogue()).values()];
      return {
        options: catalogue.map(({ skill, title, description }): PanelOption => ({
          primaryKey: runtimeSkillKey(skill),
          value: skill,
          label: title,
          description,
        })),
      };
    },
    async resolve({ values }: SkillResolveRequest) {
      const catalogue = await visibleCatalogue();
      const { label, reason } = unavailable();
      return {
        options: values.map((held): PanelOption => {
          const skill = runtimeSkillRefSchema.parse(held);
          const visible = catalogue.get(runtimeSkillKey(skill));
          return visible
            ? { primaryKey: runtimeSkillKey(skill), value: skill, label: visible.title, description: visible.description }
            : { primaryKey: runtimeSkillKey(skill), value: skill, label, unavailable: { reason } };
        }),
      };
    },
  };
}
