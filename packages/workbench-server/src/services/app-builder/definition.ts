import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { PAGE_OPERATOR_SKILL } from "../assistant/page-operator";

export const APP_BUILDER_KIND = "app-builder";
export function isAppBuilderKind(kind: string) { return kind === APP_BUILDER_KIND; }
export const APP_BUILDER_SKILL: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" }, name: "ontomato-app-builder",
};
export const APPLICATION_DESIGN_SKILL:RuntimeSkillRef={namespace:{kind:"provider",provider:"workbench"},name:"application-design"};
const DASHBOARD_SKILL: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" }, name: "dashboard-pages",
};
export const APP_BUILDER = {
  kind: APP_BUILDER_KIND, name: "App builder", description: "Build and publish hosted applications",
  skills: [APP_BUILDER_SKILL, APPLICATION_DESIGN_SKILL, DASHBOARD_SKILL, PAGE_OPERATOR_SKILL],
};
