import { assistantSkillCatalogSchema } from "@ontomato/contracts/assistant-chat";
import { runtimeSkillKey, runtimeSkillRefSchema } from "@ontomato/contracts/agent-runtime-skills";
import { SKILL } from "@ontomato/contracts/panel-client-requests";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

export const skillAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    const response = await requests.request("/assistant/agent-skills", {}, "");
    const { skills } = assistantSkillCatalogSchema.parse(await response.json());
    return skills.map(({ skill, title, description }) => ({
      primaryKey: runtimeSkillKey(skill), label: title, value: skill, description,
    }));
  }
  return [{
    objectType: SKILL,
    options: {
      async list() { return { options: await list() }; },
      async resolve(values) {
        const options = new Map((await list()).map(option => [option.primaryKey, option]));
        return values.map(value => {
          const skill = runtimeSkillRefSchema.parse(value);
          const primaryKey = runtimeSkillKey(skill);
          return options.get(primaryKey) ?? { primaryKey, value: skill, label: skill.name, unavailable: { reason: "unavailable" } };
        });
      },
    },
  }];
};
