import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

export const APP_BUILDER_KIND = "app-builder";
export const APP_BUILDER_SKILL: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" }, name: "ontomato-app-builder",
};
export const APP_BUILDER = {
  kind: APP_BUILDER_KIND, name: "App builder", description: "Build and publish hosted applications", skills: [APP_BUILDER_SKILL],
};
